/**
 * Persistent conversation history store.
 *
 * Stores per-conversation message history as JSON files in data/history/.
 * Survives process restarts. Includes TTL-based expiry and max-length trimming.
 */
import { readFile, writeFile, mkdir, readdir, unlink, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from './logger.js';

export interface HistoryMessage {
  role: string;
  content: unknown;
  timestamp?: number;
}

export interface HistoryEntry {
  conversationId: string;
  messages: HistoryMessage[];
  updatedAt: number;
}

const DEFAULT_TTL_MS = 7 * 24 * 3600 * 1000; // 7 days

export class HistoryStore {
  private dir: string;
  private cache = new Map<string, HistoryEntry>();
  private ttlMs: number;
  private dirty = new Set<string>();
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  constructor(dataDir: string, ttlMs = DEFAULT_TTL_MS) {
    this.dir = join(dataDir, 'history');
    this.ttlMs = ttlMs;
  }

  async init(): Promise<void> {
    if (!existsSync(this.dir)) {
      await mkdir(this.dir, { recursive: true });
    }
    // Periodic flush every 10s
    this.flushTimer = setInterval(() => this.flushDirty(), 10_000);
    // Load index on startup (lazy — individual files loaded on access)
    await this.cleanExpired();
  }

  async get(conversationId: string): Promise<HistoryMessage[]> {
    // Check cache
    const cached = this.cache.get(conversationId);
    if (cached) return cached.messages;

    // Load from disk
    const filePath = this.filePath(conversationId);
    try {
      if (existsSync(filePath)) {
        const raw = await readFile(filePath, 'utf-8');
        const entry: HistoryEntry = JSON.parse(raw);
        // Check TTL
        if (Date.now() - entry.updatedAt > this.ttlMs) {
          await unlink(filePath).catch(() => {});
          return [];
        }
        this.cache.set(conversationId, entry);
        return entry.messages;
      }
    } catch {
      // Corrupted file, start fresh
    }
    return [];
  }

  async set(conversationId: string, messages: HistoryMessage[]): Promise<void> {
    const entry: HistoryEntry = {
      conversationId,
      messages,
      updatedAt: Date.now(),
    };
    this.cache.set(conversationId, entry);
    this.dirty.add(conversationId);
  }

  async append(conversationId: string, message: HistoryMessage): Promise<void> {
    const messages = await this.get(conversationId);
    messages.push({ ...message, timestamp: Date.now() });
    await this.set(conversationId, messages);
  }

  async clear(conversationId: string): Promise<void> {
    this.cache.delete(conversationId);
    this.dirty.delete(conversationId);
    const filePath = this.filePath(conversationId);
    await unlink(filePath).catch(() => {});
  }

  async flushDirty(): Promise<void> {
    for (const id of this.dirty) {
      const entry = this.cache.get(id);
      if (!entry) continue;
      try {
        await writeFile(this.filePath(id), JSON.stringify(entry), 'utf-8');
      } catch (err) {
        logger.error(`Failed to persist history for ${id}: ${(err as Error).message}`);
      }
    }
    this.dirty.clear();
  }

  async flushAll(): Promise<void> {
    // Mark all cached as dirty then flush
    for (const id of this.cache.keys()) {
      this.dirty.add(id);
    }
    await this.flushDirty();
  }

  async close(): Promise<void> {
    if (this.flushTimer) clearInterval(this.flushTimer);
    await this.flushAll();
  }

  private async cleanExpired(): Promise<void> {
    try {
      if (!existsSync(this.dir)) return;
      const files = await readdir(this.dir);
      const now = Date.now();
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        const filePath = join(this.dir, file);
        try {
          const st = await stat(filePath);
          if (now - st.mtimeMs > this.ttlMs) {
            await unlink(filePath);
          }
        } catch {}
      }
    } catch {}
  }

  private filePath(conversationId: string): string {
    // Sanitize conversationId for filesystem
    const safe = conversationId.replace(/[^a-zA-Z0-9_@.-]/g, '_');
    return join(this.dir, `${safe}.json`);
  }
}
