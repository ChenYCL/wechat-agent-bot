/**
 * Built-in /clear skill - clear conversation history.
 */
import type { Skill } from '../registry.js';
import type { ChatRequest, ChatResponse } from '../../core/types.js';
import type { ProviderRegistry } from '../../providers/registry.js';

export function createClearSkill(registry: ProviderRegistry): Skill {
  return {
    name: 'clear',
    description: 'Clear conversation history',
    async execute(request: ChatRequest): Promise<ChatResponse> {
      const provider = registry.getActive();
      if (provider?.clearSession) {
        await provider.clearSession(request.conversationId);
      }
      return { text: '🗑️ 对话记录已清空' };
    },
  };
}
