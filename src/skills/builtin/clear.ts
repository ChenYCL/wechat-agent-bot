/**
 * Built-in /clear skill - clear conversation history.
 */
import type { Skill } from '../registry.js';
import type { ChatRequest, ChatResponse } from '../../core/types.js';
import type { ProviderAccess } from '../provider-access.js';

export function createClearSkill(access: ProviderAccess): Skill {
  return {
    name: 'clear',
    description: 'Clear conversation history',
    async execute(request: ChatRequest): Promise<ChatResponse> {
      const provider = access.getActive(request.conversationId);
      if (provider?.clearSession) {
        await provider.clearSession(request.conversationId);
      }
      return { text: '🗑️ 对话记录已清空' };
    },
  };
}
