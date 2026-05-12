/**
 * Per-user WeChat account registry.
 *
 * Each row links a SDK-level `accountId` (the value returned by
 * `weixin-agent-sdk` after a successful QR login) to the app user who
 * owns it. Status lifecycle:
 *
 *   pending  → row exists, awaiting QR scan completion
 *   active   → linked & expected to be running in the bot loop
 *   logged_out → user disconnected or the SDK token expired
 *
 * The SDK keeps the actual token on disk under ~/.weixin-agent-sdk/,
 * so this table is only an index — deleting a row here doesn't revoke
 * the SDK's token (we leave that file alone for forensic reasons).
 */
import type { HistoryStore } from '../utils/history-store.js';

export type AccountStatus = 'pending' | 'active' | 'logged_out';

export interface WeChatAccount {
  accountId: string;
  userId: string;
  alias: string | null;
  status: AccountStatus;
  createdAt: number;
  lastSeenAt: number | null;
}

export class WeChatAccountStore {
  private store: HistoryStore;

  constructor(store: HistoryStore) {
    this.store = store;
  }

  /** Insert a new pending row before kicking off the QR flow. */
  registerPending(accountId: string, userId: string, alias?: string): WeChatAccount {
    this.store.rawDb.prepare(`
      INSERT INTO wechat_accounts (account_id, user_id, alias, status)
      VALUES (?, ?, ?, 'pending')
      ON CONFLICT(account_id) DO UPDATE SET
        user_id = excluded.user_id,
        alias = excluded.alias,
        status = 'pending'
    `).run(accountId, userId, alias ?? null);
    return this.get(accountId)!;
  }

  markActive(accountId: string): void {
    this.store.rawDb.prepare(
      "UPDATE wechat_accounts SET status = 'active', last_seen_at = unixepoch() WHERE account_id = ?",
    ).run(accountId);
  }

  markLoggedOut(accountId: string): void {
    this.store.rawDb.prepare(
      "UPDATE wechat_accounts SET status = 'logged_out' WHERE account_id = ?",
    ).run(accountId);
  }

  touch(accountId: string): void {
    this.store.rawDb.prepare(
      'UPDATE wechat_accounts SET last_seen_at = unixepoch() WHERE account_id = ?',
    ).run(accountId);
  }

  setAlias(accountId: string, alias: string | null, ownerUserId?: string): boolean {
    const sql = ownerUserId
      ? 'UPDATE wechat_accounts SET alias = ? WHERE account_id = ? AND user_id = ?'
      : 'UPDATE wechat_accounts SET alias = ? WHERE account_id = ?';
    const args: any[] = ownerUserId ? [alias, accountId, ownerUserId] : [alias, accountId];
    return this.store.rawDb.prepare(sql).run(...args).changes > 0;
  }

  get(accountId: string): WeChatAccount | null {
    const row = this.store.rawDb.prepare(
      'SELECT * FROM wechat_accounts WHERE account_id = ?',
    ).get(accountId) as any;
    return row ? rowToAccount(row) : null;
  }

  listForUser(userId: string): WeChatAccount[] {
    const rows = this.store.rawDb.prepare(
      'SELECT * FROM wechat_accounts WHERE user_id = ? ORDER BY created_at ASC',
    ).all(userId) as any[];
    return rows.map(rowToAccount);
  }

  /** All accounts that should be running. Used at boot. */
  listActive(): WeChatAccount[] {
    const rows = this.store.rawDb.prepare(
      "SELECT * FROM wechat_accounts WHERE status = 'active' ORDER BY created_at ASC",
    ).all() as any[];
    return rows.map(rowToAccount);
  }

  /** All non-logged-out accounts (pending + active). For boot recovery. */
  listResumeCandidates(): WeChatAccount[] {
    const rows = this.store.rawDb.prepare(
      "SELECT * FROM wechat_accounts WHERE status != 'logged_out' ORDER BY created_at ASC",
    ).all() as any[];
    return rows.map(rowToAccount);
  }

  delete(accountId: string, ownerUserId?: string): boolean {
    const sql = ownerUserId
      ? 'DELETE FROM wechat_accounts WHERE account_id = ? AND user_id = ?'
      : 'DELETE FROM wechat_accounts WHERE account_id = ?';
    const args: any[] = ownerUserId ? [accountId, ownerUserId] : [accountId];
    return this.store.rawDb.prepare(sql).run(...args).changes > 0;
  }

  /** Look up the user who owns a given accountId — used by the router. */
  ownerOf(accountId: string): string | null {
    const row = this.store.rawDb.prepare(
      'SELECT user_id FROM wechat_accounts WHERE account_id = ?',
    ).get(accountId) as any;
    return row?.user_id ?? null;
  }
}

function rowToAccount(row: any): WeChatAccount {
  return {
    accountId: row.account_id,
    userId: row.user_id,
    alias: row.alias,
    status: row.status as AccountStatus,
    createdAt: row.created_at * 1000,
    lastSeenAt: row.last_seen_at ? row.last_seen_at * 1000 : null,
  };
}
