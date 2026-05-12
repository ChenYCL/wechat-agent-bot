/**
 * WeChatAccountStore + ContextResolver tests.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { HistoryStore } from '../../src/utils/history-store.js';
import { AuthStore } from '../../src/auth/store.js';
import { WeChatAccountStore } from '../../src/accounts/store.js';
import { ContextResolver, encodeScopedId, decodeScopedId, isSyntheticId } from '../../src/accounts/context.js';

describe('WeChatAccountStore', () => {
  let tmp: string;
  let store: HistoryStore;
  let auth: AuthStore;
  let accounts: WeChatAccountStore;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'acct-test-'));
    store = new HistoryStore(tmp);
    await store.init();
    auth = new AuthStore(store);
    accounts = new WeChatAccountStore(store);
  });

  afterEach(async () => {
    await store.close();
    await rm(tmp, { recursive: true, force: true });
  });

  it('register → activate → touch lifecycle', () => {
    const user = auth.signup('alice', 'pass-1234')!;
    const a = accounts.registerPending('wxid-1', user.id, 'main');
    expect(a.status).toBe('pending');
    expect(a.alias).toBe('main');
    accounts.markActive('wxid-1');
    expect(accounts.get('wxid-1')!.status).toBe('active');
    accounts.touch('wxid-1');
    expect(accounts.get('wxid-1')!.lastSeenAt).not.toBeNull();
  });

  it('lists only the caller\'s accounts', () => {
    const a = auth.signup('alice', 'pass-1234')!;
    const b = auth.signup('bob', 'pass-1234')!;
    accounts.registerPending('wxid-1', a.id);
    accounts.registerPending('wxid-2', b.id);
    expect(accounts.listForUser(a.id).map((x) => x.accountId)).toEqual(['wxid-1']);
    expect(accounts.listForUser(b.id).map((x) => x.accountId)).toEqual(['wxid-2']);
  });

  it('delete respects ownership', () => {
    const a = auth.signup('alice', 'pass-1234')!;
    const b = auth.signup('bob', 'pass-1234')!;
    accounts.registerPending('wxid-1', a.id);
    expect(accounts.delete('wxid-1', b.id)).toBe(false);
    expect(accounts.get('wxid-1')).not.toBeNull();
    expect(accounts.delete('wxid-1', a.id)).toBe(true);
    expect(accounts.get('wxid-1')).toBeNull();
  });

  it('ownerOf returns user_id or null', () => {
    const u = auth.signup('alice', 'pass-1234')!;
    accounts.registerPending('wxid-1', u.id);
    expect(accounts.ownerOf('wxid-1')).toBe(u.id);
    expect(accounts.ownerOf('unknown')).toBeNull();
  });

  it('listResumeCandidates excludes logged-out accounts', () => {
    const u = auth.signup('alice', 'pass-1234')!;
    accounts.registerPending('a1', u.id);
    accounts.registerPending('a2', u.id);
    accounts.markActive('a1');
    accounts.markLoggedOut('a2');
    expect(accounts.listResumeCandidates().map((a) => a.accountId)).toEqual(['a1']);
  });
});

describe('ContextResolver / scoped ids', () => {
  it('encodes and decodes scoped ids round-trip', () => {
    const id = encodeScopedId('wxid-acct', 'wxid-peer');
    expect(id).toBe('wxid-acct::wxid-peer');
    const dec = decodeScopedId(id);
    expect(dec).toEqual({ accountId: 'wxid-acct', raw: 'wxid-peer' });
  });

  it('treats __synthetic ids correctly', () => {
    expect(isSyntheticId('__task-parser__xyz')).toBe(true);
    expect(isSyntheticId('wxid-acct::wxid-peer')).toBe(false);
    expect(decodeScopedId('__internal__abc')).toBeNull();
  });

  it('rejects malformed scoped ids', () => {
    expect(decodeScopedId('no-separator')).toBeNull();
    expect(decodeScopedId('::missing-account')).toBeNull();
    expect(decodeScopedId('')).toBeNull();
  });

  it('fromScopedId looks up the owning user', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'ctx-test-'));
    const store = new HistoryStore(tmp);
    await store.init();
    try {
      const auth = new AuthStore(store);
      const accounts = new WeChatAccountStore(store);
      const u = auth.signup('alice', 'pass-1234')!;
      accounts.registerPending('acct-1', u.id);
      const ctx = new ContextResolver(accounts);
      const resolved = ctx.fromScopedId(encodeScopedId('acct-1', 'peer-1'));
      expect(resolved?.userId).toBe(u.id);
      expect(resolved?.accountId).toBe('acct-1');
      expect(resolved?.raw).toBe('peer-1');
      expect(ctx.fromScopedId('unknown::x')).toBeNull();
      expect(ctx.fromScopedId('__synthetic__abc')).toBeNull();
    } finally {
      await store.close();
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
