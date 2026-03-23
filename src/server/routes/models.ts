import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import type { ServerDeps } from '../index.js';

export function createModelRoutes(deps: ServerDeps) {
  const router = Router();

  // List all model configs
  router.get('/', (_req, res) => {
    const models = deps.config.get().models;
    const active = deps.providers.getActive();
    res.json({
      models: models.map((m) => ({
        ...m,
        apiKey: m.apiKey ? `***${m.apiKey.slice(-4)}` : '',
      })),
      activeId: active?.id ?? null,
      availableProviders: deps.providers.availableTypes(),
    });
  });

  // Add a new model
  router.post('/', async (req, res) => {
    try {
      const { name, provider, model: modelId, apiKey, baseUrl, systemPrompt, maxHistory, temperature, maxTokens, stream } = req.body;
      if (!name || typeof name !== 'string') return res.status(400).json({ error: 'name is required' });
      if (!provider || typeof provider !== 'string') return res.status(400).json({ error: 'provider is required' });
      if (!modelId || typeof modelId !== 'string') return res.status(400).json({ error: 'model is required' });
      if (!apiKey || typeof apiKey !== 'string') return res.status(400).json({ error: 'apiKey is required' });
      const model = {
        id: req.body.id || randomUUID(),
        name, provider, model: modelId, apiKey,
        baseUrl: baseUrl || undefined,
        systemPrompt: systemPrompt || undefined,
        maxHistory: typeof maxHistory === 'number' ? maxHistory : undefined,
        temperature: typeof temperature === 'number' ? temperature : undefined,
        maxTokens: typeof maxTokens === 'number' ? maxTokens : undefined,
        stream: typeof stream === 'boolean' ? stream : undefined,
      };
      deps.config.addModel(model);
      deps.providers.addProvider(model);
      await deps.config.save();
      res.json({ ok: true, id: model.id });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // Update a model
  router.put('/:id', async (req, res) => {
    try {
      const { id } = req.params;
      deps.config.updateModel(id, req.body);
      // Re-register provider with updated config
      const model = deps.config.get().models.find((m) => m.id === id);
      if (model) {
        deps.providers.removeProvider(id);
        deps.providers.addProvider(model);
      }
      await deps.config.save();
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // Delete a model
  router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    deps.config.removeModel(id);
    deps.providers.removeProvider(id);
    await deps.config.save();
    res.json({ ok: true });
  });

  // Set active model
  router.post('/:id/activate', (req, res) => {
    try {
      deps.providers.setActive(req.params.id);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  return router;
}
