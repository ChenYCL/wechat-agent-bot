/**
 * UserTaskToolBridge tests — verifies the LLM-facing surface, including
 * the synthetic-conversation guard (parser / summary / scheduled tasks
 * must not get any tools attributed to them).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { HistoryStore } from '../../src/utils/history-store.js';
import { SchedulerManager } from '../../src/scheduler/manager.js';
import { UserTaskManager } from '../../src/tasks/manager.js';
import { createUserTaskToolBridge } from '../../src/tasks/tool-bridge.js';

describe('UserTaskToolBridge', () => {
  let tmp: string;
  let store: HistoryStore;
  let scheduler: SchedulerManager;
  let manager: UserTaskManager;
  let bridge: ReturnType<typeof createUserTaskToolBridge>;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'tool-bridge-test-'));
    store = new HistoryStore(tmp);
    await store.init();
    scheduler = new SchedulerManager({ store });
    manager = new UserTaskManager({ store, scheduler });
    bridge = createUserTaskToolBridge(manager);
  });

  afterEach(async () => {
    scheduler.cancelAll();
    await store.close();
    await rm(tmp, { recursive: true, force: true });
  });

  it('lists tools', () => {
    const names = bridge.listTools().map((t) => t.name);
    expect(names).toContain('create_reminder');
    expect(names).toContain('create_watch');
    expect(names).toContain('list_my_tasks');
    expect(names).toContain('delete_my_task');
    expect(names).toContain('pause_my_task');
    expect(names).toContain('resume_my_task');
  });

  it('refuses to act without conversation context', async () => {
    const r = await bridge.callTool('list_my_tasks', {});
    expect((r as any).error).toContain('Missing conversation context');
  });

  it('refuses synthetic conversation ids (parser/scheduled/etc.)', async () => {
    const r = await bridge.callTool('create_reminder', {
      description: 'x', message: 'y', schedule_kind: 'cron', cron: '0 8 * * *',
    }, { conversationId: '__task-parser__abc' });
    expect((r as any).error).toContain('disabled in internal');
  });

  it('creates a cron reminder via tool', async () => {
    const r = await bridge.callTool('create_reminder', {
      description: '每天 8 点喝水',
      message: '喝水时间到',
      schedule_kind: 'cron',
      cron: '0 8 * * *',
    }, { conversationId: 'c1' });
    expect((r as any).id).toBeDefined();
    expect((r as any).description).toBe('每天 8 点喝水');
    expect(manager.list('c1')).toHaveLength(1);
  });

  it('creates a once reminder via tool', async () => {
    const future = new Date(Date.now() + 86400_000).toISOString();
    const r = await bridge.callTool('create_reminder', {
      description: 'meeting',
      message: 'meeting time',
      schedule_kind: 'once',
      run_at_iso: future,
    }, { conversationId: 'c1' });
    expect((r as any).id).toBeDefined();
    const stored = manager.list('c1')[0];
    expect(stored.schedule?.kind).toBe('once');
  });

  it('rejects malformed once reminder (bad ISO)', async () => {
    const r = await bridge.callTool('create_reminder', {
      description: 'x', message: 'y', schedule_kind: 'once', run_at_iso: 'not-a-date',
    }, { conversationId: 'c1' });
    expect((r as any).error).toContain('Invalid run_at_iso');
  });

  it('creates a watch via tool', async () => {
    const r = await bridge.callTool('create_watch', {
      description: 'btc < 50k',
      message: 'BTC: {value}',
      url: 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd',
      json_path: 'bitcoin.usd',
      op: '<',
      value: 50000,
    }, { conversationId: 'c1' });
    expect((r as any).id).toBeDefined();
    expect(manager.list('c1')[0].type).toBe('watch');
  });

  it('list/show/delete/pause/resume work via tools', async () => {
    const create = await bridge.callTool('create_reminder', {
      description: 'x', message: 'y', schedule_kind: 'cron', cron: '0 8 * * *',
    }, { conversationId: 'c1' }) as any;

    const list = await bridge.callTool('list_my_tasks', {}, { conversationId: 'c1' });
    expect((list as any[]).length).toBe(1);

    const show = await bridge.callTool('show_my_task', { task_id: create.id.slice(0, 8) }, { conversationId: 'c1' });
    expect((show as any).id).toBe(create.id);

    const pause = await bridge.callTool('pause_my_task', { task_id: create.id }, { conversationId: 'c1' });
    expect((pause as any).enabled).toBe(false);

    const resume = await bridge.callTool('resume_my_task', { task_id: create.id }, { conversationId: 'c1' });
    expect((resume as any).enabled).toBe(true);

    const del = await bridge.callTool('delete_my_task', { task_id: create.id }, { conversationId: 'c1' });
    expect((del as any).ok).toBe(true);
    expect(manager.list('c1')).toHaveLength(0);
  });

  it('cannot see or operate on another user\'s tasks', async () => {
    const create = await bridge.callTool('create_reminder', {
      description: 'mine', message: 'y', schedule_kind: 'cron', cron: '0 8 * * *',
    }, { conversationId: 'c1' }) as any;

    const list = await bridge.callTool('list_my_tasks', {}, { conversationId: 'c2' });
    expect((list as any[]).length).toBe(0);

    const del = await bridge.callTool('delete_my_task', { task_id: create.id }, { conversationId: 'c2' });
    expect((del as any).error).toContain('Task not found');
    expect(manager.list('c1')).toHaveLength(1);
  });
});
