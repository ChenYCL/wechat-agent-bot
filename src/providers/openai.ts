/**
 * OpenAI-compatible provider - supports OpenAI, Azure, and any
 * API-compatible service via baseUrl proxy/relay.
 */
import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { AbstractProvider } from './base.js';
import type { ChatRequest, ChatResponse, ModelConfig } from '../core/types.js';
import { logger } from '../utils/logger.js';
import { readFileAsBase64 } from '../utils/media.js';

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

    // Build user message content
    const content: ChatCompletionMessageParam['content'][] = [];
    if (request.text) {
      content.push({ type: 'text', text: request.text } as any);
    }
    if (request.media?.filePath && request.media.type === 'image') {
      const base64 = await readFileAsBase64(request.media.filePath);
      const mime = request.media.mimeType || 'image/png';
      content.push({
        type: 'image_url',
        image_url: { url: `data:${mime};base64,${base64}` },
      } as any);
    } else if (request.media) {
      content.push({
        type: 'text',
        text: `[Attachment: ${request.media.type} - ${request.media.filename || 'file'}]`,
      } as any);
    }

    const userMessage: ChatCompletionMessageParam = {
      role: 'user',
      content: content.length === 1 && (content[0] as any).type === 'text'
        ? (content[0] as any).text
        : content as any,
    };

    history.push(userMessage as any);

    const messages: ChatCompletionMessageParam[] = [];
    if (this.config.systemPrompt) {
      messages.push({ role: 'system', content: this.config.systemPrompt });
    }
    messages.push(...history as any[]);

    try {
      let text: string;

      if (this.config.stream !== false) {
        // Stream mode (default on) — faster first token, collect full text
        text = await this.chatStream(messages);
      } else {
        const response = await this.client.chat.completions.create({
          model: this.config.model,
          messages,
          temperature: this.config.temperature ?? 0.7,
          max_tokens: this.config.maxTokens,
        });
        text = response.choices[0]?.message?.content || '';
      }

      history.push({ role: 'assistant', content: text });
      await this.trimHistory(request.conversationId);

      return { text };
    } catch (err) {
      logger.error(`OpenAI API error: ${(err as Error).message}`);
      throw err;
    }
  }

  private async chatStream(messages: ChatCompletionMessageParam[]): Promise<string> {
    const stream = await this.client.chat.completions.create({
      model: this.config.model,
      messages,
      temperature: this.config.temperature ?? 0.7,
      max_tokens: this.config.maxTokens,
      stream: true,
    });

    const chunks: string[] = [];
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) chunks.push(delta);
    }
    return chunks.join('');
  }
}
