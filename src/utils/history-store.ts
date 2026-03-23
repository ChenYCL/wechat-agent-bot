/**
 * Persistent conversation history store — SQLite-backed.
 *
 * All conversation history is stored permanently in data/bot.db.
 * No TTL — conversations persist forever until explicitly cleared.
 */
import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from './logger.js';

export interface HistoryMessage {
  role: string;
  content: unknown;
  timestamp?: number;
}

export class HistoryStore {
  private db: Database.Database;

  constructor(dataDir: string) {
    const dbDir = dataDir;
    if (!existsSync(dbDir)) mkdirSync(dbDir, { recursive: true });
    const dbPath = join(dbDir, 'bot.db');
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
  }

  async init(): Promise<void> {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      CREATE INDEX IF NOT EXISTS idx_history_conv ON history(conversation_id);

      CREATE TABLE IF NOT EXISTS memories (
        conversation_id TEXT NOT NULL,
        key TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
        PRIMARY KEY (conversation_id, key)
      );
    `);
    logger.info(`SQLite database initialized: ${this.db.name}`);
  }

  async get(conversationId: string): Promise<HistoryMessage[]> {
    const rows = this.db.prepare(
      'SELECT role, content, created_at as timestamp FROM history WHERE conversation_id = ? ORDER BY id ASC',
    ).all(conversationId) as Array<{ role: string; content: string; timestamp: number }>;
    return rows.map((r) => ({
      role: r.role,
      content: JSON.parse(r.content),
      timestamp: r.timestamp * 1000,
    }));
  }

  async set(conversationId: string, messages: HistoryMessage[]): Promise<void> {
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM history WHERE conversation_id = ?').run(conversationId);
      const insert = this.db.prepare(
        'INSERT INTO history (conversation_id, role, content) VALUES (?, ?, ?)',
      );
      for (const msg of messages) {
        insert.run(conversationId, msg.role, JSON.stringify(msg.content));
      }
    });
    tx();
  }

  async append(conversationId: string, message: HistoryMessage): Promise<void> {
    this.db.prepare(
      'INSERT INTO history (conversation_id, role, content) VALUES (?, ?, ?)',
    ).run(conversationId, message.role, JSON.stringify(message.content));
  }

  async clear(conversationId: string): Promise<void> {
    this.db.prepare('DELETE FROM history WHERE conversation_id = ?').run(conversationId);
  }

  async close(): Promise<void> {
    this.db.close();
  }

  // ── Memory methods (used by MemoryManager) ──

  getMemory(conversationId: string, key: string): { content: string; createdAt: number; updatedAt: number } | undefined {
    const row = this.db.prepare(
      'SELECT content, created_at, updated_at FROM memories WHERE conversation_id = ? AND key = ?',
    ).get(conversationId, key) as any;
    if (!row) return undefined;
    return { content: row.content, createdAt: row.created_at * 1000, updatedAt: row.updated_at * 1000 };
  }

  getAllMemories(conversationId: string): Record<string, { key: string; content: string; createdAt: number; updatedAt: number }> {
    const rows = this.db.prepare(
      'SELECT key, content, created_at, updated_at FROM memories WHERE conversation_id = ?',
    ).all(conversationId) as any[];
    const result: Record<string, any> = {};
    for (const r of rows) {
      result[r.key] = { key: r.key, content: r.content, createdAt: r.created_at * 1000, updatedAt: r.updated_at * 1000 };
    }
    return result;
  }

  setMemory(conversationId: string, key: string, content: string): void {
    this.db.prepare(`
      INSERT INTO memories (conversation_id, key, content, updated_at)
      VALUES (?, ?, ?, unixepoch())
      ON CONFLICT(conversation_id, key) DO UPDATE SET content = excluded.content, updated_at = unixepoch()
    `).run(conversationId, key, content);
  }

  deleteMemory(conversationId: string, key: string): boolean {
    const result = this.db.prepare(
      'DELETE FROM memories WHERE conversation_id = ? AND key = ?',
    ).run(conversationId, key);
    return result.changes > 0;
  }
}
