/**
 * Multi-tenant user authentication, backed by SQLite via HistoryStore.
 *
 * - Passwords are hashed with scrypt(N=16384) + 16-byte salt, stored in hex.
 * - Sessions are opaque 32-byte tokens with a 30-day default lifetime.
 * - Usernames are case-insensitive at insert/lookup; the on-disk casing is preserved.
 *
 * Intentionally small: signup, login, logout, "me". No password reset, no
 * email, no 2FA. Designed to be wrapped by a higher-level auth API.
 */
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import type { HistoryStore } from '../utils/history-store.js';

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 32;
const SALT_BYTES = 16;
const SESSION_BYTES = 32;
const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface User {
  id: string;
  username: string;
  isAdmin: boolean;
  createdAt: number;
}

export interface Session {
  token: string;
  userId: string;
  createdAt: number;
  expiresAt: number;
}

export class AuthStore {
  private store: HistoryStore;

  constructor(store: HistoryStore) {
    this.store = store;
  }

  // ── Users ──

  /** Returns null if username already exists. Otherwise creates the user. */
  signup(username: string, password: string, opts: { isAdmin?: boolean } = {}): User | null {
    if (!username || !password) throw new Error('username and password are required');
    if (password.length < 8) throw new Error('password must be at least 8 characters');
    const normalized = username.trim();
    if (!/^[a-zA-Z0-9._-]{2,40}$/.test(normalized)) {
      throw new Error('username must be 2–40 chars, [a-zA-Z0-9._-] only');
    }
    if (this.findByUsername(normalized)) return null;

    const salt = randomBytes(SALT_BYTES).toString('hex');
    const hash = hashPassword(password, salt);
    const id = randomUUID();
    this.store.rawDb.prepare(`
      INSERT INTO users (id, username, password_hash, password_salt, is_admin)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, normalized, hash, salt, opts.isAdmin ? 1 : 0);
    return {
      id,
      username: normalized,
      isAdmin: !!opts.isAdmin,
      createdAt: Date.now(),
    };
  }

  findByUsername(username: string): { id: string; username: string; password_hash: string; password_salt: string; is_admin: number; created_at: number } | null {
    return this.store.rawDb.prepare(
      'SELECT * FROM users WHERE LOWER(username) = LOWER(?)',
    ).get(username.trim()) as any ?? null;
  }

  getUser(id: string): User | null {
    const row = this.store.rawDb.prepare(
      'SELECT id, username, is_admin, created_at FROM users WHERE id = ?',
    ).get(id) as any;
    if (!row) return null;
    return {
      id: row.id,
      username: row.username,
      isAdmin: row.is_admin === 1,
      createdAt: row.created_at * 1000,
    };
  }

  listUsers(): User[] {
    const rows = this.store.rawDb.prepare(
      'SELECT id, username, is_admin, created_at FROM users ORDER BY created_at ASC',
    ).all() as any[];
    return rows.map((r) => ({
      id: r.id, username: r.username, isAdmin: r.is_admin === 1, createdAt: r.created_at * 1000,
    }));
  }

  countUsers(): number {
    return (this.store.rawDb.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
  }

  // ── Authentication ──

  verifyPassword(username: string, password: string): User | null {
    const row = this.findByUsername(username);
    if (!row) return null;
    const expected = Buffer.from(row.password_hash, 'hex');
    const actual = scryptSync(password, row.password_salt, KEY_LEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
    if (expected.length !== actual.length) return null;
    if (!timingSafeEqual(expected, actual)) return null;
    return {
      id: row.id,
      username: row.username,
      isAdmin: row.is_admin === 1,
      createdAt: row.created_at * 1000,
    };
  }

  changePassword(userId: string, oldPassword: string, newPassword: string): boolean {
    if (newPassword.length < 8) throw new Error('password must be at least 8 characters');
    const user = this.getUser(userId);
    if (!user) return false;
    const verified = this.verifyPassword(user.username, oldPassword);
    if (!verified) return false;
    const salt = randomBytes(SALT_BYTES).toString('hex');
    const hash = hashPassword(newPassword, salt);
    this.store.rawDb.prepare(
      'UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?',
    ).run(hash, salt, userId);
    return true;
  }

  // ── Sessions ──

  /** Create a session bound to a user; returns the cookie token. */
  createSession(userId: string, ttlMs = DEFAULT_TTL_MS): Session {
    const token = randomBytes(SESSION_BYTES).toString('hex');
    const now = Date.now();
    const expires = now + ttlMs;
    this.store.rawDb.prepare(
      'INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)',
    ).run(token, userId, Math.floor(expires / 1000));
    return { token, userId, createdAt: now, expiresAt: expires };
  }

  /** Resolve a token to a user, or null if missing/expired. Auto-deletes expired sessions. */
  resolveSession(token: string): User | null {
    if (!token) return null;
    const row = this.store.rawDb.prepare(
      'SELECT s.token, s.user_id, s.created_at, s.expires_at FROM sessions s WHERE s.token = ?',
    ).get(token) as any;
    if (!row) return null;
    const nowSec = Math.floor(Date.now() / 1000);
    if (row.expires_at < nowSec) {
      this.store.rawDb.prepare('DELETE FROM sessions WHERE token = ?').run(token);
      return null;
    }
    return this.getUser(row.user_id);
  }

  deleteSession(token: string): boolean {
    const result = this.store.rawDb.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return result.changes > 0;
  }

  deleteSessionsForUser(userId: string): number {
    const result = this.store.rawDb.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
    return result.changes;
  }

  /** Periodic cleanup; safe to call on a schedule. */
  pruneExpiredSessions(): number {
    const nowSec = Math.floor(Date.now() / 1000);
    const result = this.store.rawDb.prepare('DELETE FROM sessions WHERE expires_at < ?').run(nowSec);
    return result.changes;
  }
}

function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, KEY_LEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P }).toString('hex');
}
