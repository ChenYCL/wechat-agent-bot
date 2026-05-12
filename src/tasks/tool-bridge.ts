/**
 * Provider-facing tools for user-task management.
 *
 * When this bridge is wired into the provider registry, the LLM can call
 * these tools mid-conversation — e.g. when the user says "明天 8 点提醒
 * 我开会" the model invokes `create_reminder` directly instead of the
 * user having to type `/task new ...`.
 *
 * Every tool operates within the caller's conversation: the bridge reads
 * `ctx.conversationId` and refuses to act if it's missing or looks like
 * an internal/synthetic id (e.g. the parser uses `__task-parser__...`).
 */
import type { ToolBridge, ToolContext, ToolDescriptor } from '../providers/base.js';
import type { UserTaskManager } from './manager.js';
import type { UserTask, WatchSpec, ReminderSchedule } from './types.js';
import { logger } from '../utils/logger.js';

const TOOLS: ToolDescriptor[] = [
  {
    name: 'create_reminder',
    description: 'Create a time-based reminder for the current user. Use this when the user wants to be alerted at a specific time, repeatedly or once. Returns the task id.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        description: { type: 'string', description: 'Short summary of the reminder, in the user\'s language.' },
        message: { type: 'string', description: 'The text that will be delivered to the user when the reminder fires.' },
        schedule_kind: { type: 'string', enum: ['once', 'cron'] },
        run_at_iso: { type: 'string', description: 'ISO-8601 with timezone, e.g. "2026-05-13T08:00:00+08:00". Required if schedule_kind="once".' },
        cron: { type: 'string', description: 'Standard 5-field cron, e.g. "0 8 * * *". Required if schedule_kind="cron".' },
      },
      required: ['description', 'message', 'schedule_kind'],
    },
  },
  {
    name: 'create_watch',
    description: 'Create a polling watch that periodically fetches an HTTP endpoint and notifies the user when a condition is met. Use this for price alerts, status monitors, threshold checks. Returns the task id.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        description: { type: 'string' },
        message: { type: 'string', description: 'Delivered when the condition matches. Use {value} to interpolate the observed value.' },
        poll_cron: { type: 'string', description: '5-field cron for how often to poll. Default "*/5 * * * *".' },
        url: { type: 'string', description: 'Public HTTP(S) URL with no auth required.' },
        method: { type: 'string', enum: ['GET', 'POST'] },
        body: { type: 'string' },
        headers: { type: 'object', additionalProperties: { type: 'string' } },
        json_path: { type: 'string', description: 'Dotted JSON path into the response (e.g. "bitcoin.usd"). Omit for raw text response.' },
        regex: { type: 'string', description: 'Regex to extract a value from plain text responses (1st capture group used). For A-share sina: "\\"[^,]*,[^,]*,[^,]*,([0-9.]+)" extracts 当前价.' },
        op: { type: 'string', enum: ['<', '>', '<=', '>=', '==', '!=', 'contains', 'not_contains', 'changes'] },
        value: { description: 'Reference value to compare against (string or number). Omit for op="changes".' },
        one_shot: { type: 'boolean', description: 'If true (default), the watch disables itself after first match.' },
      },
      required: ['description', 'message', 'url', 'op'],
    },
  },
  {
    name: 'list_my_tasks',
    description: 'List the current user\'s tasks (reminders and watches). Returns an array of {id, description, type, enabled, schedule, trigger_count}.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'show_my_task',
    description: 'Show detail of one of the user\'s tasks. Accepts the full task id or a unique prefix.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { task_id: { type: 'string' } },
      required: ['task_id'],
    },
  },
  {
    name: 'delete_my_task',
    description: 'Delete one of the user\'s tasks. Accepts the full task id or a unique prefix. Always confirm with the user before calling this.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { task_id: { type: 'string' } },
      required: ['task_id'],
    },
  },
  {
    name: 'pause_my_task',
    description: 'Disable one of the user\'s tasks without deleting it.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { task_id: { type: 'string' } },
      required: ['task_id'],
    },
  },
  {
    name: 'resume_my_task',
    description: 'Re-enable a previously paused task.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { task_id: { type: 'string' } },
      required: ['task_id'],
    },
  },
];

export function createUserTaskToolBridge(manager: UserTaskManager): ToolBridge {
  return {
    listTools(): ToolDescriptor[] {
      return TOOLS;
    },
    async callTool(name: string, args: Record<string, unknown>, ctx?: ToolContext): Promise<unknown> {
      const conv = ctx?.conversationId;
      if (!conv) return { error: 'Missing conversation context — refusing to act' };
      if (conv.startsWith('__')) {
        // synthetic / internal conversation (parser, summary, translate, scheduled-task)
        return { error: 'Tools are disabled in internal conversations' };
      }

      switch (name) {
        case 'create_reminder':  return createReminder(args, conv, manager);
        case 'create_watch':     return createWatch(args, conv, manager);
        case 'list_my_tasks':    return listMyTasks(conv, manager);
        case 'show_my_task':     return showMyTask(args, conv, manager);
        case 'delete_my_task':   return deleteMyTask(args, conv, manager);
        case 'pause_my_task':    return setEnabled(args, conv, manager, false);
        case 'resume_my_task':   return setEnabled(args, conv, manager, true);
        default:
          throw new Error(`Unknown user-task tool: ${name}`);
      }
    },
  };
}

