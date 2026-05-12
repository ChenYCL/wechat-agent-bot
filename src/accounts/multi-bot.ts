/**
 * Multi-account bot manager.
 *
 * Spawns one `start()` long-poll per active WeChat account. Each loop
 * wraps the shared MessageRouter in a `PerAccountAgent` that prefixes
 * `conversationId` with the account id, so all downstream state stays
 * isolated per (account, peer).
 *
 * Crash/disconnect handling is delegated to the existing per-account
 * loop: each call has its own exponential-backoff reconnect, identical
 * to the original single-account behaviour. The manager itself only
 * tracks which accounts are running and exposes start/stop.
 */
import { start as sdkStart } from 'weixin-agent-sdk';
import type { Agent as SdkAgent } from 'weixin-agent-sdk';
import type { Agent, ChatRequest, ChatResponse } from '../core/types.js';
import type { WeChatAccountStore } from './store.js';
import { encodeScopedId } from './context.js';
import { logger } from '../utils/logger.js';

const MAX_RECONNECT_ATTEMPTS = 10;
const MIN_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 60_000;

interface RunningAccount {
  accountId: string;
  abort: AbortController;
  loop: Promise<void>;
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
      // Bootable accounts are those previously seen as 'active'. Pending rows
      // came from a half-completed QR login; we skip those until the user
      // re-tries.
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
    const loop = this.runLoop(accountId, agent, abort);
    this.running.set(accountId, { accountId, abort, loop });
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

  private async runLoop(accountId: string, agent: Agent, abort: AbortController): Promise<void> {
    let attempt = 0;
    while (!abort.signal.aborted && !this.stopping) {
      try {
        await sdkStart(agent as unknown as SdkAgent, {
          accountId,
          abortSignal: abort.signal,
        });
        logger.info(`[multi-bot] account=${accountId} loop ended cleanly`);
        break;
      } catch (err) {
        const e = err as Error;
        if (e.name === 'AbortError' || abort.signal.aborted || this.stopping) {
          logger.info(`[multi-bot] account=${accountId} aborted`);
          break;
        }
        attempt++;
        if (attempt >= MAX_RECONNECT_ATTEMPTS) {
          logger.error(`[multi-bot] account=${accountId} gave up after ${attempt} attempts: ${e.message}`);
          this.accounts.markLoggedOut(accountId);
          break;
        }
        const delay = Math.min(MAX_BACKOFF_MS, MIN_BACKOFF_MS * 2 ** (attempt - 1));
        logger.warn(`[multi-bot] account=${accountId} crashed (${e.message}); reconnect in ${delay}ms (${attempt}/${MAX_RECONNECT_ATTEMPTS})`);
        await sleep(delay, abort.signal).catch(() => {});
      }
    }
    this.running.delete(accountId);
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
