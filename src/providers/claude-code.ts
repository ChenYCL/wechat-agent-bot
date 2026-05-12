/**
 * Claude Code Provider — pipes WeChat messages through `claude -p`.
 *
 * Reuses your Claude Code subscription (Max/Pro/Team). No API key needed.
 *
 * Multi-turn conversation:
 *   1. First message: `claude -p --output-format json -- "<msg>"`
 *   2. Get session_id from response
 *   3. Next messages: `claude -p --resume <session_id> -- "<msg>"`
 *   Claude Code persists the session internally and resumes context.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { AbstractProvider } from './base.js';
import type { ChatRequest, ChatResponse, ModelConfig } from '../core/types.js';
import { logger } from '../utils/logger.js';

const execFileP = promisify(execFile);

interface ClaudeJsonResult {
  type: string;
  subtype?: string;
  result?: string;
  session_id?: string;
  total_cost_usd?: number;
  is_error?: boolean;
}

export class ClaudeCodeProvider extends AbstractProvider {
  private claudePath: string;
  private model: string;
  private systemPrompt: string;
  private allowedTools: string[];
  private sessionIds = new Map<string, string>();

  constructor(config: ModelConfig) {
    super(config);
    this.claudePath = (config.extra?.claudePath as string) || 'claude';
    this.model = config.model || 'sonnet';
    this.systemPrompt = config.systemPrompt || 'You are a helpful WeChat assistant. Be concise. Reply in the same language the user uses.';
    this.allowedTools = (config.extra?.allowedTools as string[]) || [];
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    return this.chatWithRetry(request, false);
  }

  private async chatWithRetry(request: ChatRequest, retried: boolean): Promise<ChatResponse> {
    let prompt = request.text || '';
    if (request.media) {
      prompt = `[Attachment: ${request.media.type} - ${request.media.filename || 'file'}]\n${prompt}`;
    }

    const args: string[] = [
      '-p',
      '--output-format', 'json',
      '--dangerously-skip-permissions',
    ];

    const existingSession = this.sessionIds.get(request.conversationId);
    if (existingSession) {
      args.push('--resume', existingSession);
    } else {
      args.push('--model', this.model);
      args.push('--system-prompt', this.systemPrompt);
    }

    if (this.allowedTools.length > 0) {
      // CLI expects a single comma-separated value (the previous spread
      // produced an unknown-flag-style error for many CLI versions).
      args.push('--allowedTools', this.allowedTools.join(','));
    }

    // Prompt as final positional argument.
    args.push(prompt);

    const sessionTag = request.conversationId.slice(0, 12);
    logger.info(`[claude-code] → ${sessionTag}... (resume=${existingSession ? 'yes' : 'no'}, ${prompt.length} chars)`);

    try {
      const { stdout, stderr } = await execFileP(this.claudePath, args, {
        encoding: 'utf-8',
        timeout: 120_000,
        maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env },
      });

      if (stderr) {
        const stderrStr = String(stderr).trim();
        if (stderrStr) logger.debug(`[claude-code:stderr] ${stderrStr.slice(0, 200)}`);
      }

      const result: ClaudeJsonResult = JSON.parse(String(stdout).trim());

      if (result.is_error) {
        throw new Error(result.result || 'Claude Code returned an error');
      }

      if (result.session_id) {
        this.sessionIds.set(request.conversationId, result.session_id);
      }

      if (result.total_cost_usd) {
        logger.debug(`[claude-code] Cost: $${result.total_cost_usd.toFixed(4)}`);
      }

      const reply = result.result || '';
      logger.info(`[claude-code] ← ${sessionTag}... (${reply.length} chars)`);
      return { text: reply };
    } catch (err) {
      const msg = (err as Error).message;
      logger.error(`[claude-code] Error: ${msg}`);

      // One-shot resume-recovery: if resume failed because the session
      // was lost, drop the session and try fresh — but only once.
      if (!retried && existingSession && isSessionLostError(msg)) {
        logger.info(`[claude-code] Session expired, starting fresh conversation`);
        this.sessionIds.delete(request.conversationId);
        return this.chatWithRetry(request, true);
      }

      throw err;
    }
  }

  async clearSession(conversationId: string): Promise<void> {
    this.sessionIds.delete(conversationId);
    await super.clearSession(conversationId);
  }
}

function isSessionLostError(msg: string): boolean {
  // Match specific phrases the CLI uses, not just "session" (too broad).
  const m = msg.toLowerCase();
  return (
    m.includes('no conversation found')
    || m.includes('session not found')
    || m.includes('invalid session')
    || m.includes('session expired')
  );
}
