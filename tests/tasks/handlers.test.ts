/**
 * Unit tests for the watch fetcher + condition evaluator + reminder/watch
 * handlers. We stub global fetch so nothing actually hits the network.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { HistoryStore } from '../../src/utils/history-store.js';
import {
  evaluateCondition, extractJsonPath, renderTemplate, executeReminder, executeWatch, runFetcher,
} from '../../src/tasks/handlers.js';
import type { UserTask } from '../../src/tasks/types.js';

function mkReminder(over: Partial<UserTask> = {}): UserTask {
  return {
    id: 't1',
    ownerConversationId: 'conv-a',
    description: 'wake up',
    type: 'reminder',
    schedule: { kind: 'once', runAt: Date.now() + 1000 },
    message: 'time to wake up',
    enabled: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    lastTriggeredAt: null,
    triggerCount: 0,
    lastSeenValue: null,
    ...over,
  };
}

function mkWatch(over: Partial<UserTask> = {}): UserTask {
  return {
    id: 'w1',
    ownerConversationId: 'conv-a',
    description: 'btc < 50k',
    type: 'watch',
    watch: {
      pollCron: '*/5 * * * *',
      fetcher: { type: 'http', url: 'https://example.com/btc', jsonPath: 'btc.usd' },
      condition: { op: '<', value: 50000 },
      oneShot: true,
    },
    message: 'BTC dropped to {value}',
    enabled: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    lastTriggeredAt: null,
    triggerCount: 0,
    lastSeenValue: null,
    ...over,
  };
}

describe('evaluateCondition', () => {
  it('numeric comparisons', () => {
    expect(evaluateCondition('100', { op: '<', value: 200 }, null)).toBe(true);
    expect(evaluateCondition('300', { op: '<', value: 200 }, null)).toBe(false);
    expect(evaluateCondition('200', { op: '<=', value: 200 }, null)).toBe(true);
    expect(evaluateCondition('200', { op: '>=', value: 200 }, null)).toBe(true);
    expect(evaluateCondition('not-a-number', { op: '<', value: 100 }, null)).toBe(false);
  });

  it('string comparisons', () => {
    expect(evaluateCondition('hello world', { op: 'contains', value: 'world' }, null)).toBe(true);
    expect(evaluateCondition('hello world', { op: 'not_contains', value: 'foo' }, null)).toBe(true);
    expect(evaluateCondition('foo', { op: '==', value: 'foo' }, null)).toBe(true);
    expect(evaluateCondition('foo', { op: '!=', value: 'bar' }, null)).toBe(true);
  });

  it('changes operator needs a previous value', () => {
    expect(evaluateCondition('100', { op: 'changes' }, null)).toBe(false);
    expect(evaluateCondition('100', { op: 'changes' }, '100')).toBe(false);
    expect(evaluateCondition('101', { op: 'changes' }, '100')).toBe(true);
  });
});

describe('extractJsonPath', () => {
  it('walks nested keys', () => {
    expect(extractJsonPath({ a: { b: { c: 42 } } }, 'a.b.c')).toBe(42);
  });

  it('handles array index via dot syntax', () => {
    expect(extractJsonPath({ items: [{ v: 1 }, { v: 2 }] }, 'items.1.v')).toBe(2);
  });

  it('returns undefined for missing path', () => {
    expect(extractJsonPath({ a: 1 }, 'b.c')).toBeUndefined();
  });
});

describe('renderTemplate', () => {
  it('substitutes vars and leaves unknown tokens', () => {
    expect(renderTemplate('Price: {value} USD', { value: 99 })).toBe('Price: 99 USD');
    expect(renderTemplate('Price: {value} ({other})', { value: 99 })).toBe('Price: 99 ({other})');
  });
});

describe('runFetcher', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; });

  it('returns raw text when no jsonPath', async () => {
    globalThis.fetch = (async () => new Response('hello', { status: 200 })) as any;
    const v = await runFetcher({ type: 'http', url: 'https://x/' });
    expect(v).toBe('hello');
  });

  it('extracts via jsonPath when response is JSON', async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ price: { usd: 42000 } }), {
      status: 200, headers: { 'content-type': 'application/json' },
    })) as any;
    const v = await runFetcher({ type: 'http', url: 'https://x/', jsonPath: 'price.usd' });
    expect(v).toBe('42000');
  });

  it('throws on HTTP error', async () => {
    globalThis.fetch = (async () => new Response('boom', { status: 503 })) as any;
    await expect(runFetcher({ type: 'http', url: 'https://x/' })).rejects.toThrow('HTTP 503');
  });
});

describe('executeReminder + executeWatch', () => {
  let tmp: string;
  let store: HistoryStore;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'tasks-handlers-test-'));
    store = new HistoryStore(tmp);
    await store.init();
  });

  afterEach(async () => {
    await store.close();
    await rm(tmp, { recursive: true, force: true });
  });

  it('reminder delivers via outbox when direct send returns false', async () => {
    const task = mkReminder();
    const res = await executeReminder(task, store, () => false);
    expect(res.delivered).toBe(true);
    expect(res.shouldDisable).toBe(true);  // one-shot
    expect(store.pendingOutboxCount('conv-a')).toBe(1);
  });

  it('reminder cron is not auto-disabled', async () => {
    const task = mkReminder({ schedule: { kind: 'cron', cron: '0 8 * * *' } });
    const res = await executeReminder(task, store, () => false);
    expect(res.shouldDisable).toBeFalsy();
  });

  it('reminder uses direct send when it succeeds', async () => {
    const sent: any[] = [];
    const task = mkReminder();
    const res = await executeReminder(task, store, async (conv, c) => { sent.push({ conv, c }); return true; });
    expect(res.delivered).toBe(true);
    expect(sent).toHaveLength(1);
    expect(store.pendingOutboxCount('conv-a')).toBe(0);
  });

  it('watch fires when condition matches and sets shouldDisable on oneShot', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ btc: { usd: 49000 } }), { status: 200 })) as any;
    try {
      const task = mkWatch();
      const res = await executeWatch(task, store, () => false);
      expect(res.delivered).toBe(true);
      expect(res.shouldDisable).toBe(true);
      expect(res.seenValue).toBe('49000');
      const drained = store.drainOutbox('conv-a');
      expect(drained[0].payload.text).toContain('49000');
    } finally {
      // restore handled by next test's afterEach
    }
  });

  it('watch does not fire when condition is false', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ btc: { usd: 60000 } }), { status: 200 })) as any;
    const task = mkWatch();
    const res = await executeWatch(task, store, () => false);
    expect(res.delivered).toBe(false);
    expect(res.seenValue).toBe('60000');
    expect(store.pendingOutboxCount('conv-a')).toBe(0);
  });

  it('watch with oneShot=false keeps the task armed', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ btc: { usd: 49000 } }), { status: 200 })) as any;
    const task = mkWatch({ watch: { ...mkWatch().watch!, oneShot: false } });
    const res = await executeWatch(task, store, () => false);
    expect(res.delivered).toBe(true);
    expect(res.shouldDisable).toBe(false);
  });
});
