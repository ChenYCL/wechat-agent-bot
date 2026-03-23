/**
 * Built-in /translate skill — translate text using the active AI provider.
 * Usage: /translate en hello world  (translate "hello world" to English)
 * Usage: /translate 中文 I love coding
 */
import type { Skill } from '../registry.js';
import type { ChatRequest, ChatResponse } from '../../core/types.js';
import type { ProviderRegistry } from '../../providers/registry.js';

export function createTranslateSkill(providers: ProviderRegistry): Skill {
  return {
    name: 'translate',
    description: 'Translate text. Usage: /translate <lang> <text>',
    async execute(request: ChatRequest): Promise<ChatResponse> {
      const text = request.text?.trim() || '';
      const spaceIdx = text.indexOf(' ');
      if (!text || spaceIdx < 0) {
        return { text: 'Usage: /translate <target-language> <text>\nExample: /translate 中文 Hello world' };
      }

      const targetLang = text.slice(0, spaceIdx);
      const sourceText = text.slice(spaceIdx + 1).trim();

      const provider = providers.getActive();
      if (!provider) return { text: '⚠️ No active AI provider' };

      try {
        const result = await provider.chat({
          conversationId: `translate-${Date.now()}`,
          text: `Translate the following text to ${targetLang}. Only return the translation, nothing else:\n\n${sourceText}`,
        });
        return { text: `🌐 ${targetLang}:\n${result.text}` };
      } catch (err) {
        return { text: `⚠️ Translation failed: ${(err as Error).message}` };
      }
    },
  };
}
