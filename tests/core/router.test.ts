import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MessageRouter } from '../../src/core/router.js';
import { ProviderRegistry } from '../../src/providers/registry.js';
import { SkillRegistry } from '../../src/skills/registry.js';
import type { ChatRequest, ChatResponse } from '../../src/core/types.js';

describe('MessageRouter', () => {
  let router: MessageRouter;
  let providers: ProviderRegistry;
  let skills: SkillRegistry;

  beforeEach(() => {
    providers = new ProviderRegistry();
    skills = new SkillRegistry();
    router = new MessageRouter(providers, skills);
  });

  it('should return error when no provider configured', async () => {
    const result = await router.chat({ conversationId: 'test', text: 'hello' });
    expect(result.text).toContain('未配置');
  });

  it('should route slash commands to skills', async () => {
    skills.register({
      name: 'ping',
      description: 'Ping test',
      execute: async (_req: ChatRequest): Promise<ChatResponse> => ({ text: 'pong' }),
    });

    const result = await router.chat({ conversationId: 'test', text: '/ping' });
    expect(result.text).toBe('pong');
  });

  it('should pass args to skill', async () => {
    skills.register({
      name: 'echo',
      description: 'Echo back',
      execute: async (req: ChatRequest): Promise<ChatResponse> => ({ text: req.text || '' }),
    });

    const result = await router.chat({ conversationId: 'test', text: '/echo hello world' });
    expect(result.text).toBe('hello world');
  });

  it('should fall through to provider for non-skill messages', async () => {
    // Register a mock custom provider
    providers.registerFactory('mock', (config) => ({
      id: config.id,
      name: config.name,
      config,
      chat: async (_req: ChatRequest): Promise<ChatResponse> => ({ text: 'mock reply' }),
    }));
    providers.addProvider({
      id: 'mock-1',
      name: 'Mock',
      provider: 'mock',
      model: 'test',
      apiKey: 'key',
    });

    const result = await router.chat({ conversationId: 'test', text: 'hello' });
    expect(result.text).toBe('mock reply');
  });
});
