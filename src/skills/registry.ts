/**
 * Skill registry - extensible slash-command system.
 * Skills are triggered via /command in WeChat messages.
 */
import type { ChatRequest, ChatResponse } from '../core/types.js';
import { logger } from '../utils/logger.js';

export interface Skill {
  name: string;
  description: string;
  execute(request: ChatRequest): Promise<ChatResponse>;
}

export class SkillRegistry {
  private skills = new Map<string, Skill>();

  register(skill: Skill): void {
    this.skills.set(skill.name, skill);
    logger.info(`Registered skill: /${skill.name} - ${skill.description}`);
  }

  unregister(name: string): void {
    this.skills.delete(name);
  }

  get(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  getAll(): Skill[] {
    return Array.from(this.skills.values());
  }

  has(name: string): boolean {
    return this.skills.has(name);
  }
}
