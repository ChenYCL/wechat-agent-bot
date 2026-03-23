import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ConfigStore } from '../../src/config/store.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('ConfigStore', () => {
  let tmpDir: string;
  let store: ConfigStore;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'wechat-bot-test-'));
    store = new ConfigStore(tmpDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('should load default config when no file exists', async () => {
    const config = await store.load();
    expect(config.server.port).toBe(3210);
    expect(Array.isArray(config.models)).toBe(true);
  });

  it('should save and reload config', async () => {
    await store.load();
    store.addModel({
      id: 'test-save',
      name: 'Test Save',
      provider: 'openai',
      model: 'gpt-4o',
      apiKey: 'sk-test',
    });
    await store.save();

    const store2 = new ConfigStore(tmpDir);
    const config = await store2.load();
    // Should contain the model we just added
    expect(config.models.find((m) => m.id === 'test-save')).toBeDefined();
  });

  it('should add and remove models', async () => {
    await store.load();
    // Clear any models added from env
    const baseCount = store.get().models.length;
    store.addModel({ id: 'm1', name: 'M1', provider: 'openai', model: 'gpt-4o', apiKey: 'key' });
    store.addModel({ id: 'm2', name: 'M2', provider: 'anthropic', model: 'claude', apiKey: 'key' });
    expect(store.get().models).toHaveLength(baseCount + 2);

    store.removeModel('m1');
    expect(store.get().models).toHaveLength(baseCount + 1);
    expect(store.get().models.find((m) => m.id === 'm2')).toBeDefined();
  });

  it('should add and remove scheduled tasks', async () => {
    await store.load();
    store.addTask({
      id: 't1',
      name: 'Report',
      cron: '0 9 * * *',
      enabled: true,
      type: 'report',
      config: { topic: 'AI' },
    });
    expect(store.get().scheduledTasks).toHaveLength(1);

    store.removeTask('t1');
    expect(store.get().scheduledTasks).toHaveLength(0);
  });
});
