/**
 * Anthropic Claude provider - supports Claude models with optional
 * baseUrl for proxy/relay.
 *
 * Features:
 *  - Streaming or non-streaming completions
 *  - Vision input (image attachments)
 *  - MCP tool injection + tool_use loop
 *  - Transient-error retry (429/5xx)
 *  - History rollback on hard failure
 */
import Anthropic from '@anthropic-ai/sdk';
import { AbstractProvider } from './base.js';
import type { ChatRequest, ChatResponse, ModelConfig } from '../core/types.js';
import { logger } from '../utils/logger.js';
import { readFileAsBase64 } from '../utils/media.js';
import { withRetry } from './retry.js';

const MAX_TOOL_ITERATIONS = 5;

export class AnthropicProvider extends AbstractProvider {
  private client: Anthropic;

  constructor(config: ModelConfig) {
    super(config);
    this.client = new Anthropic({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
    });
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const history = await this.getHistory(request.conversationId);

    const userContent = await this.buildUserContent(request);
    history.push({ role: 'user', content: userContent as any });

    try {
      const text = await this.runConversation(history, {
        conversationId: request.conversationId,
        disableTools: request.disableTools === true,
      });
      history.push({ role: 'assistant', content: text });
      await this.trimHistory(request.conversationId);
      return { text };
    } catch (err) {
      this.popLastIfUser(history);
      logger.error(`Anthropic API error: ${(err as Error).message}`);
      throw err;
    }
  }

  private async buildUserContent(request: ChatRequest): Promise<Anthropic.ContentBlockParam[]> {
    const content: Anthropic.ContentBlockParam[] = [];
    if (request.text) content.push({ type: 'text', text: request.text });
    if (request.media?.filePath && request.media.type === 'image') {
      const base64 = await readFileAsBase64(request.media.filePath);
      const mime = (request.media.mimeType || 'image/png') as Anthropic.Base64ImageSource['media_type'];
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: mime, data: base64 },
      });
    } else if (request.media) {
      content.push({
        type: 'text',
        text: `[Attachment: ${request.media.type} - ${request.media.filename || 'file'}]`,
      });
    }
    return content;
  }

  private buildTools(): Anthropic.Tool[] | undefined {
    const bridge = this.toolBridge;
    if (!bridge) return undefined;
    const tools = bridge.listTools();
    if (tools.length === 0) return undefined;
    return tools.map((t) => ({
      name: t.name,
      description: t.description ?? '',
      input_schema: (t.inputSchema as any) ?? { type: 'object', properties: {} },
    }));
  }

  private async runConversation(history: Array<{ role: string; content: unknown }>, opts: { conversationId: string; disableTools: boolean }): Promise<string> {
    const tools = opts.disableTools ? undefined : this.buildTools();

    for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
      // Stream only when no tools (we need the full response to inspect tool_use).
      const useStream = !tools && this.config.stream !== false;
      if (useStream) {
        return await withRetry(() => this.chatStream(history), { label: 'anthropic.stream' });
      }

      const response = await withRetry(
        () => this.client.messages.create({
          model: this.config.model,
          max_tokens: this.config.maxTokens ?? 4096,
          system: this.config.systemPrompt || undefined,
          messages: history as any[],
          temperature: this.config.temperature ?? 0.7,
          ...(tools ? { tools } : {}),
        }),
        { label: 'anthropic.create' },
      );

      const blocks = response.content;
      const toolUses = blocks.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');

      if (toolUses.length === 0) {
        return blocks
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('');
      }

      // Append assistant tool_use turn verbatim, then run each tool and
      // append a user tool_result turn.
      history.push({ role: 'assistant', content: blocks as any });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const use of toolUses) {
        let result: unknown;
        let isError = false;
        try {
          result = await this.toolBridge!.callTool(use.name, (use.input as Record<string, unknown>) || {}, { conversationId: opts.conversationId });
        } catch (err) {
          isError = true;
          result = { error: (err as Error).message };
          logger.warn(`[tool] ${use.name} failed: ${(err as Error).message}`);
        }
        toolResults.push({
          type: 'tool_result',
          tool_use_id: use.id,
          content: typeof result === 'string' ? result : JSON.stringify(result),
          is_error: isError,
        });
      }
      history.push({ role: 'user', content: toolResults as any });
    }

    logger.warn(`[anthropic] Tool loop exceeded ${MAX_TOOL_ITERATIONS} iterations, returning empty`);
    return '';
  }

  private async chatStream(history: Array<{ role: string; content: unknown }>): Promise<string> {
    const stream = this.client.messages.stream({
      model: this.config.model,
      max_tokens: this.config.maxTokens ?? 4096,
      system: this.config.systemPrompt || undefined,
      messages: history as any[],
      temperature: this.config.temperature ?? 0.7,
    });

    const chunks: string[] = [];
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        chunks.push(event.delta.text);
      }
    }
    return chunks.join('');
  }

  private popLastIfUser(history: Array<{ role: string; content: unknown }>): void {
    const last = history[history.length - 1] as { role?: string } | undefined;
    if (last?.role === 'user') history.pop();
  }
}
