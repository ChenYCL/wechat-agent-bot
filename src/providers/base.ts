/**
 * Base provider interface - all AI model providers implement this.
 */
import type { Agent, ModelConfig } from '../core/types.js';
import type { HistoryStore } from '../utils/history-store.js';

export interface ToolDescriptor {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

/**
 * Per-invocation context passed by the provider to `callTool`. Tools
 * that need to know which conversation they're acting for (e.g. user
 * task management) read it from here.
 */
export interface ToolContext {
  conversationId?: string;
}

/**
 * Bridge that exposes MCP / external tools to providers. Providers
 * inject the tool list into model calls and invoke `callTool` when
 * the model emits a tool_use / tool_call.
 */
export interface ToolBridge {
  listTools(): ToolDescriptor[];
  callTool(name: string, args: Record<string, unknown>, ctx?: ToolContext): Promise<unknown>;
}

export interface BaseProvider extends Agent {
  readonly id: string;
  readonly name: string;
  readonly config: ModelConfig;
  setHistoryStore?(store: HistoryStore): void;
  setToolBridge?(bridge: ToolBridge | null): void;
}

export abstract class AbstractProvider implements BaseProvider {
  readonly id: string;
  readonly name: string;
  readonly config: ModelConfig;
  protected histories = new Map<string, Array<{ role: string; content: unknown }>>();
  protected historyStore: HistoryStore | null = null;
  protected toolBridge: ToolBridge | null = null;

  constructor(config: ModelConfig) {
    this.id = config.id;
    this.name = config.name;
    this.config = config;
  }

  setHistoryStore(store: HistoryStore): void {
    this.historyStore = store;
  }

  setToolBridge(bridge: ToolBridge | null): void {
    this.toolBridge = bridge;
  }

  abstract chat(request: import('../core/types.js').ChatRequest): Promise<import('../core/types.js').ChatResponse>;

  async clearSession(conversationId: string): Promise<void> {
    this.histories.delete(conversationId);
    if (this.historyStore) {
      await this.historyStore.clear(conversationId);
    }
  }

  protected async getHistory(conversationId: string) {
    if (!this.histories.has(conversationId)) {
      // Try loading from persistent store
      if (this.historyStore) {
        const persisted = await this.historyStore.get(conversationId);
        if (persisted.length > 0) {
          this.histories.set(conversationId, persisted);
          return persisted;
        }
      }
      this.histories.set(conversationId, []);
    }
    return this.histories.get(conversationId)!;
  }

  protected async trimHistory(conversationId: string) {
    const max = this.config.maxHistory ?? 50;
    const history = this.histories.get(conversationId);
    if (!history) return;
    if (history.length > max) {
      history.splice(0, history.length - max);
    }
    // Persist to store
    if (this.historyStore) {
      await this.historyStore.set(conversationId, history as any);
    }
  }
}