function createReminder(args: Record<string, unknown>, conv: string, manager: UserTaskManager) {
  const description = str(args.description);
  const message = str(args.message);
  const kind = str(args.schedule_kind);
  if (!description || !message) return { error: 'description and message are required' };

  let schedule: ReminderSchedule;
  if (kind === 'once') {
    const iso = str(args.run_at_iso);
    if (!iso) return { error: 'run_at_iso is required for schedule_kind=once' };
    const ms = Date.parse(iso);
    if (!Number.isFinite(ms)) return { error: `Invalid run_at_iso: ${iso}` };
    schedule = { kind: 'once', runAt: ms };
  } else if (kind === 'cron') {
    const c = str(args.cron);
    if (!c) return { error: 'cron is required for schedule_kind=cron' };
    schedule = { kind: 'cron', cron: c };
  } else {
    return { error: `Unknown schedule_kind: ${kind}` };
  }

  try {
    const task = manager.create({
      ownerConversationId: conv,
      type: 'reminder',
      description,
      message,
      schedule,
    });
    return summarize(task);
  } catch (err) {
    logger.warn(`[tool create_reminder] ${(err as Error).message}`);
    return { error: (err as Error).message };
  }
}

function createWatch(args: Record<string, unknown>, conv: string, manager: UserTaskManager) {
  const description = str(args.description);
  const message = str(args.message);
  const url = str(args.url);
  const op = str(args.op) as WatchSpec['condition']['op'];
  if (!description || !message || !url || !op) return { error: 'description, message, url, op are required' };

  const watch: WatchSpec = {
    pollCron: str(args.poll_cron) || '*/5 * * * *',
    fetcher: {
      type: 'http',
      url,
      method: (str(args.method) || 'GET') as 'GET' | 'POST',
      headers: args.headers as Record<string, string> | undefined,
      body: str(args.body) || undefined,
      jsonPath: str(args.json_path) || undefined,
      regex: str(args.regex) || undefined,
    },
    condition: {
      op,
      value: args.value as string | number | undefined,
    },
    oneShot: args.one_shot === undefined ? true : Boolean(args.one_shot),
  };

  try {
    const task = manager.create({
      ownerConversationId: conv,
      type: 'watch',
      description,
      message,
      watch,
    });
    return summarize(task);
  } catch (err) {
    logger.warn(`[tool create_watch] ${(err as Error).message}`);
    return { error: (err as Error).message };
  }
}

function listMyTasks(conv: string, manager: UserTaskManager) {
  return manager.list(conv).map(summarize);
}

function showMyTask(args: Record<string, unknown>, conv: string, manager: UserTaskManager) {
  const task = resolveByPrefix(str(args.task_id), conv, manager);
  if (!task) return { error: `Task not found: ${args.task_id}` };
  return summarize(task);
}

function deleteMyTask(args: Record<string, unknown>, conv: string, manager: UserTaskManager) {
  const task = resolveByPrefix(str(args.task_id), conv, manager);
  if (!task) return { error: `Task not found: ${args.task_id}` };
  manager.delete(task.id, conv);
  return { ok: true, deleted_id: task.id, description: task.description };
}

function setEnabled(args: Record<string, unknown>, conv: string, manager: UserTaskManager, enabled: boolean) {
  const task = resolveByPrefix(str(args.task_id), conv, manager);
  if (!task) return { error: `Task not found: ${args.task_id}` };
  const updated = manager.setEnabled(task.id, enabled, conv);
  return updated ? summarize(updated) : { error: 'update failed' };
}

function resolveByPrefix(idArg: string, conv: string, manager: UserTaskManager): UserTask | null {
  if (!idArg) return null;
  const all = manager.list(conv);
  const exact = all.find((t) => t.id === idArg);
  if (exact) return exact;
  const matches = all.filter((t) => t.id.startsWith(idArg));
  return matches.length === 1 ? matches[0] : null;
}

function summarize(t: UserTask) {
  return {
    id: t.id,
    description: t.description,
    type: t.type,
    enabled: t.enabled,
    schedule: t.schedule,
    watch: t.watch
      ? {
          pollCron: t.watch.pollCron,
          url: t.watch.fetcher.url,
          op: t.watch.condition.op,
          value: t.watch.condition.value,
          oneShot: t.watch.oneShot ?? true,
        }
      : undefined,
    message: t.message,
    enabled_at: t.updatedAt,
    last_triggered_at: t.lastTriggeredAt,
    trigger_count: t.triggerCount,
  };
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
