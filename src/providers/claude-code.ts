/**
 * Claude Code Provider — pipes WeChat messages through `claude -p`.
 *
 * Reuses your Claude Code subscription (Max/Pro/Team). No API key needed.
 *
 * Multi-turn conversation:
 *   1. First message: `echo "msg" | claude -p --output-format json`
 *   2. Get session_id from response
 *   3. Next messages: `echo "msg" | claude -p --resume <session_id>`
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
    let prompt = request.text || '';
    if (request.media) {
      prompt = `[Attachment: ${request.media.type} - ${request.media.filename || 'file'}]\n${prompt}`;
    }

    const args = [
      '-p',
      '--output-format', 'json',
      '--dangerously-skip-permissions',
    ];

    // Resume existing session for multi-turn
    const existingSession = this.sessionIds.get(request.conversationId);
    if (existingSession) {
      args.push('--resume', existingSession);
    } else {
      // New conversation: set model and system prompt
      args.push('--model', this.model);
      args.push('--system-prompt', this.systemPrompt);
    }

    if (this.allowedTools.length > 0) {
      args.push('--allowedTools', ...this.allowedTools);
    }

    // Pass prompt as CLI argument (not stdin — stdin pipe is unreliable with execFile)
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

      const result: ClaudeJsonResult = JSON.parse((stdout as string).trim());

      if (result.is_error) {
        throw new Error(result.result || 'Claude Code returned an error');
      }

      // Save session for multi-turn
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

      // If resume failed, clear session and retry as new conversation
      if (existingSession && (msg.includes('No conversation found') || msg.includes('session'))) {
        logger.info(`[claude-code] Session expired, starting new conversation`);
        this.sessionIds.delete(request.conversationId);
        return this.chat(request);
      }

      throw err;
    }
  }

  async clearSession(conversationId: string): Promise<void> {
    this.sessionIds.delete(conversationId);
    await super.clearSession(conversationId);
  }
}
