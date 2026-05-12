/**
 * Built-in /summary skill — summarize a URL or long text.
 * Usage: /summary https://example.com/article
 * Usage: /summary <paste long text here>
 */
import type { Skill } from '../registry.js';
import type { ChatRequest, ChatResponse } from '../../core/types.js';
import type { ProviderAccess } from '../provider-access.js';

export function createSummarySkill(access: ProviderAccess): Skill {
  return {
    name: 'summary',
    description: 'Summarize a URL or text. Usage: /summary <url or text>',
    async execute(request: ChatRequest): Promise<ChatResponse> {
      const text = request.text?.trim() || '';
      if (!text) return { text: 'Usage: /summary <URL or text>' };

      const provider = access.getActive(request.conversationId);
      if (!provider) return { text: '⚠️ No active AI provider' };

      let content = text;

      // If it's a URL, try to fetch it
      if (text.startsWith('http://') || text.startsWith('https://')) {
        try {
          const res = await fetch(text, {
            signal: AbortSignal.timeout(15_000),
            headers: { 'User-Agent': 'WeChat-Agent-Bot/0.1' },
          });
          if (res.ok) {
            const html = await res.text();
            content = html
              .replace(/<script[\s\S]*?<\/script>/gi, '')
              .replace(/<style[\s\S]*?<\/style>/gi, '')
              .replace(/<[^>]+>/g, ' ')
              .replace(/\s+/g, ' ')
              .trim()
              .slice(0, 8000);
          }
        } catch {
          return { text: `⚠️ Failed to fetch URL: ${text}` };
        }
      }

      try {
        const result = await provider.chat({
          conversationId: `__summary__${Date.now()}`,
          text: `Please summarize the following content concisely in the same language it's written in. Use bullet points:\n\n${content.slice(0, 8000)}`,
          disableTools: true,
        });
        return { text: `📝 Summary:\n${result.text}` };
      } catch (err) {
        return { text: `⚠️ Summary failed: ${(err as Error).message}` };
      }
    },
  };
}
