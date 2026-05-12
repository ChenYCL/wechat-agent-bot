/**
 * Orchestrator for user-created tasks.
 *
 * - Persists tasks via HistoryStore.
 * - Schedules reminders (cron via SchedulerManager, one-shots via setTimeout).
 * - Schedules watches as polling cron jobs.
 * - Records lastTriggeredAt + lastSeenValue back to the store on each fire.
 * - Auto-disables one-shot tasks (single-fire reminders, watches with oneShot).
 */
import { randomUUID } from 'node:crypto';
import cron from 'node-cron';
import type { UserTask, UserTaskDraft } from './types.js';
import { executeReminder, executeWatch, type DeliverFn } from './handlers.js';
import type { HistoryStore } from '../utils/history-store.js';
import type { SchedulerManager } from '../scheduler/manager.js';
import { logger } from '../utils/logger.js';

const DEFAULT_POLL_CRON = '*/5 * * * *';

export interface UserTaskManagerOptions {
  store: HistoryStore;
  scheduler: SchedulerManager;
  /** Optional direct sender; falls back to outbox queueing on failure. */
  deliver?: DeliverFn;
}

export class UserTaskManager {
  private store: HistoryStore;
  private scheduler: SchedulerManager;
  private deliver: DeliverFn;
  private timeouts = new Map<string, NodeJS.Timeout>();

  constructor(opts: UserTaskManagerOptions) {
    this.store = opts.store;
    this.scheduler = opts.scheduler;
    this.deliver = opts.deliver ?? (() => false);

    this.scheduler.registerHandler('user_reminder', async (st) => {
      const task = this.store.getUserTask(st.id);
      if (!task || !task.enabled) return;
      const result = await executeReminder(task, this.store, this.deliver);
      if (result.delivered || result.shouldDisable) {
        this.store.recordUserTaskTrigger(task.id, null);
      }
      if (result.shouldDisable) {
        this.disable(task.id);
      }
    });

    this.scheduler.registerHandler('user_watch', async (st) => {
      const task = this.store.getUserTask(st.id);
      if (!task || !task.enabled) return;
      const result = await executeWatch(task, this.store, this.deliver);
      // Always update seenValue (for `changes`), even when no delivery.
      if (result.seenValue !== undefined) {
        this.updateSeenValue(task.id, result.seenValue ?? null, result.delivered);
      }
      if (result.shouldDisable) {
        this.disable(task.id);
      }
    });
  }

  /** Boot-time: re-arm every enabled task from the DB. */
  loadAll(): void {
    const all = this.store.listUserTasks();
    for (const task of all) {
      if (!task.enabled) continue;
      this.arm(task);
    }
    logger.info(`[user-tasks] Loaded ${all.length} task(s) from SQLite (${all.filter((t) => t.enabled).length} enabled)`);
  }

  /** Insert + schedule. Returns the created task with id assigned. */
  create(draft: UserTaskDraft): UserTask {
    validateDraft(draft);
    const now = Date.now();
    const task: UserTask = {
      id: randomUUID(),
      ownerConversationId: draft.ownerConversationId,
      description: draft.description,
      type: draft.type,
      schedule: draft.schedule,
      watch: draft.watch ? { ...draft.watch, pollCron: draft.watch.pollCron || DEFAULT_POLL_CRON } : undefined,
      message: draft.message,
      enabled: draft.enabled ?? true,
      createdAt: now,
      updatedAt: now,
      lastTriggeredAt: null,
      triggerCount: 0,
      lastSeenValue: null,
    };
    this.store.saveUserTask(task);
    if (task.enabled) this.arm(task);
    return task;
  }

  list(ownerConversationId: string): UserTask[] {
    return this.store.listUserTasks(ownerConversationId);
  }

  get(id: string): UserTask | null {
    return this.store.getUserTask(id);
  }

  delete(id: string, ownerConversationId?: string): boolean {
    const existing = this.store.getUserTask(id);
    if (!existing) return false;
    if (ownerConversationId && existing.ownerConversationId !== ownerConversationId) return false;
    this.disarm(id);
    this.store.deleteObservations(id);
    return this.store.deleteUserTask(id);
  }

  observations(id: string, limit = 20) {
    return this.store.listObservations(id, limit);
  }

