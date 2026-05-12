/**
 * Tests for the new outbox + scheduler telemetry features.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { HistoryStore } from '../../src/utils/history-store.js';
import { SchedulerManager } from '../../src/scheduler/manager.js';
import { createReportHandler } from '../../src/scheduler/tasks/report.js';
import type { BaseProvider } from '../../src/providers/base.js';
import type { ChatRequest, ChatResponse } from '../../src/core/types.js';

function makeProvider(reply: string): BaseProvider {
  return {
    id: 'mock', name: 'mock',
    config: { id: 'mock', name: 'mock', provider: 'mock', model: 'm', apiKey: 'k' },
    async chat(_req: ChatRequest): Promise<ChatResponse> { return { text: reply }; },
    async clearSession() {},
  };
}

describe('HistoryStore outbox', () => {
  let tmp: string;
  let store: HistoryStore;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'outbox-test-'));
    store = new HistoryStore(tmp);
    await store.init();
  });

  afterEach(async () => {
    await store.close();
    await rm(tmp, { recursive: true, force: true });
  });

  it('enqueues and drains payloads in order', () => {
    store.enqueueOutbox('c1', { text: 'first' }, 'task:a');
    store.enqueueOutbox('c1', { text: 'second' }, 'task:a');
    store.enqueueOutbox('c2', { text: 'other' });

    expect(store.pendingOutboxCount('c1')).toBe(2);
    expect(store.pendingOutboxCount('c2')).toBe(1);

    const drained = store.drainOutbox('c1');
    expect(drained.map((d) => d.payload.text)).toEqual(['first', 'second']);
    expect(store.pendingOutboxCount('c1')).toBe(0);
    // c2 is untouched
    expect(store.pendingOutboxCount('c2')).toBe(1);
  });

  it('does not re-deliver already-drained items', () => {
    store.enqueueOutbox('c1', { text: 'hi' });
    store.drainOutbox('c1');
    expect(store.drainOutbox('c1')).toHaveLength(0);
  });

  it('records and retrieves task run telemetry', () => {
    expect(store.getTaskRun('t1')).toBeNull();
    store.recordTaskRun('t1', 'ok');
    store.recordTaskRun('t1', 'error', 'boom');
    const run = store.getTaskRun('t1');
    expect(run?.runCount).toBe(2);
    expect(run?.lastStatus).toBe('error');
    expect(run?.lastError).toBe('boom');
    expect(run?.lastRunAt).toBeGreaterThan(0);
  });
});

describe('createReportHandler', () => {
  let tmp: string;
  let store: HistoryStore;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'report-test-'));
    store = new HistoryStore(tmp);
    await store.init();
  });

  afterEach(async () => {
    await store.close();
    await rm(tmp, { recursive: true, force: true });
  });

  it('enqueues the generated report to every target conversation', async () => {
    const handler = createReportHandler({
      getProvider: () => makeProvider('Today: AI made progress.'),
      outbox: store,
    });
    await handler({
      id: 'task-1',
      name: 'AI daily',
      cron: '0 9 * * *',
      enabled: true,
      type: 'report',
      config: { topic: 'AI' },
      targetConversations: ['conv-a', 'conv-b'],
    });
    expect(store.pendingOutboxCount('conv-a')).toBe(1);
    expect(store.pendingOutboxCount('conv-b')).toBe(1);
    const drained = store.drainOutbox('conv-a');
    expect(drained[0].payload.text).toContain('Today: AI made progress.');
  });

  it('prefers direct send when provided and skips outbox on success', async () => {
    const sent: Array<{ conv: string; text?: string }> = [];
    const handler = createReportHandler({
      getProvider: () => makeProvider('R1'),
      outbox: store,
      send: async (conv, content) => { sent.push({ conv, text: content.text }); return true; },
    });
    await handler({
      id: 'task-2', name: 'x', cron: '* * * * *', enabled: true,
      type: 'report', config: { topic: 'X' }, targetConversations: ['c'],
    });
    expect(sent).toHaveLength(1);
    expect(store.pendingOutboxCount('c')).toBe(0);
  });

  it('falls back to outbox when direct send fails', async () => {
    const handler = createReportHandler({
      getProvider: () => makeProvider('R1'),
      outbox: store,
      send: async () => false,
    });
    await handler({
      id: 'task-3', name: 'x', cron: '* * * * *', enabled: true,
      type: 'report', config: { topic: 'X' }, targetConversations: ['c'],
    });
    expect(store.pendingOutboxCount('c')).toBe(1);
  });

  it('no-ops when no target conversations are configured', async () => {
    const handler = createReportHandler({
      getProvider: () => makeProvider('R'),
      outbox: store,
    });
    await handler({
      id: 'task-4', name: 'x', cron: '* * * * *', enabled: true,
      type: 'report', config: { topic: 'X' },
    });
    // Just shouldn't throw; nothing to assert on counts.
  });
});

describe('SchedulerManager telemetry', () => {
  let tmp: string;
  let store: HistoryStore;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'scheduler-test-'));
    store = new HistoryStore(tmp);
    await store.init();
  });

  afterEach(async () => {
    await store.close();
    await rm(tmp, { recursive: true, force: true });
  });

  it('records ok runs via runNow', async () => {
    const scheduler = new SchedulerManager({ store });
    scheduler.registerHandler('test', async () => {});
    await scheduler.runNow({
      id: 'x', name: 'X', cron: '* * * * *', enabled: true, type: 'test', config: {},
    });
    const status = scheduler.getStatus('x');
    expect(status.lastStatus).toBe('ok');
    expect(status.runCount).toBe(1);
  });

  it('records error runs and re-throws', async () => {
    const scheduler = new SchedulerManager({ store });
    scheduler.registerHandler('boom', async () => { throw new Error('nope'); });
    await expect(scheduler.runNow({
      id: 'y', name: 'Y', cron: '* * * * *', enabled: true, type: 'boom', config: {},
    })).rejects.toThrow('nope');
    const status = scheduler.getStatus('y');
    expect(status.lastStatus).toBe('error');
    expect(status.lastError).toBe('nope');
  });
});
