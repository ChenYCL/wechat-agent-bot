/**
 * OpenAI-compatible provider - supports OpenAI, Azure, and any
 * API-compatible service via baseUrl proxy/relay.
 *
 * Features:
 *  - Streaming or non-streaming completions
 *  - Vision input (image attachments)
 *  - MCP tool injection + tool-call loop (when a ToolBridge is attached)
 *  - Transient-error retry (429/5xx)
 *  - History rollback on hard failure (no orphan user turns)
 *  - Drops `temperature` for o1/o3 reasoning models that reject it
 */
import OpenAI from 'openai';
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from 'openai/resources/chat/completions';
import { AbstractProvider } from './base.js';
import type { ChatRequest, ChatResponse, ModelConfig } from '../core/types.js';
import { logger } from '../utils/logger.js';
import { readFileAsBase64 } from '../utils/media.js';
import { withRetry, modelRejectsTemperature } from './retry.js';

const MAX_TOOL_ITERATIONS = 5;

export class OpenAIProvider extends AbstractProvider {
  private client: OpenAI;

  constructor(config: ModelConfig) {
    super(config);
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl || 'https://api.openai.com/v1',
    });
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const history = await this.getHistory(request.conversationId);

    const userMessage = await this.buildUserMessage(request);
    history.push(userMessage as any);

    try {
      const text = await this.runConversation(history, {
        conversationId: request.conversationId,
        disableTools: request.disableTools === true,
      });
      history.push({ role: 'assistant', content: text });
      await this.trimHistory(request.conversationId);
      return { text };
    } catch (err) {
      // Rollback the user turn so a retry from the user doesn't see an
      // orphan user message in history (which often triggers 400s).
      this.popLastIfUser(history);
      logger.error(`OpenAI API error: ${(err as Error).message}`);
      throw err;
    }
  }

  private async buildUserMessage(request: ChatRequest): Promise<ChatCompletionMessageParam> {
    const content: any[] = [];
    if (request.text) content.push({ type: 'text', text: request.text });
    if (request.media?.filePath && request.media.type === 'image') {
      const base64 = await readFileAsBase64(request.media.filePath);
      const mime = request.media.mimeType || 'image/png';
      content.push({
        type: 'image_url',
        image_url: { url: `data:${mime};base64,${base64}` },
      });
    } else if (request.media) {
      content.push({
        type: 'text',
        text: `[Attachment: ${request.media.type} - ${request.media.filename || 'file'}]`,
      });
    }
    return {
      role: 'user',
      content: content.length === 1 && content[0].type === 'text' ? content[0].text : content,
    } as ChatCompletionMessageParam;
  }

  private buildMessages(history: Array<{ role: string; content: unknown }>): ChatCompletionMessageParam[] {
    const messages: ChatCompletionMessageParam[] = [];
    if (this.config.systemPrompt) {
      messages.push({ role: 'system', content: this.config.systemPrompt });
    }
    messages.push(...(sanitizeHistory(history) as any[]));
    return messages;
  }

  private buildTools(): ChatCompletionTool[] | undefined {
    const bridge = this.toolBridge;
    if (!bridge) return undefined;
    const tools = bridge.listTools();
    if (tools.length === 0) return undefined;
    return tools.map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description ?? '',
        parameters: (t.inputSchema as any) ?? { type: 'object', properties: {} },
      },
    }));
  }

  private commonParams() {
    const params: Record<string, unknown> = {
      model: this.config.model,
      max_tokens: this.config.maxTokens,
    };
    if (!modelRejectsTemperature(this.config.model)) {
      params.temperature = this.config.temperature ?? 0.7;
    }
    return params;
  }

  /** Main loop: handles tool-calls, streaming, retries. Returns final assistant text. */
  private async runConversation(history: Array<{ role: string; content: unknown }>, opts: { conversationId: string; disableTools: boolean }): Promise<string> {
    const tools = opts.disableTools ? undefined : this.buildTools();

    for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
      const messages = this.buildMessages(history);

      // If tools are involved we can't stream the final response (we need to
      // inspect tool_calls before continuing). Streaming is only used when
      // there are no tools AND it's the first/only iteration with streaming enabled.
      const useStream = !tools && this.config.stream !== false;

      if (useStream) {
        const text = await withRetry(() => this.chatStream(messages), { label: 'openai.stream' });
        return text;
      }

      const response = await withRetry(
        () => this.client.chat.completions.create({
          ...this.commonParams(),
          messages,
          ...(tools ? { tools, tool_choice: 'auto' as const } : {}),
        } as any),
        { label: 'openai.create' },
      );

      const choice = response.choices[0];
      const msg = choice?.message;
      if (!msg) return '';

      const toolCalls = (msg as any).tool_calls as Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> | undefined;

      if (!toolCalls || toolCalls.length === 0) {
        return msg.content || '';
      }

      // Record the assistant tool-call turn, then execute each tool and
      // append the result, then loop.
      history.push({ role: 'assistant', content: msg.content || null, ...(toolCalls ? { tool_calls: toolCalls } : {}) } as any);

      for (const tc of toolCalls) {
        let result: unknown;
        try {
          const args = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
          result = await this.toolBridge!.callTool(tc.function.name, args, { conversationId: opts.conversationId });
        } catch (err) {
          result = { error: (err as Error).message };
          logger.warn(`[tool] ${tc.function.name} failed: ${(err as Error).message}`);
        }
        history.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: typeof result === 'string' ? result : JSON.stringify(result),
        } as any);
      }
    }

    logger.warn(`[openai] Tool loop exceeded ${MAX_TOOL_ITERATIONS} iterations, returning empty`);
    return '';
  }

  private async chatStream(messages: ChatCompletionMessageParam[]): Promise<string> {
    const stream = await this.client.chat.completions.create({
      ...this.commonParams(),
      messages,
      stream: true,
    } as any);

    const chunks: string[] = [];
    for await (const chunk of stream as any) {
      const delta = chunk.choices?.[0]?.delta?.content;
      if (delta) chunks.push(delta);
    }
    return chunks.join('');
  }

  private popLastIfUser(history: Array<{ role: string; content: unknown }>): void {
    const last = history[history.length - 1] as { role?: string } | undefined;
    if (last?.role === 'user') history.pop();
  }
}

