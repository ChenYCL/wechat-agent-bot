import { Router } from 'express';
import type { ServerDeps } from '../index.js';

export function createStatusRoutes(deps: ServerDeps) {
  const router = Router();

  router.get('/', (_req, res) => {
    const config = deps.config.get();
    const activeProvider = deps.providers.getActive();
    const skills = deps.skills.getAll();
    const mcpTools = deps.mcp.getAvailableTools();
    const runningTasks = deps.scheduler.getRunning();

    res.json({
      status: 'running',
      activeProvider: activeProvider
        ? { id: activeProvider.id, name: activeProvider.name, model: activeProvider.config.model }
        : null,
      models: config.models.length,
      skills: skills.map((s) => ({ name: s.name, description: s.description })),
      mcpTools: mcpTools.length,
      scheduledTasks: {
        total: config.scheduledTasks.length,
        running: runningTasks.length,
      },
    });
  });

  // Test: send a message through the pipeline (dry-run, doesn't go to WeChat)
  router.post('/test-message', async (req, res) => {
    try {
      const { text, conversationId } = req.body;
      if (!text || typeof text !== 'string') {
        return res.status(400).json({ error: 'text is required' });
      }
      const provider = deps.providers.getActive();
      if (!provider) {
        return res.json({ ok: true, reply: '⚠️ No active provider configured' });
      }

      // Check for skill
      const trimmed = text.trim();
      if (trimmed.startsWith('/')) {
        const spaceIdx = trimmed.indexOf(' ');
        const cmd = spaceIdx > 0 ? trimmed.slice(1, spaceIdx) : trimmed.slice(1);
        const args = spaceIdx > 0 ? trimmed.slice(spaceIdx + 1) : '';
        const skill = deps.skills.get(cmd);
        if (skill) {
          const result = await skill.execute({ conversationId: conversationId || 'webui-test', text: args });
          return res.json({ ok: true, reply: result.text || '[no text]', source: 'skill' });
        }
      }

      const result = await provider.chat({
        conversationId: conversationId || 'webui-test',
        text,
      });
      res.json({ ok: true, reply: result.text || '[no text]', source: 'provider' });
    } catch (err) {
      res.json({ ok: false, reply: `Error: ${(err as Error).message}` });
    }
  });

  return router;
}
