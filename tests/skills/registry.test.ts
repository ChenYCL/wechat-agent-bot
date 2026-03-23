import { describe, it, expect } from 'vitest';
import { SkillRegistry } from '../../src/skills/registry.js';
import type { ChatRequest, ChatResponse } from '../../src/core/types.js';

describe('SkillRegistry', () => {
  it('should register and retrieve a skill', () => {
    const registry = new SkillRegistry();
    registry.register({
      name: 'test',
      description: 'Test skill',
      execute: async (_req: ChatRequest): Promise<ChatResponse> => ({ text: 'ok' }),
    });

    expect(registry.has('test')).toBe(true);
    expect(registry.get('test')?.name).toBe('test');
  });

  it('should list all skills', () => {
    const registry = new SkillRegistry();
    registry.register({
      name: 'a',
      description: 'A',
      execute: async () => ({ text: '' }),
    });
    registry.register({
      name: 'b',
      description: 'B',
      execute: async () => ({ text: '' }),
    });

    expect(registry.getAll()).toHaveLength(2);
  });

  it('should unregister a skill', () => {
    const registry = new SkillRegistry();
    registry.register({
      name: 'temp',
      description: 'Temp',
      execute: async () => ({ text: '' }),
    });
    registry.unregister('temp');
    expect(registry.has('temp')).toBe(false);
  });
});
