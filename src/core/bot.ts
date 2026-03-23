/**
 * Bot lifecycle management - wraps weixin-agent-sdk login/start.
 */
import { login, start } from 'weixin-agent-sdk';
import type { Agent as SdkAgent, LoginOptions } from 'weixin-agent-sdk';
import type { Agent, BotOptions } from './types.js';
import { logger } from '../utils/logger.js';

export class WeChatBot {
  private agent: Agent;
  private abortController: AbortController;
  private running = false;

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
    logger.info('Starting WeChat bot message loop...');

    try {
      await start(this.agent as unknown as SdkAgent, {
        accountId: options?.account,
        abortSignal: this.abortController.signal,
        log: options?.onLog,
      });
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        logger.info('Bot stopped gracefully');
      } else {
        logger.error('Bot error:', err);
        throw err;
      }
    } finally {
      this.running = false;
    }
  }

  stop(): void {
    logger.info('Stopping bot...');
    this.abortController.abort();
    this.abortController = new AbortController();
  }

  isRunning(): boolean {
    return this.running;
  }
}
