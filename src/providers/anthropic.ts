/**
 * Anthropic Claude provider - supports Claude models with
 * optional baseUrl for proxy/relay.
 */
import Anthropic from '@anthropic-ai/sdk';
import { AbstractProvider } from './base.js';
import type { ChatRequest, ChatResponse, ModelConfig } from '../core/types.js';
import { logger } from '../utils/logger.js';
import { readFileAsBase64 } from '../utils/media.js';

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

    // Build user message content
    const content: Anthropic.ContentBlockParam[] = [];
    if (request.text) {
      content.push({ type: 'text', text: request.text });
    }
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

    history.push({ role: 'user', content: content as any });

    try {
      let text: string;

      if (this.config.stream !== false) {
        text = await this.chatStream(history);
      } else {
        const response = await this.client.messages.create({
          model: this.config.model,
          max_tokens: this.config.maxTokens ?? 4096,
          system: this.config.systemPrompt || undefined,
          messages: history as any[],
          temperature: this.config.temperature ?? 0.7,
        });
        text = response.content
          .filter((block): block is Anthropic.TextBlock => block.type === 'text')
          .map((block) => block.text)
          .join('');
      }

      history.push({ role: 'assistant', content: text });
      await this.trimHistory(request.conversationId);

      return { text };
    } catch (err) {
      logger.error(`Anthropic API error: ${(err as Error).message}`);
      throw err;
    }
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
}
