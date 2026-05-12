/**
 * Built-in /model skill - switch active AI model.
 */
import type { Skill } from '../registry.js';
import type { ChatRequest, ChatResponse } from '../../core/types.js';
import type { ProviderAccess } from '../provider-access.js';

export function createModelSkill(access: ProviderAccess): Skill {
  return {
    name: 'model',
    description: 'Switch AI model. Usage: /model [id] or /model list',
    async execute(request: ChatRequest): Promise<ChatResponse> {
      const arg = request.text?.trim();

      if (!arg || arg === 'list') {
        const list = access.list(request.conversationId);
        if (list.length === 0) {
          return { text: '⚠️ 你还没有任何模型\n\n请在 WebUI 中添加（OpenAI / Anthropic / 国内大模型 API）' };
        }
        const lines = list.map((p) => {
          const icon = p.active ? '▶️' : '  ';
          const tag = p.active ? ' ✅' : '';
          return `${icon} ${p.id}\n   ${p.name} (${p.model})${tag}`;
        });
        return { text: `━━ 可用模型 ━━\n\n${lines.join('\n\n')}\n\n💡 发送 /model <id> 切换` };
      }

      const result = access.setActive(request.conversationId, arg);
      if (!result.ok || !result.provider) {
        return { text: `⚠️ 切换失败: ${result.error ?? 'unknown'}\n💡 发送 /model list 查看可用模型` };
      }
      return { text: `✅ 已切换到: ${result.provider.name}\n📌 模型: ${result.provider.config.model}` };
    },
  };
}
