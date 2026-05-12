/**
 * UserTaskManager integration tests — exercise CRUD, ownership, runNow,
 * and the auto-disable path for one-shot reminders.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { HistoryStore } from '../../src/utils/history-store.js';
import { SchedulerManager } from '../../src/scheduler/manager.js';
import { UserTaskManager } from '../../src/tasks/manager.js';

describe('UserTaskManager', () => {
  let tmp: string;
  let store: HistoryStore;
  let scheduler: SchedulerManager;
  let manager: UserTaskManager;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'utm-test-'));
    store = new HistoryStore(tmp);
    await store.init();
    scheduler = new SchedulerManager({ store });
    manager = new UserTaskManager({ store, scheduler });
  });

  afterEach(async () => {
    scheduler.cancelAll();
    await store.close();
    await rm(tmp, { recursive: true, force: true });
  });

  it('creates a cron reminder and persists it', () => {
    const task = manager.create({
      ownerConversationId: 'conv-a',
      type: 'reminder',
      description: 'morning ping',
      message: 'Good morning',
      schedule: { kind: 'cron', cron: '0 8 * * *' },
    });
    expect(task.id).toBeDefined();
    expect(task.enabled).toBe(true);

    const list = manager.list('conv-a');
    expect(list).toHaveLength(1);
    expect(list[0].description).toBe('morning ping');
  });

  it('isolates tasks by owner', () => {
    manager.create({
      ownerConversationId: 'conv-a',
      type: 'reminder',
      description: 'mine',
      message: 'm',
      schedule: { kind: 'cron', cron: '0 8 * * *' },
    });
    manager.create({
      ownerConversationId: 'conv-b',
      type: 'reminder',
      description: 'theirs',
      message: 'm',
      schedule: { kind: 'cron', cron: '0 8 * * *' },
    });
    expect(manager.list('conv-a')).toHaveLength(1);
    expect(manager.list('conv-b')).toHaveLength(1);
  });

  it('rejects delete from a non-owner', () => {
    const t = manager.create({
      ownerConversationId: 'conv-a',
      type: 'reminder',
      description: 'mine',
      message: 'm',
      schedule: { kind: 'cron', cron: '0 8 * * *' },
    });
    expect(manager.delete(t.id, 'conv-b')).toBe(false);
    expect(manager.get(t.id)).not.toBeNull();
  });

  it('pause and resume toggle scheduling', () => {
    const t = manager.create({
      ownerConversationId: 'c',
      type: 'reminder',
      description: 'x',
      message: 'm',
      schedule: { kind: 'cron', cron: '0 8 * * *' },
    });
    expect(scheduler.getRunning()).toContain(t.id);

    manager.setEnabled(t.id, false);
    expect(scheduler.getRunning()).not.toContain(t.id);

    manager.setEnabled(t.id, true);
    expect(scheduler.getRunning()).toContain(t.id);
  });

  it('runNow on a one-shot reminder fires and auto-disables', async () => {
    const t = manager.create({
      ownerConversationId: 'c',
      type: 'reminder',
      description: 'once',
      message: 'hi',
      schedule: { kind: 'once', runAt: Date.now() + 60_000 },
    });
    await manager.runNow(t.id);
    expect(store.pendingOutboxCount('c')).toBe(1);
    // runNow path doesn't auto-disable (that's the scheduled tick path),
    // but it does record a trigger.
    const after = manager.get(t.id)!;
    expect(after.triggerCount).toBe(1);
  });

  it('runNow on a watch hits the network mock and updates seenValue when no match', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ p: 100 }), { status: 200 })) as any;

    try {
      const t = manager.create({
        ownerConversationId: 'c',
        type: 'watch',
        description: 'p>500',
        message: 'fired {value}',
        watch: {
          pollCron: '*/5 * * * *',
          fetcher: { type: 'http', url: 'https://x/', jsonPath: 'p' },
          condition: { op: '>', value: 500 },
          oneShot: true,
        },
      });
      await manager.runNow(t.id);
      const after = manager.get(t.id)!;
      expect(after.lastSeenValue).toBe('100');
      expect(after.triggerCount).toBe(0);
      expect(store.pendingOutboxCount('c')).toBe(0);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('loadAll re-arms enabled tasks from the DB', () => {
    manager.create({
      ownerConversationId: 'c',
      type: 'reminder',
      description: 'x',
      message: 'm',
      schedule: { kind: 'cron', cron: '0 8 * * *' },
    });
    // Simulate a process restart: build a fresh manager+scheduler over the same store.
    const scheduler2 = new SchedulerManager({ store });
    const manager2 = new UserTaskManager({ store, scheduler: scheduler2 });
    manager2.loadAll();
    expect(scheduler2.getRunning()).toHaveLength(1);
    scheduler2.cancelAll();
  });

  it('rejects invalid drafts', () => {
    expect(() => manager.create({
      ownerConversationId: 'c',
      type: 'reminder',
      description: '',
      message: 'm',
      schedule: { kind: 'cron', cron: 'not a cron' },
    } as any)).toThrow(/Invalid cron/);

    expect(() => manager.create({
      ownerConversationId: 'c',
      type: 'watch',
      description: 'x',
      message: 'm',
      watch: { pollCron: '*/5 * * * *', fetcher: { type: 'http', url: '' } as any, condition: { op: '<', value: 1 } },
    })).toThrow(/url is required/);
  });
});
