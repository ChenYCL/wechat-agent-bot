/**
 * Execution path for a UserTask.
 *
 * `executeReminder`  — render template, enqueue to outbox for the owner.
 * `executeWatch`     — fetch via HTTP, extract value, evaluate condition,
 *                      deliver + (by default) auto-disable on match.
 *
 * Both return a boolean indicating whether a delivery happened, so the
 * scheduler can record `lastTriggeredAt` accurately.
 */
import type { UserTask, WatchFetcher, WatchCondition } from './types.js';
import type { HistoryStore } from '../utils/history-store.js';
import { logger } from '../utils/logger.js';

export interface ExecuteResult {
  delivered: boolean;
  seenValue?: string | null;
  shouldDisable?: boolean;
}

export type DeliverFn = (conversationId: string, content: { text: string }) => Promise<boolean> | boolean;

const DEFAULT_TIMEOUT_MS = 15_000;

export async function executeReminder(task: UserTask, store: HistoryStore, deliver: DeliverFn): Promise<ExecuteResult> {
  const text = renderTemplate(task.message, {});
  const decorated = decorateTriggerText('reminder', text);
  const ok = await tryDeliver(task.ownerConversationId, decorated, store, deliver, `reminder:${task.id}`);
  return {
    delivered: ok,
    shouldDisable: task.schedule?.kind === 'once',
  };
}

/** Prefix a trigger message with a clear label + timestamp so the user
 *  can tell it apart from normal chat. Used for both push and outbox
 *  paths so behaviour is consistent. */
function decorateTriggerText(kind: 'reminder' | 'watch', text: string): string {
  const tag = kind === 'reminder' ? '🔔 定时提醒' : '👁️ 监控触发';
  const ts = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit' });
  return `${tag} (${ts})\n${text}`;
}

export async function executeWatch(task: UserTask, store: HistoryStore, deliver: DeliverFn): Promise<ExecuteResult> {
  if (!task.watch) return { delivered: false };

  let observed: string;
  try {
    observed = await runFetcher(task.watch.fetcher);
  } catch (err) {
    logger.warn(`[watch] ${task.id} fetch failed: ${(err as Error).message}`);
    store.recordObservation(task.id, null, false);
    return { delivered: false };
  }

  const matched = evaluateCondition(observed, task.watch.condition, task.lastSeenValue);
  store.recordObservation(task.id, observed, matched);

  if (!matched) {
    return { delivered: false, seenValue: observed };
  }

  const rendered = renderTemplate(task.message, { value: observed });
  const decorated = decorateTriggerText('watch', rendered);
  const ok = await tryDeliver(task.ownerConversationId, decorated, store, deliver, `watch:${task.id}`);

  const oneShot = task.watch.oneShot !== false; // default true
  return {
    delivered: ok,
    seenValue: observed,
    shouldDisable: oneShot,
  };
}

async function tryDeliver(conversationId: string, text: string, store: HistoryStore, deliver: DeliverFn, source: string): Promise<boolean> {
  try {
    const ok = await deliver(conversationId, { text });
    if (ok) return true;
  } catch (err) {
    logger.warn(`[deliver] direct send failed for ${conversationId}: ${(err as Error).message}`);
  }
  store.enqueueOutbox(conversationId, { text }, source);
  return true;
}

export function renderTemplate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    const v = vars[key];
    return v === undefined || v === null ? `{${key}}` : String(v);
  });
}

export async function runFetcher(fetcher: WatchFetcher): Promise<string> {
  if (fetcher.type !== 'http') throw new Error(`Unsupported fetcher type: ${fetcher.type}`);

  const res = await fetch(fetcher.url, {
    method: fetcher.method ?? 'GET',
    headers: fetcher.headers,
    body: fetcher.body,
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const raw = await res.text();

  if (!fetcher.jsonPath) return raw.trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Not JSON — return raw and let the condition handle it.
    return raw.trim();
  }
  const extracted = extractJsonPath(parsed, fetcher.jsonPath);
  if (extracted === undefined || extracted === null) {
    throw new Error(`jsonPath "${fetcher.jsonPath}" did not match`);
  }
  return typeof extracted === 'string' ? extracted : String(extracted);
}

export function extractJsonPath(obj: unknown, path: string): unknown {
  const parts = path.split('.').filter(Boolean);
  let cur: any = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

export function evaluateCondition(observed: string, condition: WatchCondition, previous: string | null): boolean {
  const obs = observed.trim();
  const target = condition.value;

  switch (condition.op) {
    case 'contains': return target != null && obs.includes(String(target));
    case 'not_contains': return target != null && !obs.includes(String(target));
    case '==': return target != null && String(target) === obs;
    case '!=': return target != null && String(target) !== obs;
    case 'changes': return previous != null && obs !== previous;
    case '<':
    case '>':
    case '<=':
    case '>=': {
      const a = Number(obs);
      const b = Number(target);
      if (Number.isNaN(a) || Number.isNaN(b)) return false;
      if (condition.op === '<') return a < b;
      if (condition.op === '>') return a > b;
      if (condition.op === '<=') return a <= b;
      return a >= b;
    }
    default: return false;
  }
}