/**
 * Drop turns that would make the upstream API choke:
 *  - assistant turns with `content: null` AND no `tool_calls` (a
 *    legacy persisted tool-use turn whose tool_calls were truncated)
 *  - `tool` turns whose `tool_call_id` is missing/empty (orphans)
 *  - `tool` turns immediately following a sanitized-out assistant turn
 *
 * This keeps malformed legacy rows from breaking new conversations.
 */
function sanitizeHistory(history: Array<{ role: string; content: unknown; [k: string]: unknown }>): typeof history {
  const out: typeof history = [];
  let lastValidAssistantHadToolCalls = false;
  for (const m of history) {
    if (m.role === 'assistant') {
      const tc = (m as any).tool_calls;
      const hasTools = Array.isArray(tc) && tc.length > 0 && tc.every((c: any) => c?.id && c.id.length > 0);
      const hasText = m.content != null && m.content !== '';
      if (!hasTools && !hasText) continue;  // legacy ghost
      out.push(m);
      lastValidAssistantHadToolCalls = hasTools;
      continue;
    }
    if (m.role === 'tool') {
      const id = (m as any).tool_call_id;
      if (!id || typeof id !== 'string' || id.length === 0) continue;
      if (!lastValidAssistantHadToolCalls) continue;  // orphan
      out.push(m);
      continue;
    }
    // user / system / other roles: pass through
    out.push(m);
    lastValidAssistantHadToolCalls = false;
  }
  return out;
}
