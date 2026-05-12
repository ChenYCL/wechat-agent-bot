/**
 * E2E tests for /api/auth and /api/me/models — verifies session cookies
 * scope endpoints to the logged-in user.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../../src/server/index.js';
import { ConfigStore } from '../../src/config/store.js';
import { ProviderRegistry } from '../../src/providers/registry.js';
import { SchedulerManager } from '../../src/scheduler/manager.js';
import { McpClient } from '../../src/mcp/client.js';
import { SkillRegistry } from '../../src/skills/registry.js';
import { HistoryStore } from '../../src/utils/history-store.js';
import { AuthStore } from '../../src/auth/store.js';
import { WeChatAccountStore } from '../../src/accounts/store.js';
import { UserProviderManager } from '../../src/accounts/provider-manager.js';
import { UserTaskManager } from '../../src/tasks/manager.js';
import { MultiAccountBot } from '../../src/accounts/multi-bot.js';
import { MessageRouter } from '../../src/core/router.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Server } from 'node:http';

let server: Server;
let baseUrl: string;
let tmpDir: string;

async function api(path: string, options?: RequestInit) {
  const merged: RequestInit = {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options?.headers ?? {}) },
  };
  const res = await fetch(`${baseUrl}${path}`, merged);
  const setCookie = res.headers.get('set-cookie') ?? null;
  return { status: res.status, body: await res.json().catch(() => null), setCookie };
}

function cookieValue(setCookie: string | null, name: string): string | null {
  if (!setCookie) return null;
  const m = setCookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? m[1] : null;
}

describe('E2E /api/auth + /api/me/models', () => {
  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'auth-api-e2e-'));
    const config = new ConfigStore(tmpDir);
    await config.load();
    const historyStore = new HistoryStore(tmpDir);
    await historyStore.init();

    const auth = new AuthStore(historyStore);
    const accountsStore = new WeChatAccountStore(historyStore);
    const userProviders = new UserProviderManager(historyStore);
    const providers = new ProviderRegistry();
    const scheduler = new SchedulerManager({ store: historyStore });
    const mcp = new McpClient();
    const skills = new SkillRegistry();
    const userTasks = new UserTaskManager({ store: historyStore, scheduler });
    const router = new MessageRouter(providers, skills);
    const multiBot = new MultiAccountBot(router, accountsStore);

    const app = createServer({
      config, providers, scheduler, mcp, skills, userTasks,
      auth, wechatAccounts: accountsStore, multiBot, userProviders,
    });

    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    server?.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  let aliceSid: string;
  let bobSid: string;

  it('POST /api/auth/signup creates a user + sets a session cookie', async () => {
    const r = await api('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ username: 'alice', password: 'pass-1234' }),
    });
    expect(r.status).toBe(200);
    expect(r.body.user.username).toBe('alice');
    const sid = cookieValue(r.setCookie, 'sid');
    expect(sid).toBeTruthy();
    aliceSid = sid!;
  });

  it('POST /api/auth/signup rejects duplicate username', async () => {
    const r = await api('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ username: 'alice', password: 'pass-1234' }),
    });
    expect(r.status).toBe(409);
  });

  it('POST /api/auth/login returns a session cookie', async () => {
    await api('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ username: 'bob', password: 'pass-1234' }),
    });
    const r = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'bob', password: 'pass-1234' }),
    });
    expect(r.status).toBe(200);
    const sid = cookieValue(r.setCookie, 'sid');
    expect(sid).toBeTruthy();
    bobSid = sid!;
  });

  it('GET /api/auth/me requires auth', async () => {
    const noAuth = await api('/api/auth/me');
    expect(noAuth.status).toBe(401);
    const withAuth = await api('/api/auth/me', { headers: { cookie: `sid=${aliceSid}` } });
    expect(withAuth.status).toBe(200);
    expect(withAuth.body.user.username).toBe('alice');
  });

  it('/api/me/models is per-user', async () => {
    // Alice adds her model
    const ra = await api('/api/me/models', {
      method: 'POST',
      headers: { cookie: `sid=${aliceSid}` },
      body: JSON.stringify({
        name: 'Alice GPT', provider: 'openai', model: 'gpt-4o',
        apiKey: 'sk-alice-12345', baseUrl: 'https://x.example/v1',
      }),
    });
    expect(ra.status).toBe(200);

    // Bob adds his
    const rb = await api('/api/me/models', {
      method: 'POST',
      headers: { cookie: `sid=${bobSid}` },
      body: JSON.stringify({
        name: 'Bob Claude', provider: 'anthropic', model: 'claude-sonnet-4',
        apiKey: 'sk-bob-67890',
      }),
    });
    expect(rb.status).toBe(200);

    // Alice's list contains only Alice's model
    const aliceList = await api('/api/me/models', { headers: { cookie: `sid=${aliceSid}` } });
    expect(aliceList.body.models).toHaveLength(1);
    expect(aliceList.body.models[0].name).toBe('Alice GPT');
    expect(aliceList.body.models[0].apiKey).toMatch(/^\*\*\*/); // masked

    // Bob's list contains only Bob's model
    const bobList = await api('/api/me/models', { headers: { cookie: `sid=${bobSid}` } });
    expect(bobList.body.models).toHaveLength(1);
    expect(bobList.body.models[0].name).toBe('Bob Claude');
  });

  it('logout clears the session', async () => {
    const r = await api('/api/auth/logout', {
      method: 'POST',
      headers: { cookie: `sid=${aliceSid}` },
    });
    expect(r.status).toBe(200);
    const me = await api('/api/auth/me', { headers: { cookie: `sid=${aliceSid}` } });
    expect(me.status).toBe(401);
  });

  it('/api/wechat-accounts list requires auth and returns my accounts', async () => {
    const noAuth = await api('/api/wechat-accounts');
    expect(noAuth.status).toBe(401);
    const withAuth = await api('/api/wechat-accounts', { headers: { cookie: `sid=${bobSid}` } });
    expect(withAuth.status).toBe(200);
    expect(withAuth.body.accounts).toEqual([]);
  });
});
