/**
 * Built-in /help skill - lists available skills and commands.
 */
import type { Skill } from '../registry.js';
import type { ChatRequest, ChatResponse } from '../../core/types.js';

const SKILL_ICONS: Record<string, string> = {
  help: '📋', model: '🤖', clear: '🗑️',
  remember: '💾', recall: '🔍', forget: '❌',
};

export function createHelpSkill(getSkills: () => Skill[]): Skill {
  return {
    name: 'help',
    description: 'Show available commands',
    async execute(_request: ChatRequest): Promise<ChatResponse> {
      const skills = getSkills();
      const lines = skills.map((s) => {
        const icon = SKILL_ICONS[s.name] || '⚡';
        return `${icon} /${s.name}\n   ${s.description}`;
      });
      return {
        text: `━━ WeChat Agent 指令 ━━\n\n${lines.join('\n\n')}`,
      };
    },
  };
}
