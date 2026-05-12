/**
 * Skills used to depend on ProviderRegistry directly, which is a single
 * "active provider" view. To support multi-tenant deployments (each
 * user has their own provider list + active model), skills now depend
 * on this narrower interface and we provide two adapters:
 *
 *   - fromRegistry(reg)           — single-tenant (tests, dev mode)
 *   - fromUserProviders(upm, ctx) — multi-tenant (production)
 *
 * The adapter resolves "who is calling" from the conversationId.
 */
import type { BaseProvider } from '../providers/base.js';
import type { ProviderRegistry } from '../providers/registry.js';
import type { UserProviderManager } from '../accounts/provider-manager.js';
import type { ContextResolver } from '../accounts/context.js';

export interface ProviderSummary {
  id: string;
  name: string;
  model: string;
  active: boolean;
}

export interface ProviderAccess {
  getActive(conversationId: string): BaseProvider | null;
  list(conversationId: string): ProviderSummary[];
  setActive(conversationId: string, modelId: string): { ok: boolean; provider?: BaseProvider; error?: string };
}

export function fromRegistry(registry: ProviderRegistry): ProviderAccess {
  return {
    getActive: () => registry.getActive(),
    list: () => {
      const active = registry.getActive();
      return registry.getAll().map((p) => ({
        id: p.id,
        name: p.name,
        model: p.config.model,
        active: p.id === active?.id,
      }));
    },
    setActive: (_conv, id) => {
      try { registry.setActive(id); return { ok: true, provider: registry.getActive() ?? undefined }; }
      catch (err) { return { ok: false, error: (err as Error).message }; }
    },
  };
}

export function fromUserProviders(upm: UserProviderManager, ctx: ContextResolver): ProviderAccess {
  return {
    getActive: (cid: string) => {
      const c = ctx.fromScopedId(cid);
      if (!c) return null;
      return upm.getActive(c.userId);
    },
    list: (cid: string) => {
      const c = ctx.fromScopedId(cid);
      if (!c) return [];
      const all = upm.getAll(c.userId);
      const active = upm.getActive(c.userId);
      return all.map((p) => ({
        id: p.id,
        name: p.name,
        model: p.config.model,
        active: p.id === active?.id,
      }));
    },
    setActive: (cid: string, id: string) => {
      const c = ctx.fromScopedId(cid);
      if (!c) return { ok: false, error: 'Conversation does not belong to any user' };
      const ok = upm.setActive(c.userId, id);
      if (!ok) return { ok: false, error: `Model ${id} not found` };
      return { ok: true, provider: upm.getActive(c.userId) ?? undefined };
    },
  };
}
