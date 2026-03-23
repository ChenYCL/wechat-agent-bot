import { describe, it, expect, beforeEach } from 'vitest';
import { ProviderRegistry } from '../../src/providers/registry.js';
import type { ModelConfig, ChatRequest, ChatResponse } from '../../src/core/types.js';

const mockConfig: ModelConfig = {
  id: 'test-1',
  name: 'Test Provider',
  provider: 'openai',
  model: 'gpt-4o',
  apiKey: 'sk-test',
  baseUrl: 'https://test.example.com/v1',
};

describe('ProviderRegistry', () => {
  let registry: ProviderRegistry;

  beforeEach(() => {
    registry = new ProviderRegistry();
  });

  it('should return null when no providers registered', () => {
    expect(registry.getActive()).toBeNull();
  });

  it('should list available provider types', () => {
    const types = registry.availableTypes();
    expect(types).toContain('openai');
    expect(types).toContain('anthropic');
  });

  it('should register a provider and set it as active', () => {
    registry.addProvider(mockConfig);
    const active = registry.getActive();
    expect(active).not.toBeNull();
    expect(active!.id).toBe('test-1');
  });

  it('should switch active provider', () => {
    registry.addProvider(mockConfig);
    registry.addProvider({ ...mockConfig, id: 'test-2', name: 'Second' });
    registry.setActive('test-2');
    expect(registry.getActive()!.id).toBe('test-2');
  });

  it('should throw on unknown provider type', () => {
    expect(() => {
      registry.addProvider({ ...mockConfig, provider: 'nonexistent' });
    }).toThrow('Unknown provider type');
  });

  it('should remove a provider', () => {
    registry.addProvider(mockConfig);
    registry.removeProvider('test-1');
    expect(registry.getActive()).toBeNull();
  });

  it('should support custom provider factories', () => {
    registry.registerFactory('custom', (config) => ({
      id: config.id,
      name: config.name,
      config,
      chat: async (_req: ChatRequest): Promise<ChatResponse> => ({ text: 'custom' }),
      clearSession: async () => {},
    }));

    registry.addProvider({ ...mockConfig, provider: 'custom' });
    expect(registry.getActive()!.id).toBe('test-1');
    expect(registry.availableTypes()).toContain('custom');
  });
});
