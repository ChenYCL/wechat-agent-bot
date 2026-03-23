/**
 * Provider registry - manages multiple AI providers and
 * allows switching the active one.
 */
import type { BaseProvider } from './base.js';
import type { ModelConfig } from '../core/types.js';
import type { HistoryStore } from '../utils/history-store.js';
import { OpenAIProvider } from './openai.js';
import { AnthropicProvider } from './anthropic.js';
import { ClaudeCodeProvider } from './claude-code.js';
import { logger } from '../utils/logger.js';

type ProviderFactory = (config: ModelConfig) => BaseProvider;

const builtinFactories: Record<string, ProviderFactory> = {
  openai: (config) => new OpenAIProvider(config),
  anthropic: (config) => new AnthropicProvider(config),
  'claude-code': (config) => new ClaudeCodeProvider(config),
};

export class ProviderRegistry {
  private providers = new Map<string, BaseProvider>();
  private activeId: string | null = null;
  private customFactories = new Map<string, ProviderFactory>();
  private historyStore: HistoryStore | null = null;

  setHistoryStore(store: HistoryStore): void {
    this.historyStore = store;
    // Apply to existing providers
    for (const provider of this.providers.values()) {
      if (provider.setHistoryStore) provider.setHistoryStore(store);
    }
  }

  registerFactory(name: string, factory: ProviderFactory): void {
    this.customFactories.set(name, factory);
  }

  addProvider(config: ModelConfig): BaseProvider {
    const factory = this.customFactories.get(config.provider)
      ?? builtinFactories[config.provider];

    if (!factory) {
      throw new Error(`Unknown provider type: ${config.provider}. Available: ${this.availableTypes().join(', ')}`);
    }

    const provider = factory(config);
    if (this.historyStore && provider.setHistoryStore) {
      provider.setHistoryStore(this.historyStore);
    }
    this.providers.set(config.id, provider);
    logger.info(`Registered provider: ${config.name} (${config.provider}/${config.model})`);

    if (!this.activeId) {
      this.activeId = config.id;
    }

    return provider;
  }

  removeProvider(id: string): void {
    this.providers.delete(id);
    if (this.activeId === id) {
      this.activeId = this.providers.keys().next().value ?? null;
    }
  }

  setActive(id: string): void {
    if (!this.providers.has(id)) {
      throw new Error(`Provider not found: ${id}`);
    }
    this.activeId = id;
    logger.info(`Active provider set to: ${id}`);
  }

  getActive(): BaseProvider | null {
    if (!this.activeId) return null;
    return this.providers.get(this.activeId) ?? null;
  }

  getAll(): BaseProvider[] {
    return Array.from(this.providers.values());
  }

  get(id: string): BaseProvider | undefined {
    return this.providers.get(id);
  }

  availableTypes(): string[] {
    return [
      ...Object.keys(builtinFactories),
      ...this.customFactories.keys(),
    ];
  }
}