  /** Apply bulk operation across a conversation. Returns count affected. */
  pauseAll(ownerConversationId: string): number {
    const tasks = this.store.listUserTasks(ownerConversationId).filter((t) => t.enabled);
    for (const t of tasks) this.setEnabled(t.id, false, ownerConversationId);
    return tasks.length;
  }

  resumeAll(ownerConversationId: string): number {
    const tasks = this.store.listUserTasks(ownerConversationId).filter((t) => !t.enabled);
    for (const t of tasks) this.setEnabled(t.id, true, ownerConversationId);
    return tasks.length;
  }

  deleteAll(ownerConversationId: string): number {
    const tasks = this.store.listUserTasks(ownerConversationId);
    for (const t of tasks) this.delete(t.id, ownerConversationId);
    return tasks.length;
  }

  /** Direct field edit. Returns the updated task or null if not found/owned. */
  updateMessage(id: string, message: string, ownerConversationId?: string): UserTask | null {
    const t = this.store.getUserTask(id);
    if (!t) return null;
    if (ownerConversationId && t.ownerConversationId !== ownerConversationId) return null;
    if (!message.trim()) throw new Error('message cannot be empty');
    this.store.updateUserTask(id, { message });
    return this.store.getUserTask(id);
  }

  /** Replace the schedule of a reminder. Validates cron / runAt. */
  updateSchedule(id: string, schedule: import('./types.js').ReminderSchedule, ownerConversationId?: string): UserTask | null {
    const t = this.store.getUserTask(id);
    if (!t) return null;
    if (ownerConversationId && t.ownerConversationId !== ownerConversationId) return null;
    if (t.type !== 'reminder') throw new Error('updateSchedule only applies to reminder tasks');
    validateReminderSchedule(schedule);
    this.store.updateUserTask(id, { spec: { schedule } });
    this.disarm(id);
    const fresh = this.store.getUserTask(id)!;
    if (fresh.enabled) this.arm(fresh);
    return fresh;
  }

  /** Replace the entire watch spec. */
  updateWatch(id: string, watch: import('./types.js').WatchSpec, ownerConversationId?: string): UserTask | null {
    const t = this.store.getUserTask(id);
    if (!t) return null;
    if (ownerConversationId && t.ownerConversationId !== ownerConversationId) return null;
    if (t.type !== 'watch') throw new Error('updateWatch only applies to watch tasks');
    validateWatchSpec(watch);
    this.store.updateUserTask(id, { spec: { watch } });
    this.disarm(id);
    const fresh = this.store.getUserTask(id)!;
    if (fresh.enabled) this.arm(fresh);
    return fresh;
  }

  /** Apply a partial draft as an edit; only allowed fields are updated. */
  applyEdit(id: string, edit: { description?: string; message?: string; schedule?: import('./types.js').ReminderSchedule; watch?: import('./types.js').WatchSpec }, ownerConversationId?: string): UserTask | null {
    const t = this.store.getUserTask(id);
    if (!t) return null;
    if (ownerConversationId && t.ownerConversationId !== ownerConversationId) return null;

    const fields: { description?: string; message?: string; spec?: { schedule?: import('./types.js').ReminderSchedule; watch?: import('./types.js').WatchSpec } } = {};
    if (edit.description !== undefined) fields.description = edit.description;
    if (edit.message !== undefined) fields.message = edit.message;

    if (edit.schedule !== undefined) {
      if (t.type !== 'reminder') throw new Error('Cannot set schedule on a watch task');
      validateReminderSchedule(edit.schedule);
      fields.spec = { schedule: edit.schedule };
    }
    if (edit.watch !== undefined) {
      if (t.type !== 'watch') throw new Error('Cannot set watch on a reminder task');
      validateWatchSpec(edit.watch);
      fields.spec = { watch: edit.watch };
    }

    this.store.updateUserTask(id, fields);
    this.disarm(id);
    const fresh = this.store.getUserTask(id)!;
    if (fresh.enabled) this.arm(fresh);
    return fresh;
  }

  setEnabled(id: string, enabled: boolean, ownerConversationId?: string): UserTask | null {
    const task = this.store.getUserTask(id);
    if (!task) return null;
    if (ownerConversationId && task.ownerConversationId !== ownerConversationId) return null;
    this.store.setUserTaskEnabled(id, enabled);
    this.disarm(id);
    if (enabled) {
      const fresh = this.store.getUserTask(id)!;
      this.arm(fresh);
    }
    return this.store.getUserTask(id);
  }

