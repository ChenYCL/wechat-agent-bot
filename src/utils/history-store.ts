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
import type { UserTask, TaskType, ReminderSchedule, WatchSpec } from '../tasks/types.js';

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

      CREATE TABLE IF NOT EXISTS outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        source TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        delivered_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_outbox_conv ON outbox(conversation_id, delivered_at);

      CREATE TABLE IF NOT EXISTS task_runs (
        task_id TEXT PRIMARY KEY,
        last_run_at INTEGER,
        last_status TEXT,
        last_error TEXT,
        run_count INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS user_tasks (
        id TEXT PRIMARY KEY,
        owner_conversation_id TEXT NOT NULL,
        description TEXT NOT NULL,
        type TEXT NOT NULL,
        spec TEXT NOT NULL,
        message TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
        last_triggered_at INTEGER,
        trigger_count INTEGER NOT NULL DEFAULT 0,
        last_seen_value TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_user_tasks_owner ON user_tasks(owner_conversation_id);

      CREATE TABLE IF NOT EXISTS watch_observations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL,
        value TEXT,
        matched INTEGER NOT NULL DEFAULT 0,
        observed_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      CREATE INDEX IF NOT EXISTS idx_obs_task ON watch_observations(task_id, id DESC);

      -- ── Multi-tenant tables (added in the multi-user refactor) ──

      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        is_admin INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );

      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        expires_at INTEGER NOT NULL,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

      CREATE TABLE IF NOT EXISTS wechat_accounts (
        account_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        alias TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        last_seen_at INTEGER,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_wechat_accounts_user ON wechat_accounts(user_id);

      CREATE TABLE IF NOT EXISTS user_models (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        api_key TEXT NOT NULL,
        base_url TEXT,
        system_prompt TEXT,
        max_history INTEGER,
        temperature REAL,
        max_tokens INTEGER,
        stream INTEGER,
        extra TEXT,
        is_active INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_user_models_user ON user_models(user_id);
    `);

    // Schema upgrades for pre-multi-tenant DBs
    this.ensureColumn('user_tasks', 'owner_user_id', 'TEXT');
    logger.info(`SQLite database initialized: ${this.db.name}`);
  }

  /** ALTER TABLE ADD COLUMN if it isn't already present. Used for in-place upgrades. */
  private ensureColumn(table: string, column: string, decl: string): void {
    const cols = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (cols.some((c) => c.name === column)) return;
    this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
  }

  /** Expose raw DB for adapter classes (AuthStore, AccountStore, etc.). */
  get rawDb(): Database.Database {
    return this.db;
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

  // ── Outbox: queued messages to deliver to a conversation ──

  enqueueOutbox(conversationId: string, payload: { text?: string; media?: unknown }, source?: string): number {
    const result = this.db.prepare(
      'INSERT INTO outbox (conversation_id, payload, source) VALUES (?, ?, ?)',
    ).run(conversationId, JSON.stringify(payload), source ?? null);
    return Number(result.lastInsertRowid);
  }

  /** Atomically return undelivered outbox entries and mark them delivered. */
  drainOutbox(conversationId: string): Array<{ id: number; payload: { text?: string; media?: unknown }; source: string | null; createdAt: number }> {
    const rows = this.db.prepare(
      'SELECT id, payload, source, created_at FROM outbox WHERE conversation_id = ? AND delivered_at IS NULL ORDER BY id ASC',
    ).all(conversationId) as Array<{ id: number; payload: string; source: string | null; created_at: number }>;
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const placeholders = ids.map(() => '?').join(',');
    this.db.prepare(
      `UPDATE outbox SET delivered_at = unixepoch() WHERE id IN (${placeholders})`,
    ).run(...ids);
    return rows.map((r) => ({
      id: r.id,
      payload: JSON.parse(r.payload),
      source: r.source,
      createdAt: r.created_at * 1000,
    }));
  }

  pendingOutboxCount(conversationId: string): number {
    const row = this.db.prepare(
      'SELECT COUNT(*) as n FROM outbox WHERE conversation_id = ? AND delivered_at IS NULL',
    ).get(conversationId) as { n: number };
    return row.n;
  }

  // ── Task run telemetry ──

  recordTaskRun(taskId: string, status: 'ok' | 'error', errorMsg?: string): void {
    this.db.prepare(`
      INSERT INTO task_runs (task_id, last_run_at, last_status, last_error, run_count)
      VALUES (?, unixepoch(), ?, ?, 1)
      ON CONFLICT(task_id) DO UPDATE SET
        last_run_at = unixepoch(),
        last_status = excluded.last_status,
        last_error = excluded.last_error,
        run_count = run_count + 1
    `).run(taskId, status, errorMsg ?? null);
  }

  getTaskRun(taskId: string): { lastRunAt: number | null; lastStatus: string | null; lastError: string | null; runCount: number } | null {
    const row = this.db.prepare(
      'SELECT last_run_at, last_status, last_error, run_count FROM task_runs WHERE task_id = ?',
    ).get(taskId) as { last_run_at: number | null; last_status: string | null; last_error: string | null; run_count: number } | undefined;
    if (!row) return null;
    return {
      lastRunAt: row.last_run_at ? row.last_run_at * 1000 : null,
      lastStatus: row.last_status,
      lastError: row.last_error,
      runCount: row.run_count ?? 0,
    };
  }

  // ── User-created tasks (reminders / watches) ──

  saveUserTask(task: UserTask): void {
    const spec = task.type === 'reminder'
      ? JSON.stringify({ schedule: task.schedule })
      : JSON.stringify({ watch: task.watch });
    this.db.prepare(`
      INSERT INTO user_tasks (id, owner_conversation_id, description, type, spec, message, enabled, created_at, updated_at, last_triggered_at, trigger_count, last_seen_value)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, unixepoch(), ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        owner_conversation_id = excluded.owner_conversation_id,
        description = excluded.description,
        type = excluded.type,
        spec = excluded.spec,
        message = excluded.message,
        enabled = excluded.enabled,
        updated_at = unixepoch(),
        last_triggered_at = excluded.last_triggered_at,
        trigger_count = excluded.trigger_count,
        last_seen_value = excluded.last_seen_value
    `).run(
      task.id,
      task.ownerConversationId,
      task.description,
      task.type,
      spec,
      task.message,
      task.enabled ? 1 : 0,
      Math.floor(task.createdAt / 1000),
      task.lastTriggeredAt ? Math.floor(task.lastTriggeredAt / 1000) : null,
      task.triggerCount,
      task.lastSeenValue,
    );
  }

  getUserTask(id: string): UserTask | null {
    const row = this.db.prepare('SELECT * FROM user_tasks WHERE id = ?').get(id) as any;
    return row ? rowToUserTask(row) : null;
  }

  listUserTasks(ownerConversationId?: string): UserTask[] {
    const rows = ownerConversationId
      ? this.db.prepare('SELECT * FROM user_tasks WHERE owner_conversation_id = ? ORDER BY created_at DESC').all(ownerConversationId)
      : this.db.prepare('SELECT * FROM user_tasks ORDER BY created_at DESC').all();
    return (rows as any[]).map(rowToUserTask);
  }

  deleteUserTask(id: string): boolean {
    const result = this.db.prepare('DELETE FROM user_tasks WHERE id = ?').run(id);
    return result.changes > 0;
  }

  setUserTaskEnabled(id: string, enabled: boolean): boolean {
    const result = this.db.prepare(
      'UPDATE user_tasks SET enabled = ?, updated_at = unixepoch() WHERE id = ?',
    ).run(enabled ? 1 : 0, id);
    return result.changes > 0;
  }

  recordUserTaskTrigger(id: string, seenValue: string | null): void {
    this.db.prepare(`
      UPDATE user_tasks
      SET last_triggered_at = unixepoch(),
          trigger_count = trigger_count + 1,
          last_seen_value = ?,
          updated_at = unixepoch()
      WHERE id = ?
    `).run(seenValue, id);
  }

  /** Append a watch observation; auto-prunes per task to ~MAX_KEEP rows. */
  recordObservation(taskId: string, value: string | null, matched: boolean, maxKeep = 200): void {
    this.db.prepare(
      'INSERT INTO watch_observations (task_id, value, matched) VALUES (?, ?, ?)',
    ).run(taskId, value, matched ? 1 : 0);
    // Cheap prune: only when we cross a threshold, drop everything beyond N rows.
    const count = (this.db.prepare(
      'SELECT COUNT(*) as n FROM watch_observations WHERE task_id = ?',
    ).get(taskId) as { n: number }).n;
    if (count > maxKeep + 50) {
      this.db.prepare(`
        DELETE FROM watch_observations
        WHERE task_id = ? AND id NOT IN (
          SELECT id FROM watch_observations WHERE task_id = ? ORDER BY id DESC LIMIT ?
        )
      `).run(taskId, taskId, maxKeep);
    }
  }

  listObservations(taskId: string, limit = 20): Array<{ value: string | null; matched: boolean; observedAt: number }> {
    const rows = this.db.prepare(
      'SELECT value, matched, observed_at FROM watch_observations WHERE task_id = ? ORDER BY id DESC LIMIT ?',
    ).all(taskId, limit) as Array<{ value: string | null; matched: number; observed_at: number }>;
    return rows.map((r) => ({ value: r.value, matched: r.matched === 1, observedAt: r.observed_at * 1000 }));
  }

  deleteObservations(taskId: string): void {
    this.db.prepare('DELETE FROM watch_observations WHERE task_id = ?').run(taskId);
  }

  /** Replace the persisted spec/message/description for an existing task. */
  updateUserTask(id: string, fields: { description?: string; message?: string; spec?: { schedule?: import('../tasks/types.js').ReminderSchedule; watch?: import('../tasks/types.js').WatchSpec } }): boolean {
    const sets: string[] = ['updated_at = unixepoch()'];
    const args: any[] = [];
    if (fields.description !== undefined) { sets.push('description = ?'); args.push(fields.description); }
    if (fields.message !== undefined) { sets.push('message = ?'); args.push(fields.message); }
    if (fields.spec !== undefined) { sets.push('spec = ?'); args.push(JSON.stringify(fields.spec)); }
    args.push(id);
    const result = this.db.prepare(`UPDATE user_tasks SET ${sets.join(', ')} WHERE id = ?`).run(...args);
    return result.changes > 0;
  }
}

function rowToUserTask(row: any): UserTask {
  const spec = JSON.parse(row.spec) as { schedule?: ReminderSchedule; watch?: WatchSpec };
  return {
    id: row.id,
    ownerConversationId: row.owner_conversation_id,
    description: row.description,
    type: row.type as TaskType,
    schedule: spec.schedule,
    watch: spec.watch,
    message: row.message,
    enabled: row.enabled === 1,
    createdAt: row.created_at * 1000,
    updatedAt: row.updated_at * 1000,
    lastTriggeredAt: row.last_triggered_at ? row.last_triggered_at * 1000 : null,
    triggerCount: row.trigger_count ?? 0,
    lastSeenValue: row.last_seen_value,
  };
}
