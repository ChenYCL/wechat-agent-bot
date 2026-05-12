/**
 * Multi-tenant wrapper around ProviderRegistry.
 *
 * For each user we keep a private registry containing only their model
 * configs (and therefore only their API keys). The registry's "active"
 * provider is per-user. Operations from REST/skills look up the right
 * registry by userId, then delegate.
 *
 * Caches are lazily built on first access; mutations (add/update/delete)
 * invalidate the cached registry for that user so a fresh one is built
 * on the next read.
 */
import { ProviderRegistry } from '../providers/registry.js';
import type { BaseProvider, ToolBridge } from '../providers/base.js';
import type { HistoryStore } from '../utils/history-store.js';
import type { ModelConfig } from '../core/types.js';
import { UserModelStore, type StoredUserModel } from './model-store.js';
import { logger } from '../utils/logger.js';

export class UserProviderManager {
  private models: UserModelStore;
  private historyStore: HistoryStore;
  private toolBridge: ToolBridge | null = null;
  private cache = new Map<string, ProviderRegistry>();

  constructor(store: HistoryStore) {
    this.historyStore = store;
    this.models = new UserModelStore(store);
  }

  setToolBridge(bridge: ToolBridge | null): void {
    this.toolBridge = bridge;
    // Apply to already-built registries
    for (const reg of this.cache.values()) {
      reg.setToolBridge(bridge);
    }
  }

  private buildRegistry(userId: string): ProviderRegistry {
    const reg = new ProviderRegistry();
    reg.setHistoryStore(this.historyStore);
    if (this.toolBridge) reg.setToolBridge(this.toolBridge);

    const models = this.models.list(userId);
    for (const m of models) {
      try {
        reg.addProvider(toModelConfig(m));
      } catch (err) {
        logger.error(`[providers] user=${userId} model=${m.id} failed to register: ${(err as Error).message}`);
      }
    }
    const active = this.models.getActive(userId);
    if (active) {
      try { reg.setActive(active.id); } catch {/* ignored — registry already chose first */}
    }
    return reg;
  }

  private getOrBuild(userId: string): ProviderRegistry {
    let reg = this.cache.get(userId);
    if (!reg) {
      reg = this.buildRegistry(userId);
      this.cache.set(userId, reg);
    }
    return reg;
  }

  private invalidate(userId: string): void {
    this.cache.delete(userId);
  }

  // ── Read operations ──

  getActive(userId: string): BaseProvider | null {
    return this.getOrBuild(userId).getActive();
  }

  getAll(userId: string): BaseProvider[] {
    return this.getOrBuild(userId).getAll();
  }

  listModels(userId: string): StoredUserModel[] {
    return this.models.list(userId);
  }

  getModel(userId: string, modelId: string): StoredUserModel | null {
    return this.models.get(userId, modelId);
  }

  availableTypes(userId: string): string[] {
    return this.getOrBuild(userId).availableTypes();
  }

  // ── Mutations ──

  addModel(userId: string, config: Omit<ModelConfig, 'id'> & { id?: string; isActive?: boolean }): StoredUserModel {
    const stored = this.models.insert(userId, config);
    if (stored.isActive) this.models.setActive(userId, stored.id);
    this.invalidate(userId);
    // Force-build to surface registration errors immediately.
    this.getOrBuild(userId);
    return stored;
  }

  updateModel(userId: string, modelId: string, patch: Partial<ModelConfig>): StoredUserModel | null {
    const updated = this.models.update(userId, modelId, patch);
    if (updated) this.invalidate(userId);
    return updated;
  }

  removeModel(userId: string, modelId: string): boolean {
    const ok = this.models.delete(userId, modelId);
    if (ok) this.invalidate(userId);
    return ok;
  }

  setActive(userId: string, modelId: string): boolean {
    const ok = this.models.setActive(userId, modelId);
    if (ok) this.invalidate(userId);
    return ok;
  }

  /** For tests / reset. */
  clear(): void {
    this.cache.clear();
  }
}

function toModelConfig(m: StoredUserModel): ModelConfig {
  return {
    id: m.id,
    name: m.name,
    provider: m.provider,
    model: m.model,
    apiKey: m.apiKey,
    baseUrl: m.baseUrl,
    systemPrompt: m.systemPrompt,
    maxHistory: m.maxHistory,
    temperature: m.temperature,
    maxTokens: m.maxTokens,
    stream: m.stream,
    extra: m.extra,
  };
}
