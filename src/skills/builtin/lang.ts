/**
 * Built-in /lang skill — set preferred reply language.
 *
 * Usage:
 *   /lang 中文        — all replies in Chinese
 *   /lang English     — all replies in English
 *   /lang 日本語      — all replies in Japanese
 *   /lang auto        — auto-detect (follow user's language)
 *   /lang             — show current setting
 */
import type { Skill } from '../registry.js';
import type { ChatRequest, ChatResponse } from '../../core/types.js';
import type { MemoryManager } from './memory.js';

export const LANG_MEMORY_KEY = '_lang';

export function createLangSkill(memoryManager: MemoryManager): Skill {
  return {
    name: 'lang',
    description: 'Set reply language. Usage: /lang 中文 | English | auto',
    async execute(request: ChatRequest): Promise<ChatResponse> {
      const arg = request.text?.trim();

      if (!arg) {
        const mem = await memoryManager.get(request.conversationId, LANG_MEMORY_KEY);
        const current = mem?.content || 'auto';
        return {
          text: `🌐 当前语言偏好: ${current}\n\n💡 设置方式:\n/lang 中文\n/lang English\n/lang 日本語\n/lang auto（自动跟随）`,
        };
      }

      if (arg === 'auto') {
        await memoryManager.delete(request.conversationId, LANG_MEMORY_KEY);
        return { text: '🌐 已切换为自动语言模式（跟随你发消息的语言）' };
      }

      await memoryManager.set(request.conversationId, LANG_MEMORY_KEY, arg);
      return { text: `🌐 语言偏好已设置: ${arg}\n后续 AI 回复将使用 ${arg}` };
    },
  };
}

/**
 * Get the language preference for a conversation.
 * Returns null if not set (auto mode).
 */
export async function getLangPreference(
  memoryManager: MemoryManager,
  conversationId: string,
): Promise<string | null> {
  const mem = await memoryManager.get(conversationId, LANG_MEMORY_KEY);
  return mem?.content || null;
}
