import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import cron from 'node-cron';
import type { ServerDeps } from '../index.js';

const VALID_TYPES = new Set(['report']);

export function createTaskRoutes(deps: ServerDeps) {
  const router = Router();

  router.get('/', (_req, res) => {
    const tasks = deps.config.get().scheduledTasks;
    const running = deps.scheduler.getRunning();
    res.json({
      tasks: tasks.map((t) => ({
        ...t,
        running: running.includes(t.id),
        status: deps.scheduler.getStatus(t.id),
      })),
    });
  });

  router.post('/', async (req, res) => {
    try {
      const { cron: cronExpr, type } = req.body || {};
      if (!cronExpr || typeof cronExpr !== 'string' || !cron.validate(cronExpr)) {
        return res.status(400).json({ error: `Invalid cron expression: ${cronExpr}` });
      }
      if (type && !VALID_TYPES.has(type)) {
        return res.status(400).json({ error: `Unknown task type: ${type}. Allowed: ${[...VALID_TYPES].join(', ')}` });
      }
      const task = { ...req.body, id: req.body.id || randomUUID() };
      deps.config.addTask(task);
      deps.scheduler.schedule(task);
      await deps.config.save();
      res.json({ ok: true, id: task.id });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  router.put('/:id', async (req, res) => {
    try {
      const { id } = req.params;
      if (req.body.cron && !cron.validate(req.body.cron)) {
        return res.status(400).json({ error: `Invalid cron expression: ${req.body.cron}` });
      }
      deps.config.updateTask(id, req.body);
      const task = deps.config.get().scheduledTasks.find((t) => t.id === id);
      if (task) {
        deps.scheduler.cancel(id);
        deps.scheduler.schedule(task);
      }
      await deps.config.save();
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    deps.config.removeTask(id);
    deps.scheduler.cancel(id);
    await deps.config.save();
    res.json({ ok: true });
  });

  /** Manually trigger a task immediately (useful for testing/debugging). */
  router.post('/:id/run', async (req, res) => {
    try {
      const { id } = req.params;
      const task = deps.config.get().scheduledTasks.find((t) => t.id === id);
      if (!task) return res.status(404).json({ error: 'Task not found' });
      await deps.scheduler.runNow(task);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}
