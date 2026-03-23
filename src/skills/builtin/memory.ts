/**
 * Memory system — persistent user memories backed by SQLite.
 *
 * /remember <key> <content>  — save a memory
 * /recall [key]              — recall memories
 * /forget <key>              — delete a memory
 *
 * Memories are permanent (no TTL), stored in data/bot.db.
 */
import type { Skill } from '../registry.js';
import type { ChatRequest, ChatResponse } from '../../core/types.js';
import type { HistoryStore } from '../../utils/history-store.js';
import { logger } from '../../utils/logger.js';

export interface Memory {
  key: string;
  content: string;
  createdAt: number;
  updatedAt: number;
}

export class MemoryManager {
  private store: HistoryStore;

  constructor(store: HistoryStore) {
    this.store = store;
  }

  async init(): Promise<void> {
    // DB tables already created by HistoryStore.init()
  }

  async getAll(conversationId: string): Promise<Record<string, Memory>> {
    return this.store.getAllMemories(conversationId);
  }

  async get(conversationId: string, key: string): Promise<Memory | undefined> {
    const m = this.store.getMemory(conversationId, key);
    if (!m) return undefined;
    return { key, ...m };
  }

  async set(conversationId: string, key: string, content: string): Promise<void> {
    this.store.setMemory(conversationId, key, content);
  }

  async delete(conversationId: string, key: string): Promise<boolean> {
    return this.store.deleteMemory(conversationId, key);
  }

  async buildContext(conversationId: string): Promise<string> {
    const memories = this.store.getAllMemories(conversationId);
    const entries = Object.values(memories);
    if (entries.length === 0) return '';
    const lines = entries
      .filter((m) => !m.key.startsWith('_')) // skip internal keys like _lang
      .map((m) => `- ${m.key}: ${m.content}`);
    if (lines.length === 0) return '';
    return `\n[User memories]\n${lines.join('\n')}\n`;
  }
}

export function createRememberSkill(manager: MemoryManager): Skill {
  return {
    name: 'remember',
    description: 'Save a memory. Usage: /remember <key> <content>',
    async execute(request: ChatRequest): Promise<ChatResponse> {
      const text = request.text?.trim() ?? '';
      const spaceIdx = text.indexOf(' ');
      if (!text || spaceIdx < 0) {
        return { text: 'Usage: /remember <key> <content>\nExample: /remember name Alice' };
      }
      const key = text.slice(0, spaceIdx).toLowerCase();
      const content = text.slice(spaceIdx + 1).trim();
      if (!content) return { text: 'Content cannot be empty.' };
      await manager.set(request.conversationId, key, content);
      logger.info(`Memory saved: [${request.conversationId}] ${key}`);
      return { text: `💾 Remembered: ${key} = ${content}` };
    },
  };
}

export function createRecallSkill(manager: MemoryManager): Skill {
  return {
    name: 'recall',
    description: 'Recall memories. Usage: /recall [key] or /recall to list all',
    async execute(request: ChatRequest): Promise<ChatResponse> {
      const key = request.text?.trim().toLowerCase();
      if (key) {
        const memory = await manager.get(request.conversationId, key);
        if (!memory) return { text: `No memory found for "${key}".` };
        const date = new Date(memory.updatedAt).toLocaleString('zh-CN');
        return { text: `🔍 ${memory.key}: ${memory.content}\n(updated: ${date})` };
      }
      const memories = await manager.getAll(request.conversationId);
      const entries = Object.values(memories).filter((m) => !m.key.startsWith('_'));
      if (entries.length === 0) {
        return { text: 'No memories saved yet. Use /remember <key> <content>.' };
      }
      const lines = entries.map((m) => {
        const date = new Date(m.updatedAt).toLocaleString('zh-CN');
        return `- ${m.key}: ${m.content} (${date})`;
      });
      return { text: `📋 Memories (${entries.length}):\n${lines.join('\n')}` };
    },
  };
}

export function createForgetSkill(manager: MemoryManager): Skill {
  return {
    name: 'forget',
    description: 'Delete a memory. Usage: /forget <key>',
    async execute(request: ChatRequest): Promise<ChatResponse> {
      const key = request.text?.trim().toLowerCase();
      if (!key) return { text: 'Usage: /forget <key>' };
      const deleted = await manager.delete(request.conversationId, key);
      if (!deleted) return { text: `No memory found for "${key}".` };
      return { text: `❌ Forgot: ${key}` };
    },
  };
}
