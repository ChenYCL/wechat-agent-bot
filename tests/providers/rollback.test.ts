/**
 * Verifies that providers roll back the orphan user-turn when the upstream
 * API call fails, so a subsequent retry doesn't see two consecutive user
 * messages (which the OpenAI / Anthropic APIs reject).
 *
 * We bypass network entirely by stubbing the SDK methods at runtime.
 */
import { describe, it, expect } from 'vitest';
import { OpenAIProvider } from '../../src/providers/openai.js';
import { AnthropicProvider } from '../../src/providers/anthropic.js';

describe('OpenAIProvider history rollback', () => {
  it('removes the user turn from history when the API call fails', async () => {
    const p = new OpenAIProvider({
      id: 'p1', name: 'p1', provider: 'openai', model: 'gpt-4o', apiKey: 'k',
      stream: false,
    });
    // Stub the underlying client to throw a non-transient error.
    (p as any).client = {
      chat: {
        completions: {
          create: async () => {
            const e = new Error('401 Unauthorized');
            (e as any).status = 401;
            throw e;
          },
        },
      },
    };

    await expect(p.chat({ conversationId: 'c1', text: 'hello' })).rejects.toThrow('401');

    // Inspect internal history map — the failed user turn must have been popped.
    const history = (p as any).histories.get('c1') as Array<{ role: string }>;
    expect(history).toBeDefined();
    expect(history.length).toBe(0);
  });
});

describe('AnthropicProvider history rollback', () => {
  it('removes the user turn from history when the API call fails', async () => {
    const p = new AnthropicProvider({
      id: 'p2', name: 'p2', provider: 'anthropic', model: 'claude-sonnet-4', apiKey: 'k',
      stream: false,
    });
    (p as any).client = {
      messages: {
        create: async () => {
          const e = new Error('401 Unauthorized');
          (e as any).status = 401;
          throw e;
        },
      },
    };

    await expect(p.chat({ conversationId: 'c1', text: 'hello' })).rejects.toThrow('401');

    const history = (p as any).histories.get('c1') as Array<{ role: string }>;
    expect(history).toBeDefined();
    expect(history.length).toBe(0);
  });
});
