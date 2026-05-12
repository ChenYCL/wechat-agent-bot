/**
 * Tests that the router flushes the outbox to the next inbound message
 * and only prompts about /lang once per conversation (persisted).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MessageRouter } from '../../src/core/router.js';
import { ProviderRegistry } from '../../src/providers/registry.js';
import { SkillRegistry } from '../../src/skills/registry.js';
import { MemoryManager } from '../../src/skills/builtin/memory.js';
import { createLangSkill } from '../../src/skills/builtin/lang.js';
import { HistoryStore } from '../../src/utils/history-store.js';
import type { ChatRequest, ChatResponse } from '../../src/core/types.js';

describe('MessageRouter — outbox + lang prompt', () => {
  let tmp: string;
  let store: HistoryStore;
  let manager: MemoryManager;
  let providers: ProviderRegistry;
  let skills: SkillRegistry;
  let router: MessageRouter;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'router-outbox-test-'));
    store = new HistoryStore(tmp);
    await store.init();
    manager = new MemoryManager(store);
    await manager.init();

    providers = new ProviderRegistry();
    providers.registerFactory('mock', (cfg) => ({
      id: cfg.id, name: cfg.name, config: cfg,
      async chat(req: ChatRequest): Promise<ChatResponse> {
        return { text: `echo:${req.text}` };
      },
      async clearSession() {},
    }));
    providers.addProvider({ id: 'm', name: 'm', provider: 'mock', model: 'x', apiKey: 'k' });

    skills = new SkillRegistry();
    skills.register(createLangSkill(manager));

    router = new MessageRouter(providers, skills, manager, store);
  });

  afterEach(async () => {
    await store.close();
    await rm(tmp, { recursive: true, force: true });
  });

  it('prepends queued outbox messages on the next inbound chat', async () => {
    store.enqueueOutbox('conv-1', { text: 'queued report content' }, 'task:x');
    // Set lang to skip the prompt.
    await manager.set('conv-1', '_lang', 'English');

    const res = await router.chat({ conversationId: 'conv-1', text: 'hi' });
    expect(res.text).toContain('queued report content');
    expect(res.text).toContain('echo:'); // provider still replied
  });

  it('only prompts for /lang once per conversation, even across new routers', async () => {
    const r1 = await router.chat({ conversationId: 'conv-2', text: 'hello' });
    expect(r1.text).toContain('💡 提示');

    // Same conversation, fresh router instance → must not prompt again.
    const router2 = new MessageRouter(providers, skills, manager, store);
    const r2 = await router2.chat({ conversationId: 'conv-2', text: 'second message' });
    expect(r2.text || '').not.toContain('💡 提示');
  });

  it('does not prompt for /lang once user has set a preference', async () => {
    await manager.set('conv-3', '_lang', 'Chinese');
    const r = await router.chat({ conversationId: 'conv-3', text: 'hi' });
    expect(r.text || '').not.toContain('💡 提示');
  });
});
