import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import type { ServerDeps } from '../index.js';

export function createTaskRoutes(deps: ServerDeps) {
  const router = Router();

  router.get('/', (_req, res) => {
    const tasks = deps.config.get().scheduledTasks;
    const running = deps.scheduler.getRunning();
    res.json({
      tasks: tasks.map((t) => ({ ...t, running: running.includes(t.id) })),
    });
  });

  router.post('/', async (req, res) => {
    try {
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

  return router;
}
