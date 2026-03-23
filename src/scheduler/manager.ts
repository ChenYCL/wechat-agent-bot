/**
 * Cron-based scheduler for automated tasks like
 * research reports, daily summaries, etc.
 */
import cron from 'node-cron';
import type { ScheduledTask } from '../core/types.js';
import { logger } from '../utils/logger.js';

export type TaskHandler = (task: ScheduledTask) => Promise<void>;

export class SchedulerManager {
  private jobs = new Map<string, cron.ScheduledTask>();
  private handlers = new Map<string, TaskHandler>();

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

    const job = cron.schedule(task.cron, async () => {
      logger.info(`Running scheduled task: ${task.name}`);
      try {
        await handler(task);
      } catch (err) {
        logger.error(`Task "${task.name}" failed: ${(err as Error).message}`);
      }
    });

    this.jobs.set(task.id, job);
    logger.info(`Scheduled task: ${task.name} (${task.cron})`);
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
