/**
 * /api/me/models — per-user model configurations (multi-tenant).
 *
 *   GET    /                       List my models
 *   POST   /                       Add a model
 *   PUT    /:id                    Update a model
 *   DELETE /:id                    Remove
 *   POST   /:id/activate           Set as active for this user
 *
 * API keys are stored at full strength but redacted in responses.
 */
import { Router } from 'express';
import { requireUser } from '../../auth/middleware.js';
import type { UserProviderManager } from '../../accounts/provider-manager.js';

const REQUIRED = ['name', 'provider', 'model', 'apiKey'] as const;

function maskKey(k: string | null | undefined): string {
  if (!k) return '';
  return `***${k.slice(-4)}`;
}

function serialize(m: any) {
  return {
    id: m.id,
    name: m.name,
    provider: m.provider,
    model: m.model,
    apiKey: maskKey(m.apiKey),
    baseUrl: m.baseUrl,
    systemPrompt: m.systemPrompt,
    maxHistory: m.maxHistory,
    temperature: m.temperature,
    maxTokens: m.maxTokens,
    stream: m.stream,
    extra: m.extra,
    isActive: m.isActive,
    createdAt: m.createdAt,
  };
}

export function createUserModelRoutes(upm: UserProviderManager) {
  const router = Router();
  router.use(requireUser);

  router.get('/', (req, res) => {
    const models = upm.listModels(req.user!.id);
    res.json({
      models: models.map(serialize),
      availableProviders: upm.availableTypes(req.user!.id),
    });
  });

  router.post('/', (req, res) => {
    const body = req.body || {};
    for (const key of REQUIRED) {
      if (!body[key] || typeof body[key] !== 'string') {
        return res.status(400).json({ error: `${key} is required` });
      }
    }
    try {
      const stored = upm.addModel(req.user!.id, {
        name: body.name,
        provider: body.provider,
        model: body.model,
        apiKey: body.apiKey,
        baseUrl: body.baseUrl,
        systemPrompt: body.systemPrompt,
        maxHistory: body.maxHistory,
        temperature: body.temperature,
        maxTokens: body.maxTokens,
        stream: body.stream,
        extra: body.extra,
        isActive: body.isActive,
      });
      res.json({ ok: true, model: serialize(stored) });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  router.put('/:id', (req, res) => {
    const updated = upm.updateModel(req.user!.id, req.params.id, req.body || {});
    if (!updated) return res.status(404).json({ error: 'Model not found' });
    res.json({ ok: true, model: serialize(updated) });
  });

  router.delete('/:id', (req, res) => {
    const ok = upm.removeModel(req.user!.id, req.params.id);
    if (!ok) return res.status(404).json({ error: 'Model not found' });
    res.json({ ok: true });
  });

  router.post('/:id/activate', (req, res) => {
    const ok = upm.setActive(req.user!.id, req.params.id);
    if (!ok) return res.status(404).json({ error: 'Model not found' });
    res.json({ ok: true });
  });

  return router;
}
