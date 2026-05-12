/**
 * REST endpoints for user-created tasks (reminders & watches).
 *
 * GET    /api/user-tasks              list (optional ?conversationId=)
 * GET    /api/user-tasks/:id          detail
 * POST   /api/user-tasks              create (admin path; bypass LLM parser)
 * POST   /api/user-tasks/parse        parse NL into a draft (preview, no save)
 * PUT    /api/user-tasks/:id          patch message / schedule / watch
 * POST   /api/user-tasks/:id/run      trigger now
 * POST   /api/user-tasks/:id/pause    disable
 * POST   /api/user-tasks/:id/resume   re-enable
 * DELETE /api/user-tasks/:id          delete + observations
 * GET    /api/user-tasks/:id/history  recent observations
 */
import { Router } from 'express';
import type { ServerDeps } from '../index.js';
import type { UserTaskManager } from '../../tasks/manager.js';
import { parseTaskFromText } from '../../tasks/parser.js';
import { fromRegistry } from '../../skills/provider-access.js';

export interface UserTaskRoutesDeps extends ServerDeps {
  userTasks: UserTaskManager;
}

export function createUserTaskRoutes(deps: UserTaskRoutesDeps) {
  const router = Router();
  const { userTasks } = deps;

  router.get('/', (req, res) => {
    const conv = (req.query as Record<string, string>).conversationId;
    res.json({ tasks: conv ? userTasks.list(conv) : deps.userTasks.list('') });
  });

  router.get('/:id', (req, res) => {
    const t = userTasks.get(req.params.id);
    if (!t) return res.status(404).json({ error: 'Task not found' });
    res.json({ task: t });
  });

  router.post('/', (req, res) => {
    try {
      const { ownerConversationId, type, description, message, schedule, watch } = req.body || {};
      if (!ownerConversationId) return res.status(400).json({ error: 'ownerConversationId is required' });
      const task = userTasks.create({ ownerConversationId, type, description, message, schedule, watch });
      res.json({ ok: true, task });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  router.post('/parse', async (req, res) => {
    const { text, ownerConversationId, language } = req.body || {};
    if (!text || !ownerConversationId) {
      return res.status(400).json({ error: 'text and ownerConversationId are required' });
    }
    const result = await parseTaskFromText(text, {
      providers: fromRegistry(deps.providers),
      ownerConversationId,
      language,
    });
    res.json(result);
  });

  router.put('/:id', (req, res) => {
    try {
      const updated = userTasks.applyEdit(req.params.id, req.body || {});
      if (!updated) return res.status(404).json({ error: 'Task not found' });
      res.json({ ok: true, task: updated });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  router.post('/:id/run', async (req, res) => {
    try {
      await userTasks.runNow(req.params.id);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  router.post('/:id/pause', (req, res) => {
    const u = userTasks.setEnabled(req.params.id, false);
    if (!u) return res.status(404).json({ error: 'Task not found' });
    res.json({ ok: true, task: u });
  });

  router.post('/:id/resume', (req, res) => {
    const u = userTasks.setEnabled(req.params.id, true);
    if (!u) return res.status(404).json({ error: 'Task not found' });
    res.json({ ok: true, task: u });
  });

  router.delete('/:id', (req, res) => {
    const ok = userTasks.delete(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Task not found' });
    res.json({ ok: true });
  });

  router.get('/:id/history', (req, res) => {
    const t = userTasks.get(req.params.id);
    if (!t) return res.status(404).json({ error: 'Task not found' });
    const limit = Math.min(Number((req.query as Record<string, string>).limit) || 50, 500);
    res.json({ observations: userTasks.observations(req.params.id, limit) });
  });

  return router;
}
