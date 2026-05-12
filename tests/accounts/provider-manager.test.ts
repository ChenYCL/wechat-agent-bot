/**
 * UserProviderManager — per-user model isolation + activeness.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { HistoryStore } from '../../src/utils/history-store.js';
import { AuthStore } from '../../src/auth/store.js';
import { UserProviderManager } from '../../src/accounts/provider-manager.js';

describe('UserProviderManager', () => {
  let tmp: string;
  let store: HistoryStore;
  let upm: UserProviderManager;
  let aliceId: string;
  let bobId: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'upm-test-'));
    store = new HistoryStore(tmp);
    await store.init();
    const auth = new AuthStore(store);
    aliceId = auth.signup('alice', 'pass-1234')!.id;
    bobId = auth.signup('bob', 'pass-1234')!.id;
    upm = new UserProviderManager(store);
  });

  afterEach(async () => {
    await store.close();
    await rm(tmp, { recursive: true, force: true });
  });

  it('isolates models between users', () => {
    upm.addModel(aliceId, {
      name: 'Alice GPT', provider: 'openai', model: 'gpt-4o', apiKey: 'sk-a',
      baseUrl: 'https://x.example/v1', isActive: true,
    });
    upm.addModel(bobId, {
      name: 'Bob Claude', provider: 'anthropic', model: 'claude-sonnet-4', apiKey: 'sk-b',
      isActive: true,
    });
    expect(upm.listModels(aliceId)).toHaveLength(1);
    expect(upm.listModels(bobId)).toHaveLength(1);
    expect(upm.listModels(aliceId)[0].apiKey).toBe('sk-a');
    expect(upm.listModels(bobId)[0].apiKey).toBe('sk-b');
  });

  it('getActive returns the user\'s active provider, not anyone else\'s', () => {
    upm.addModel(aliceId, {
      name: 'A', provider: 'openai', model: 'gpt-4o', apiKey: 'sk-a',
      baseUrl: 'https://x.example/v1', isActive: true,
    });
    upm.addModel(bobId, {
      name: 'B', provider: 'openai', model: 'gpt-4o-mini', apiKey: 'sk-b',
      baseUrl: 'https://y.example/v1', isActive: true,
    });
    const aliceProv = upm.getActive(aliceId);
    const bobProv = upm.getActive(bobId);
    expect(aliceProv?.config.apiKey).toBe('sk-a');
    expect(bobProv?.config.apiKey).toBe('sk-b');
  });

  it('setActive switches the active flag atomically', () => {
    upm.addModel(aliceId, {
      name: 'm1', provider: 'openai', model: 'gpt-4o', apiKey: 'k',
      baseUrl: 'https://x.example/v1', isActive: true,
    });
    const m2 = upm.addModel(aliceId, {
      name: 'm2', provider: 'openai', model: 'gpt-4o-mini', apiKey: 'k',
      baseUrl: 'https://x.example/v1',
    });
    expect(upm.getActive(aliceId)?.config.model).toBe('gpt-4o');
    upm.setActive(aliceId, m2.id);
    expect(upm.getActive(aliceId)?.config.model).toBe('gpt-4o-mini');
  });

  it('returns null when the user has no models', () => {
    expect(upm.getActive('00000000-0000-0000-0000-000000000000')).toBeNull();
    expect(upm.listModels('00000000-0000-0000-0000-000000000000')).toEqual([]);
  });

  it('removeModel invalidates the cache', () => {
    const m = upm.addModel(aliceId, {
      name: 'm', provider: 'openai', model: 'gpt-4o', apiKey: 'k',
      baseUrl: 'https://x.example/v1', isActive: true,
    });
    expect(upm.getActive(aliceId)).not.toBeNull();
    upm.removeModel(aliceId, m.id);
    expect(upm.getActive(aliceId)).toBeNull();
  });
});
