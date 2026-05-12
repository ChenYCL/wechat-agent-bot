/**
 * Bulk operations, in-place edits, observation history, and the
 * synthetic-conversation guard.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { HistoryStore } from '../../src/utils/history-store.js';
import { SchedulerManager } from '../../src/scheduler/manager.js';
import { UserTaskManager } from '../../src/tasks/manager.js';

describe('UserTaskManager bulk + edit + observations', () => {
  let tmp: string;
  let store: HistoryStore;
  let scheduler: SchedulerManager;
  let manager: UserTaskManager;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'utm-extras-'));
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

  function mkRem(conv = 'c1') {
    return manager.create({
      ownerConversationId: conv,
      type: 'reminder',
      description: 'x',
      message: 'y',
      schedule: { kind: 'cron', cron: '0 8 * * *' },
    });
  }

  it('pauseAll / resumeAll / deleteAll only affect the caller\'s tasks', () => {
    mkRem('c1');
    mkRem('c1');
    mkRem('c2');
    expect(manager.pauseAll('c1')).toBe(2);
    expect(manager.list('c1').every((t) => !t.enabled)).toBe(true);
    expect(manager.list('c2').every((t) => t.enabled)).toBe(true);
    expect(manager.resumeAll('c1')).toBe(2);
    expect(manager.list('c1').every((t) => t.enabled)).toBe(true);
    expect(manager.deleteAll('c1')).toBe(2);
    expect(manager.list('c1')).toHaveLength(0);
    expect(manager.list('c2')).toHaveLength(1);
  });

  it('updateMessage edits text and rejects empty', () => {
    const t = mkRem();
    const u = manager.updateMessage(t.id, 'new msg', 'c1');
    expect(u?.message).toBe('new msg');
    expect(() => manager.updateMessage(t.id, '   ', 'c1')).toThrow(/empty/);
  });

  it('updateSchedule validates cron and re-arms', () => {
    const t = mkRem();
    expect(() => manager.updateSchedule(t.id, { kind: 'cron', cron: 'bad' })).toThrow(/Invalid cron/);
    const u = manager.updateSchedule(t.id, { kind: 'cron', cron: '0 9 * * *' }, 'c1');
    expect(u?.schedule?.cron).toBe('0 9 * * *');
    expect(scheduler.getRunning()).toContain(t.id);
  });

  it('applyEdit refuses to cross types', () => {
    const t = mkRem();
    expect(() => manager.applyEdit(t.id, {
      watch: {
        pollCron: '*/5 * * * *',
        fetcher: { type: 'http', url: 'https://example.com' },
        condition: { op: '<', value: 1 },
      },
    }, 'c1')).toThrow(/Cannot set watch/);
  });

  it('observations are recorded on every poll and capped (sawtooth)', () => {
    // The store uses a cheap "trim at maxKeep+50 down to maxKeep" sawtooth,
    // so after 260 inserts with maxKeep=200 we expect at most 250 rows.
    for (let i = 0; i < 260; i++) {
      store.recordObservation('task-X', String(i), i === 259, 200);
    }
    const obs = store.listObservations('task-X', 500);
    expect(obs.length).toBeLessThanOrEqual(250);
    // Most recent value is preserved
    expect(obs[0].value).toBe('259');
    expect(obs[0].matched).toBe(true);
  });

  it('delete also clears observation history', () => {
    const t = manager.create({
      ownerConversationId: 'c1',
      type: 'watch',
      description: 'x', message: 'y',
      watch: {
        pollCron: '*/5 * * * *',
        fetcher: { type: 'http', url: 'https://example.com' },
        condition: { op: '<', value: 1 },
      },
    });
    store.recordObservation(t.id, '42', false);
    expect(store.listObservations(t.id).length).toBe(1);
    manager.delete(t.id, 'c1');
    expect(store.listObservations(t.id).length).toBe(0);
  });
});
