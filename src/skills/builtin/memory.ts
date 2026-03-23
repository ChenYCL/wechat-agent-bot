/**
 * Built-in /remember and /recall skills — persistent user memory.
 *
 * Similar to Claude's memory system:
 *   /remember <key> <content>  — save a memory
 *   /recall [key]              — recall a specific memory or list all
 *   /forget <key>              — delete a memory
 *
 * Memories are stored per-conversation in data/memories/ as JSON files.
 * They survive restarts and can be injected into system prompts.
 */
import { readFile, writeFile, mkdir, unlink, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Skill } from '../registry.js';
import type { ChatRequest, ChatResponse } from '../../core/types.js';
import { logger } from '../../utils/logger.js';

export interface Memory {
  key: string;
  content: string;
  createdAt: number;
  updatedAt: number;
}

export interface MemoryFile {
  conversationId: string;
  memories: Record<string, Memory>;
}

export class MemoryManager {
  private dir: string;
  private cache = new Map<string, MemoryFile>();

  constructor(dataDir: string) {
    this.dir = join(dataDir, 'memories');
  }

  async init(): Promise<void> {
    if (!existsSync(this.dir)) {
      await mkdir(this.dir, { recursive: true });
    }
  }

  async getAll(conversationId: string): Promise<Record<string, Memory>> {
    const file = await this.loadFile(conversationId);
    return file.memories;
  }

  async get(conversationId: string, key: string): Promise<Memory | undefined> {
    const file = await this.loadFile(conversationId);
    return file.memories[key];
  }

  async set(conversationId: string, key: string, content: string): Promise<void> {
    const file = await this.loadFile(conversationId);
    const existing = file.memories[key];
    file.memories[key] = {
      key,
      content,
      createdAt: existing?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
    };
    await this.saveFile(conversationId, file);
  }

  async delete(conversationId: string, key: string): Promise<boolean> {
    const file = await this.loadFile(conversationId);
    if (!(key in file.memories)) return false;
    delete file.memories[key];
    await this.saveFile(conversationId, file);
    return true;
  }

  /** Build a memory context string for injection into system prompts. */
  async buildContext(conversationId: string): Promise<string> {
    const memories = await this.getAll(conversationId);
    const entries = Object.values(memories);
    if (entries.length === 0) return '';
    const lines = entries.map((m) => `- ${m.key}: ${m.content}`);
    return `\n[User memories for this conversation]\n${lines.join('\n')}\n`;
  }

  /** List all conversations that have memories. */
  async listConversations(): Promise<string[]> {
    if (!existsSync(this.dir)) return [];
    const files = await readdir(this.dir);
    return files
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace('.json', ''));
  }

  private filePath(conversationId: string): string {
    const safe = conversationId.replace(/[^a-zA-Z0-9_@.-]/g, '_');
    return join(this.dir, `${safe}.json`);
  }

  private async loadFile(conversationId: string): Promise<MemoryFile> {
    if (this.cache.has(conversationId)) return this.cache.get(conversationId)!;
    const path = this.filePath(conversationId);
    try {
      if (existsSync(path)) {
        const raw = await readFile(path, 'utf-8');
        const file: MemoryFile = JSON.parse(raw);
        this.cache.set(conversationId, file);
        return file;
      }
    } catch {}
    const file: MemoryFile = { conversationId, memories: {} };
    this.cache.set(conversationId, file);
    return file;
  }

  private async saveFile(conversationId: string, file: MemoryFile): Promise<void> {
    this.cache.set(conversationId, file);
    await writeFile(this.filePath(conversationId), JSON.stringify(file, null, 2), 'utf-8');
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
        return { text: 'Usage: /remember <key> <content>\nExample: /remember name I am Alice' };
      }
      const key = text.slice(0, spaceIdx).toLowerCase();
      const content = text.slice(spaceIdx + 1).trim();
      if (!content) {
        return { text: 'Content cannot be empty.' };
      }
      await manager.set(request.conversationId, key, content);
      logger.info(`Memory saved: [${request.conversationId}] ${key}`);
      return { text: `Remembered: ${key} = ${content}` };
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
        return { text: `${memory.key}: ${memory.content}\n(updated: ${date})` };
      }

      // List all
      const memories = await manager.getAll(request.conversationId);
      const entries = Object.values(memories);
      if (entries.length === 0) {
        return { text: 'No memories saved yet. Use /remember <key> <content> to save one.' };
      }
      const lines = entries.map((m) => {
        const date = new Date(m.updatedAt).toLocaleString('zh-CN');
        return `- ${m.key}: ${m.content} (${date})`;
      });
      return { text: `Memories (${entries.length}):\n${lines.join('\n')}` };
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
      return { text: `Forgot: ${key}` };
    },
  };
}
