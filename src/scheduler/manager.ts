/**
 * Cron-based scheduler for automated tasks like
 * research reports, daily summaries, etc.
 *
 * Features:
 *  - Configurable timezone (defaults to TZ env or Asia/Shanghai)
 *  - Per-task telemetry (lastRunAt, lastStatus, lastError, runCount)
 *  - Cron expression is validated before scheduling
 */
import cron from 'node-cron';
import type { ScheduledTask } from '../core/types.js';
import type { HistoryStore } from '../utils/history-store.js';
import { logger } from '../utils/logger.js';

export type TaskHandler = (task: ScheduledTask) => Promise<void>;

export interface TaskStatus {
  id: string;
  running: boolean;
  lastRunAt: number | null;
  lastStatus: string | null;
  lastError: string | null;
  runCount: number;
}

export class SchedulerManager {
  private jobs = new Map<string, cron.ScheduledTask>();
  private handlers = new Map<string, TaskHandler>();
  private timezone: string;
  private store: HistoryStore | null;

  constructor(opts: { timezone?: string; store?: HistoryStore } = {}) {
    this.timezone = opts.timezone || process.env.TZ || 'Asia/Shanghai';
    this.store = opts.store ?? null;
  }

  setStore(store: HistoryStore): void {
    this.store = store;
  }

  registerHandler(type: string, handler: TaskHandler): void {
    this.handlers.set(type, handler);
  }

  schedule(task: ScheduledTask): void {
    if (this.jobs.has(task.id)) {
      this.cancel(task.id);
    }

    if (!task.enabled) {
      logger.info(`Task "${task.name}" is disabled, skipping`);
      return;
    }

    if (!cron.validate(task.cron)) {
      logger.error(`Invalid cron expression for task "${task.name}": ${task.cron}`);
      return;
    }

    const handler = this.handlers.get(task.type);
    if (!handler) {
      logger.error(`No handler for task type: ${task.type}`);
      return;
    }

    const job = cron.schedule(
      task.cron,
      async () => {
        logger.info(`Running scheduled task: ${task.name}`);
        try {
          await handler(task);
          this.store?.recordTaskRun(task.id, 'ok');
        } catch (err) {
          const msg = (err as Error).message;
          logger.error(`Task "${task.name}" failed: ${msg}`);
          this.store?.recordTaskRun(task.id, 'error', msg);
        }
      },
      { timezone: this.timezone } as any,
    );

    this.jobs.set(task.id, job);
    logger.info(`Scheduled task: ${task.name} (${task.cron}) tz=${this.timezone}`);
  }

  /** Run a task by id immediately, regardless of cron schedule. */
  async runNow(task: ScheduledTask): Promise<void> {
    const handler = this.handlers.get(task.type);
    if (!handler) throw new Error(`No handler for task type: ${task.type}`);
    try {
      await handler(task);
      this.store?.recordTaskRun(task.id, 'ok');
    } catch (err) {
      const msg = (err as Error).message;
      this.store?.recordTaskRun(task.id, 'error', msg);
      throw err;
    }
  }

  getStatus(id: string): TaskStatus {
    const running = this.jobs.has(id);
    const run = this.store?.getTaskRun(id);
    return {
      id,
      running,
      lastRunAt: run?.lastRunAt ?? null,
      lastStatus: run?.lastStatus ?? null,
      lastError: run?.lastError ?? null,
      runCount: run?.runCount ?? 0,
    };
  }

  cancel(id: string): void {
    const job = this.jobs.get(id);
    if (job) {
      job.stop();
      this.jobs.delete(id);
    }
  }

  cancelAll(): void {
    for (const [id, job] of this.jobs) {
      job.stop();
      this.jobs.delete(id);
    }
  }

  getRunning(): string[] {
    return Array.from(this.jobs.keys());
  }
}
