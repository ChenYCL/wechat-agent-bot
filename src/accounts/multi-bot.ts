/**
 * Multi-account bot manager.
 *
 * Spawns one WeChat long-poll per account, wraps the shared
 * MessageRouter in a `PerAccountAgent` that prefixes inbound
 * conversationIds with the account id so all downstream state stays
 * isolated per (account, peer).
 *
 * Built on weixin-agent-sdk 0.5+ which returns a `Bot` instance from
 * `start()` and exposes `Bot.sendMessage(text|response)` for proactive
 * pushes (uses the context_token cached from the most recent inbound
 * message; token is good for ~24 hours).
 */
import { start as sdkStart, Bot as SdkBot } from 'weixin-agent-sdk';
import type { Agent as SdkAgent } from 'weixin-agent-sdk';
import type { Agent, ChatRequest, ChatResponse } from '../core/types.js';
import type { WeChatAccountStore } from './store.js';
import { encodeScopedId, decodeScopedId } from './context.js';
import { rawPushTextMessage } from './raw-push.js';
import { logger } from '../utils/logger.js';

const MAX_RECONNECT_ATTEMPTS = 10;
const MIN_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 60_000;

interface RunningAccount {
  accountId: string;
  abort: AbortController;
  loop: Promise<void>;
  bot: SdkBot | null;
}

/** Wraps the shared router so inbound conversation ids are namespaced. */
class PerAccountAgent implements Agent {
  constructor(private accountId: string, private router: Agent, private accounts: WeChatAccountStore) {}

  async chat(request: ChatRequest): Promise<ChatResponse> {
    this.accounts.touch(this.accountId);
    const scoped: ChatRequest = {
      ...request,
      conversationId: encodeScopedId(this.accountId, request.conversationId),
    };
    return this.router.chat(scoped);
  }

  async clearSession(conversationId: string): Promise<void> {
    if (this.router.clearSession) {
      await this.router.clearSession(encodeScopedId(this.accountId, conversationId));
    }
  }
}

export class MultiAccountBot {
  private running = new Map<string, RunningAccount>();
  private stopping = false;

  constructor(
    private router: Agent,
    private accounts: WeChatAccountStore,
  ) {}

  /** Start loops for every account currently marked active in the store. */
  async startAll(): Promise<void> {
    const list = this.accounts.listResumeCandidates();
    for (const a of list) {
      if (a.status === 'active') {
        this.startAccount(a.accountId).catch((err) => {
          logger.error(`[multi-bot] account=${a.accountId} failed to start: ${(err as Error).message}`);
        });
      }
    }
    if (this.running.size === 0) {
      logger.info('[multi-bot] No active accounts to start');
    }
  }

  /** Begin running a single account in its own reconnect loop. */
  async startAccount(accountId: string): Promise<void> {
    if (this.running.has(accountId)) {
      logger.warn(`[multi-bot] account=${accountId} already running`);
      return;
    }
    const abort = new AbortController();
    const agent = new PerAccountAgent(accountId, this.router, this.accounts);
    const entry: RunningAccount = { accountId, abort, loop: Promise.resolve(), bot: null };
    this.running.set(accountId, entry);
    entry.loop = this.runLoop(entry, agent);
    this.accounts.markActive(accountId);
    logger.info(`[multi-bot] account=${accountId} started`);
  }

  async stopAccount(accountId: string): Promise<void> {
    const entry = this.running.get(accountId);
    if (!entry) return;
    entry.abort.abort();
    try { await entry.loop; } catch { /* swallow */ }
    this.running.delete(accountId);
    logger.info(`[multi-bot] account=${accountId} stopped`);
  }

  async stopAll(): Promise<void> {
    this.stopping = true;
    const all = [...this.running.values()];
    for (const e of all) e.abort.abort();
    await Promise.allSettled(all.map((e) => e.loop));
    this.running.clear();
  }

  listRunning(): string[] {
    return [...this.running.keys()];
  }

  /**
   * Proactive push, the supported way: looks up the running Bot for the
   * account encoded in `scopedConversationId` and calls SDK's
   * `bot.sendMessage()`. Returns true on success, false if the account
   * isn't running, the conversation id is malformed, or the SDK reports
   * "no context_token cached" (peer hasn't messaged in ~24h).
   */
  async send(scopedConversationId: string, content: { text?: string; media?: ChatResponse['media'] }): Promise<boolean> {
    if (!content.text && !content.media) return false;
    const parts = decodeScopedId(scopedConversationId);
    if (!parts) return false;
    const entry = this.running.get(parts.accountId);
    if (!entry?.bot) {
      logger.warn(`[multi-bot] send: account=${parts.accountId} not running`);
      return false;
    }
    try {
      const payload: ChatResponse = {};
      if (content.text) payload.text = content.text;
      if (content.media) payload.media = content.media;
      await entry.bot.sendMessage(payload as any);
      logger.info(`[multi-bot] sent via SDK to ${parts.accountId} → ${parts.raw} (${content.text?.length ?? 0} chars)`);
      return true;
    } catch (err) {
      const msg = (err as Error).message;
      // SDK 0.5 hard-requires a context_token cached from a prior inbound
      // message. If the peer has never messaged us, that fails. Fall back
      // to the raw HTTP endpoint which accepts requests without it.
      if (msg.includes('context_token') && content.text) {
        const raw = await rawPushTextMessage(parts.accountId, parts.raw, content.text);
        if (raw.ok) {
          logger.info(`[multi-bot] sent via raw HTTP (no context_token) to ${parts.accountId} → ${parts.raw}`);
          return true;
        }
        logger.warn(`[multi-bot] raw HTTP also failed for ${parts.accountId}: ${raw.error}`);
        return false;
      }
      logger.warn(`[multi-bot] sendMessage failed for ${parts.accountId}: ${msg}`);
      return false;
    }
  }

  private async runLoop(entry: RunningAccount, agent: Agent): Promise<void> {
    let attempt = 0;
    while (!entry.abort.signal.aborted && !this.stopping) {
      try {
        // SDK 0.5+: start() returns a Bot synchronously, bot.wait() resolves
        // when the long-poll stops (abort or unrecoverable error).
        const bot = sdkStart(agent as unknown as SdkAgent, {
          accountId: entry.accountId,
          abortSignal: entry.abort.signal,
        });
        entry.bot = bot;
        await bot.wait();
        logger.info(`[multi-bot] account=${entry.accountId} loop ended cleanly`);
        break;
      } catch (err) {
        const e = err as Error;
        entry.bot = null;
        if (e.name === 'AbortError' || entry.abort.signal.aborted || this.stopping) {
          logger.info(`[multi-bot] account=${entry.accountId} aborted`);
          break;
        }
        attempt++;
        if (attempt >= MAX_RECONNECT_ATTEMPTS) {
          logger.error(`[multi-bot] account=${entry.accountId} gave up after ${attempt} attempts: ${e.message}`);
          this.accounts.markLoggedOut(entry.accountId);
          break;
        }
        const delay = Math.min(MAX_BACKOFF_MS, MIN_BACKOFF_MS * 2 ** (attempt - 1));
        logger.warn(`[multi-bot] account=${entry.accountId} crashed (${e.message}); reconnect in ${delay}ms (${attempt}/${MAX_RECONNECT_ATTEMPTS})`);
        await sleep(delay, entry.abort.signal).catch(() => {});
      }
    }
    entry.bot = null;
    this.running.delete(entry.accountId);
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('aborted'));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new Error('aborted'));
    }, { once: true });
  });
}
