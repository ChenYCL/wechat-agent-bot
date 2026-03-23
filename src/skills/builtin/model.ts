/**
 * Built-in /model skill - switch active AI model.
 */
import type { Skill } from '../registry.js';
import type { ChatRequest, ChatResponse } from '../../core/types.js';
import type { ProviderRegistry } from '../../providers/registry.js';

export function createModelSkill(registry: ProviderRegistry): Skill {
  return {
    name: 'model',
    description: 'Switch AI model. Usage: /model [id] or /model list',
    async execute(request: ChatRequest): Promise<ChatResponse> {
      const arg = request.text?.trim();

      if (!arg || arg === 'list') {
        const providers = registry.getAll();
        const active = registry.getActive();
        const lines = providers.map((p) => {
          const isActive = p.id === active?.id;
          const icon = isActive ? '▶️' : '  ';
          const tag = isActive ? ' ✅' : '';
          return `${icon} ${p.id}\n   ${p.name} (${p.config.model})${tag}`;
        });
        return { text: `━━ 可用模型 ━━\n\n${lines.join('\n\n')}\n\n💡 发送 /model <id> 切换` };
      }

      try {
        registry.setActive(arg);
        const p = registry.getActive()!;
        return { text: `✅ 已切换到: ${p.name}\n📌 模型: ${p.config.model}` };
      } catch (err) {
        return { text: `⚠️ 切换失败: ${(err as Error).message}\n💡 发送 /model list 查看可用模型` };
      }
    },
  };
}
