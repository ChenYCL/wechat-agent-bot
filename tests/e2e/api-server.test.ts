/**
 * E2E API Server Test
 *
 * Tests the HTTP API endpoints end-to-end:
 *   HTTP request → Express routes → config/providers → JSON response
 *
 * Spins up a real Express server on a random port.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../../src/server/index.js';
import { ConfigStore } from '../../src/config/store.js';
import { ProviderRegistry } from '../../src/providers/registry.js';
import { SchedulerManager } from '../../src/scheduler/manager.js';
import { McpClient } from '../../src/mcp/client.js';
import { SkillRegistry } from '../../src/skills/registry.js';
import { createHelpSkill } from '../../src/skills/builtin/help.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Server } from 'node:http';
import type { ChatRequest, ChatResponse } from '../../src/core/types.js';

let server: Server;
let baseUrl: string;
let tmpDir: string;

async function api(path: string, options?: RequestInit) {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  return { status: res.status, body: await res.json() };
}

describe('E2E API Server', () => {
  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'wechat-bot-e2e-'));
    const config = new ConfigStore(tmpDir);
    await config.load();

    const providers = new ProviderRegistry();
    providers.registerFactory('mock', (cfg) => ({
      id: cfg.id, name: cfg.name, config: cfg,
      async chat(req: ChatRequest): Promise<ChatResponse> { return { text: 'ok' }; },
      async clearSession() {},
    }));

    const scheduler = new SchedulerManager();
    const mcp = new McpClient();
    const skills = new SkillRegistry();
    skills.register(createHelpSkill(() => skills.getAll()));

    const app = createServer({ config, providers, scheduler, mcp, skills });

    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          baseUrl = `http://127.0.0.1:${addr.port}`;
        }
        resolve();
      });
    });
  });

  afterAll(async () => {
    server?.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  // ── Status ──
  it('GET /api/status should return system status', async () => {
    const { status, body } = await api('/api/status');
    expect(status).toBe(200);
    expect(body.status).toBe('running');
    expect(body.skills).toBeInstanceOf(Array);
    expect(body.scheduledTasks).toBeDefined();
  });

  // ── Models CRUD ──
  it('GET /api/models should return empty list initially', async () => {
    const { body } = await api('/api/models');
    expect(body.availableProviders).toContain('mock');
  });

  it('POST /api/models should add a model', async () => {
    const { status, body } = await api('/api/models', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Test Model',
        provider: 'mock',
        model: 'test-v1',
        apiKey: 'sk-fake-key',
      }),
    });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.id).toBeDefined();
  });

  it('GET /api/models should list the added model', async () => {
    const { body } = await api('/api/models');
    expect(body.models.length).toBeGreaterThanOrEqual(1);
    const m = body.models.find((x: any) => x.name === 'Test Model');
    expect(m).toBeDefined();
    expect(m.apiKey).toMatch(/^\*\*\*/); // masked, only last 4 chars shown
  });

  it('POST /api/models/:id/activate should set active', async () => {
    const { body: list } = await api('/api/models');
    const m = list.models.find((x: any) => x.name === 'Test Model');
    const { status } = await api(`/api/models/${m.id}/activate`, { method: 'POST' });
    expect(status).toBe(200);
  });

  it('DELETE /api/models/:id should remove model', async () => {
    const { body: list } = await api('/api/models');
    const m = list.models.find((x: any) => x.name === 'Test Model');
    const { status } = await api(`/api/models/${m.id}`, { method: 'DELETE' });
    expect(status).toBe(200);
  });

  // ── Tasks CRUD ──
  it('POST /api/tasks should create a task', async () => {
    const { status, body } = await api('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Test Report',
        type: 'report',
        cron: '0 9 * * *',
        enabled: false,
        config: { topic: 'AI' },
      }),
    });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
  });

  it('GET /api/tasks should list tasks', async () => {
    const { body } = await api('/api/tasks');
    expect(body.tasks.length).toBeGreaterThanOrEqual(1);
  });

  it('DELETE /api/tasks/:id should remove task', async () => {
    const { body: list } = await api('/api/tasks');
    const t = list.tasks[0];
    const { status } = await api(`/api/tasks/${t.id}`, { method: 'DELETE' });
    expect(status).toBe(200);
  });

  // ── MCP ──
  it('GET /api/mcp should return servers and tools', async () => {
    const { status, body } = await api('/api/mcp');
    expect(status).toBe(200);
    expect(body.servers).toBeInstanceOf(Array);
    expect(body.tools).toBeInstanceOf(Array);
  });

  // ── Config ──
  it('GET /api/config should return masked config', async () => {
    const { status, body } = await api('/api/config');
    expect(status).toBe(200);
    expect(body.server).toBeDefined();
    expect(body.models).toBeInstanceOf(Array);
  });

  it('POST /api/config/save should persist config', async () => {
    const { status, body } = await api('/api/config/save', { method: 'POST' });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
  });
});