  /** Fire a task right now regardless of schedule. */
  async runNow(id: string): Promise<void> {
    const task = this.store.getUserTask(id);
    if (!task) throw new Error(`Task not found: ${id}`);
    if (task.type === 'reminder') {
      const r = await executeReminder(task, this.store, this.deliver);
      if (r.delivered) this.store.recordUserTaskTrigger(task.id, null);
    } else {
      const r = await executeWatch(task, this.store, this.deliver);
      if (r.seenValue !== undefined) {
        this.updateSeenValue(task.id, r.seenValue ?? null, r.delivered);
      }
    }
  }

  private arm(task: UserTask): void {
    this.disarm(task.id);

    if (task.type === 'reminder') {
      const sched = task.schedule;
      if (!sched) return;
      if (sched.kind === 'cron' && sched.cron) {
        this.scheduler.schedule({
          id: task.id,
          name: task.description,
          cron: sched.cron,
          enabled: true,
          type: 'user_reminder',
          config: {},
        });
      } else if (sched.kind === 'once' && sched.runAt) {
        const delay = sched.runAt - Date.now();
        if (delay <= 0) {
          // Already past — fire immediately on next tick.
          setImmediate(() => this.runNow(task.id).catch((err) => logger.error(`[user-tasks] runNow ${task.id}: ${err.message}`)));
          return;
        }
        const t = setTimeout(() => {
          this.runNow(task.id).catch((err) => logger.error(`[user-tasks] one-shot ${task.id}: ${err.message}`));
        }, delay);
        this.timeouts.set(task.id, t);
      }
    } else if (task.type === 'watch') {
      const pollCron = task.watch?.pollCron || DEFAULT_POLL_CRON;
      this.scheduler.schedule({
        id: task.id,
        name: task.description,
        cron: pollCron,
        enabled: true,
        type: 'user_watch',
        config: {},
      });
    }
  }

  private disarm(id: string): void {
    this.scheduler.cancel(id);
    const t = this.timeouts.get(id);
    if (t) {
      clearTimeout(t);
      this.timeouts.delete(id);
    }
  }

  private disable(id: string): void {
    this.store.setUserTaskEnabled(id, false);
    this.disarm(id);
  }

  private updateSeenValue(id: string, value: string | null, delivered: boolean): void {
    if (delivered) {
      this.store.recordUserTaskTrigger(id, value);
    } else {
      // No delivery: just stash the seen value for next `changes` comparison.
      const task = this.store.getUserTask(id);
      if (!task) return;
      this.store.saveUserTask({ ...task, lastSeenValue: value });
    }
  }
}

function validateDraft(draft: UserTaskDraft): void {
  if (!draft.ownerConversationId) throw new Error('ownerConversationId is required');
  if (!draft.message) throw new Error('message is required');
  if (draft.type === 'reminder') {
    if (!draft.schedule) throw new Error('reminder.schedule is required');
    validateReminderSchedule(draft.schedule);
  } else if (draft.type === 'watch') {
    if (!draft.watch) throw new Error('watch spec is required');
    validateWatchSpec(draft.watch);
  } else {
    throw new Error(`Unknown task type: ${draft.type}`);
  }
}

function validateReminderSchedule(s: import('./types.js').ReminderSchedule): void {
  if (s.kind === 'cron') {
    if (!s.cron || !cron.validate(s.cron)) throw new Error(`Invalid cron: ${s.cron}`);
  } else if (s.kind === 'once') {
    if (!s.runAt || typeof s.runAt !== 'number') throw new Error('schedule.runAt (ms) is required for kind=once');
  } else {
    throw new Error(`Unknown reminder.schedule.kind: ${(s as any).kind}`);
  }
}

function validateWatchSpec(w: import('./types.js').WatchSpec): void {
  if (!w.fetcher?.url) throw new Error('watch.fetcher.url is required');
  if (w.pollCron && !cron.validate(w.pollCron)) throw new Error(`Invalid pollCron: ${w.pollCron}`);
  if (!w.condition?.op) throw new Error('watch.condition.op is required');
}
