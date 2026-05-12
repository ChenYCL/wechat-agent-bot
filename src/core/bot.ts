/**
 * Bot lifecycle management - wraps weixin-agent-sdk login/start with
 * in-process auto-reconnect (exponential backoff) so a transient SDK
 * crash doesn't bring the bot down and force a fresh QR scan.
 */
import { login, start } from 'weixin-agent-sdk';
import type { Agent as SdkAgent, LoginOptions } from 'weixin-agent-sdk';
import type { Agent, BotOptions } from './types.js';
import { logger } from '../utils/logger.js';

const MAX_RECONNECT_ATTEMPTS = 10;
const MIN_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 60_000;

export class WeChatBot {
  private agent: Agent;
  private abortController: AbortController;
  private running = false;
  private stopRequested = false;

  constructor(agent: Agent) {
    this.agent = agent;
    this.abortController = new AbortController();
  }

  async login(options?: LoginOptions): Promise<string> {
    logger.info('Starting WeChat QR login...');
    const accountId = await login(options);
    logger.info(`Logged in as: ${accountId}`);
    return accountId;
  }

  async start(options?: BotOptions): Promise<void> {
    if (this.running) {
      logger.warn('Bot is already running');
      return;
    }

    this.running = true;
    this.stopRequested = false;
    logger.info('Starting WeChat bot message loop...');

    let attempt = 0;
    while (!this.stopRequested) {
      try {
        await start(this.agent as unknown as SdkAgent, {
          accountId: options?.account,
          abortSignal: this.abortController.signal,
          log: options?.onLog,
        });
        // start() returned normally — fully stopped.
        logger.info('Bot message loop ended cleanly');
        break;
      } catch (err) {
        const e = err as Error;
        if (e.name === 'AbortError' || this.stopRequested) {
          logger.info('Bot stopped gracefully');
          break;
        }
        attempt++;
        if (attempt >= MAX_RECONNECT_ATTEMPTS) {
          logger.error(`Bot crashed ${attempt} times, giving up: ${e.message}`);
          this.running = false;
          throw err;
        }
        const delay = Math.min(MAX_BACKOFF_MS, MIN_BACKOFF_MS * 2 ** (attempt - 1));
        logger.warn(`Bot crashed (${e.message}), reconnecting in ${delay}ms (attempt ${attempt}/${MAX_RECONNECT_ATTEMPTS})`);
        await sleep(delay, this.abortController.signal).catch(() => {});
        if (this.stopRequested) break;
        // Refresh abort controller for the next iteration
        this.abortController = new AbortController();
      }
    }

    this.running = false;
  }

  stop(): void {
    logger.info('Stopping bot...');
    this.stopRequested = true;
    this.abortController.abort();
  }

  isRunning(): boolean {
    return this.running;
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
