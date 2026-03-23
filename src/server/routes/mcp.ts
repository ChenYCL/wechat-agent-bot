import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import type { ServerDeps } from '../index.js';

export function createMcpRoutes(deps: ServerDeps) {
  const router = Router();

  router.get('/', (_req, res) => {
    const servers = deps.config.get().mcpServers;
    const tools = deps.mcp.getAvailableTools();
    res.json({ servers, tools });
  });

  router.post('/', async (req, res) => {
    try {
      const server = { ...req.body, id: req.body.id || randomUUID() };
      deps.config.addMcpServer(server);
      const tools = await deps.mcp.connect(server);
      await deps.config.save();
      res.json({ ok: true, id: server.id, tools });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  router.delete('/:id', async (req, res) => {
    deps.config.removeMcpServer(req.params.id);
    await deps.config.save();
    res.json({ ok: true });
  });

  router.post('/tools/:name/call', async (req, res) => {
    try {
      const result = await deps.mcp.callTool(req.params.name, req.body.args || {});
      res.json({ ok: true, result });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // Search MCP servers from Anthropic registry
  router.get('/search', async (req, res) => {
    try {
      const q = (req.query as Record<string, string>).q || '';
      if (!q) return res.json({ servers: [] });
      const response = await fetch(
        `https://registry.modelcontextprotocol.io/servers?q=${encodeURIComponent(q)}&count=20`,
        { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(10_000) },
      );
      if (!response.ok) {
        // Fallback: return empty on registry failure
        return res.json({ servers: [], error: `Registry returned ${response.status}` });
      }
      const data = await response.json();
      res.json(data);
    } catch (err) {
      res.json({ servers: [], error: (err as Error).message });
    }
  });

  return router;
}
