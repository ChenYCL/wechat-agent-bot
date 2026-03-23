/**
 * Dry-run mode — simulates WeChat message loop without real WeChat login.
 * Used for E2E testing and local development without scanning QR.
 *
 * Feeds messages from stdin or programmatic API, routes through the
 * full pipeline (router → provider → skills), and prints responses.
 */
import type { Agent, ChatRequest, ChatResponse } from './types.js';
import { logger } from '../utils/logger.js';
import { createInterface } from 'node:readline';

export class DryRunBot {
  private agent: Agent;
  private conversationId: string;

  constructor(agent: Agent, conversationId = 'dry-run-test') {
    this.agent = agent;
    this.conversationId = conversationId;
  }

  /** Send a single message through the full pipeline, return the response. */
  async send(text: string, media?: ChatRequest['media']): Promise<ChatResponse> {
    const request: ChatRequest = {
      conversationId: this.conversationId,
      text,
      media,
    };
    logger.debug(`[dry-run] IN: ${text}`);
    const response = await this.agent.chat(request);
    logger.debug(`[dry-run] OUT: ${response.text}`);
    return response;
  }

  /** Interactive stdin mode — type messages, see responses. */
  async interactive(): Promise<void> {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    logger.info('[dry-run] Interactive mode started. Type messages, Ctrl+C to exit.');

    const prompt = () => {
      rl.question('You> ', async (line) => {
        if (!line.trim()) { prompt(); return; }
        try {
          const res = await this.send(line.trim());
          console.log(`Bot> ${res.text || '[no text]'}`);
          if (res.media) console.log(`Bot> [media: ${res.media.type} ${res.media.url}]`);
        } catch (err) {
          console.error(`Error: ${(err as Error).message}`);
        }
        prompt();
      });
    };

    prompt();
    await new Promise<void>((resolve) => {
      rl.on('close', resolve);
    });
  }
}
