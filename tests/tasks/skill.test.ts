/**
 * /task skill — exercises new/list/show/delete/pause/resume/run via the
 * skill interface, using a stub provider for parsing.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { HistoryStore } from '../../src/utils/history-store.js';
import { SchedulerManager } from '../../src/scheduler/manager.js';
import { UserTaskManager } from '../../src/tasks/manager.js';
import { createTaskSkill } from '../../src/skills/builtin/task.js';
import { ProviderRegistry } from '../../src/providers/registry.js';
import type { ChatRequest, ChatResponse } from '../../src/core/types.js';

function stubProvider(reply: string): ProviderRegistry {
  const r = new ProviderRegistry();
  r.registerFactory('stub', (cfg) => ({
    id: cfg.id, name: cfg.name, config: cfg,
    async chat(_req: ChatRequest): Promise<ChatResponse> { return { text: reply }; },
    async clearSession() {},
  }));
  r.addProvider({ id: 's', name: 's', provider: 'stub', model: 'm', apiKey: 'k' });
  return r;
}

describe('/task skill', () => {
  let tmp: string;
  let store: HistoryStore;
  let scheduler: SchedulerManager;
  let manager: UserTaskManager;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'task-skill-test-'));
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

  it('creates a task from natural language via /task new', async () => {
    const providers = stubProvider(JSON.stringify({
      type: 'reminder',
      description: '每天 8 点喝水',
      message: '喝水时间到',
      schedule: { kind: 'cron', cron: '0 8 * * *' },
    }));
    const skill = createTaskSkill({ manager, providers });
    const res = await skill.execute({ conversationId: 'c1', text: 'new 每天 8 点提醒我喝水' });
    expect(res.text).toContain('已创建任务');
    expect(manager.list('c1')).toHaveLength(1);
  });

  it('treats unknown subcommand prefix as natural language', async () => {
    const providers = stubProvider(JSON.stringify({
      type: 'reminder',
      description: '8 点喝水',
      message: '喝水',
      schedule: { kind: 'cron', cron: '0 8 * * *' },
    }));
    const skill = createTaskSkill({ manager, providers });
    const res = await skill.execute({ conversationId: 'c1', text: '每天 8 点提醒我喝水' });
    expect(res.text).toContain('已创建任务');
  });

  it('list returns a friendly empty state', async () => {
    const skill = createTaskSkill({ manager, providers: stubProvider('') });
    const res = await skill.execute({ conversationId: 'c1', text: 'list' });
    expect(res.text).toContain('还没有任务');
  });

  it('list, show, pause, resume, delete by short-id prefix', async () => {
    const task = manager.create({
      ownerConversationId: 'c1',
      type: 'reminder',
      description: 'x',
      message: 'y',
      schedule: { kind: 'cron', cron: '0 8 * * *' },
    });
    const prefix = task.id.slice(0, 8);
    const skill = createTaskSkill({ manager, providers: stubProvider('') });

    const listed = await skill.execute({ conversationId: 'c1', text: 'list' });
    expect(listed.text).toContain(prefix);

    const shown = await skill.execute({ conversationId: 'c1', text: `show ${prefix}` });
    expect(shown.text).toContain('任务详情');

    const paused = await skill.execute({ conversationId: 'c1', text: `pause ${prefix}` });
    expect(paused.text).toContain('已暂停');
    expect(manager.get(task.id)?.enabled).toBe(false);

    const resumed = await skill.execute({ conversationId: 'c1', text: `resume ${prefix}` });
    expect(resumed.text).toContain('已恢复');

    const deleted = await skill.execute({ conversationId: 'c1', text: `delete ${prefix}` });
    expect(deleted.text).toContain('已删除');
    expect(manager.list('c1')).toHaveLength(0);
  });

  it('rejects operations on a non-owner task', async () => {
    const task = manager.create({
      ownerConversationId: 'c1',
      type: 'reminder',
      description: 'x',
      message: 'y',
      schedule: { kind: 'cron', cron: '0 8 * * *' },
    });
    const skill = createTaskSkill({ manager, providers: stubProvider('') });
    const res = await skill.execute({ conversationId: 'c2', text: `delete ${task.id}` });
    expect(res.text).toContain('找不到');
    expect(manager.get(task.id)).not.toBeNull();
  });
});
