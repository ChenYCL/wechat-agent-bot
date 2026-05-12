/**
 * AuthStore tests — signup/login/sessions/password.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { HistoryStore } from '../../src/utils/history-store.js';
import { AuthStore } from '../../src/auth/store.js';

describe('AuthStore', () => {
  let tmp: string;
  let store: HistoryStore;
  let auth: AuthStore;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'auth-test-'));
    store = new HistoryStore(tmp);
    await store.init();
    auth = new AuthStore(store);
  });

  afterEach(async () => {
    await store.close();
    await rm(tmp, { recursive: true, force: true });
  });

  it('signup creates a user with hashed password', () => {
    const user = auth.signup('alice', 'pass-1234');
    expect(user).not.toBeNull();
    expect(user!.username).toBe('alice');
    expect(user!.isAdmin).toBe(false);
    // Internal row should have a non-trivial hash & salt
    const raw = auth.findByUsername('alice')!;
    expect(raw.password_hash.length).toBeGreaterThan(40);
    expect(raw.password_salt.length).toBeGreaterThan(20);
  });

  it('rejects duplicate username (case-insensitive)', () => {
    auth.signup('Alice', 'pass-1234');
    expect(auth.signup('alice', 'pass-1234')).toBeNull();
    expect(auth.signup('ALICE', 'pass-1234')).toBeNull();
  });

  it('rejects short passwords', () => {
    expect(() => auth.signup('bob', 'short')).toThrow(/at least 8/);
  });

  it('rejects bad usernames', () => {
    expect(() => auth.signup('a', 'pass-1234')).toThrow();
    expect(() => auth.signup('with space', 'pass-1234')).toThrow();
    expect(() => auth.signup("rm -rf /", 'pass-1234')).toThrow();
  });

  it('verifyPassword succeeds with the right password and fails otherwise', () => {
    auth.signup('alice', 'correct-horse-battery');
    expect(auth.verifyPassword('alice', 'correct-horse-battery')).not.toBeNull();
    expect(auth.verifyPassword('alice', 'wrong')).toBeNull();
    expect(auth.verifyPassword('mallory', 'whatever')).toBeNull();
  });

  it('verifyPassword is case-insensitive on username', () => {
    auth.signup('Alice', 'pass-1234');
    expect(auth.verifyPassword('alice', 'pass-1234')).not.toBeNull();
    expect(auth.verifyPassword('ALICE', 'pass-1234')).not.toBeNull();
  });

  it('createSession + resolveSession round-trips', () => {
    const user = auth.signup('alice', 'pass-1234')!;
    const session = auth.createSession(user.id);
    expect(session.token.length).toBeGreaterThan(40);
    const resolved = auth.resolveSession(session.token);
    expect(resolved?.id).toBe(user.id);
  });

  it('expired sessions are pruned on lookup', () => {
    const user = auth.signup('alice', 'pass-1234')!;
    // Past TTL — expires_at strictly less than now once we floor to seconds
    const session = auth.createSession(user.id, -10_000);
    expect(auth.resolveSession(session.token)).toBeNull();
  });

  it('deleteSessionsForUser invalidates all of that user\'s sessions', () => {
    const user = auth.signup('alice', 'pass-1234')!;
    const s1 = auth.createSession(user.id);
    const s2 = auth.createSession(user.id);
    expect(auth.deleteSessionsForUser(user.id)).toBe(2);
    expect(auth.resolveSession(s1.token)).toBeNull();
    expect(auth.resolveSession(s2.token)).toBeNull();
  });

  it('changePassword requires the old password', () => {
    const user = auth.signup('alice', 'old-pass-1234')!;
    expect(auth.changePassword(user.id, 'wrong', 'new-pass-1234')).toBe(false);
    expect(auth.changePassword(user.id, 'old-pass-1234', 'new-pass-1234')).toBe(true);
    expect(auth.verifyPassword('alice', 'old-pass-1234')).toBeNull();
    expect(auth.verifyPassword('alice', 'new-pass-1234')).not.toBeNull();
  });

  it('countUsers + listUsers + isAdmin work', () => {
    expect(auth.countUsers()).toBe(0);
    const admin = auth.signup('admin', 'pass-1234', { isAdmin: true })!;
    const alice = auth.signup('alice', 'pass-1234')!;
    expect(auth.countUsers()).toBe(2);
    const all = auth.listUsers();
    expect(all.map((u) => u.username).sort()).toEqual(['admin', 'alice']);
    expect(all.find((u) => u.id === admin.id)?.isAdmin).toBe(true);
    expect(all.find((u) => u.id === alice.id)?.isAdmin).toBe(false);
  });
});
