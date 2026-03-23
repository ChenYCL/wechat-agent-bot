/**
 * WebUI E2E Test
 *
 * Tests that the built WebUI is served correctly via Express
 * and that the frontend can interact with all API endpoints.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../../src/server/index.js';
import { ConfigStore } from '../../src/config/store.js';
import { ProviderRegistry } from '../../src/providers/registry.js';
import { SchedulerManager } from '../../src/scheduler/manager.js';
import { McpClient } from '../../src/mcp/client.js';
import { SkillRegistry } from '../../src/skills/registry.js';
import { createHelpSkill } from '../../src/skills/builtin/help.js';
import { createModelSkill } from '../../src/skills/builtin/model.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Server } from 'node:http';
import type { ChatRequest, ChatResponse } from '../../src/core/types.js';

let server: Server;
let baseUrl: string;
let tmpDir: string;

async function get(path: string) {
  const res = await fetch(`${baseUrl}${path}`);
  return { status: res.status, headers: res.headers, text: await res.text() };
}

async function api(path: string, options?: RequestInit) {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  return { status: res.status, body: await res.json() };
}

describe('WebUI E2E', () => {
  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'wechat-webui-e2e-'));
    const config = new ConfigStore(tmpDir);
    await config.load();

    const providers = new ProviderRegistry();
    providers.registerFactory('mock', (cfg) => ({
      id: cfg.id, name: cfg.name, config: cfg,
      async chat(_req: ChatRequest): Promise<ChatResponse> { return { text: 'ok' }; },
      async clearSession() {},
    }));

    const scheduler = new SchedulerManager();
    const mcp = new McpClient();
    const skills = new SkillRegistry();
    skills.register(createHelpSkill(() => skills.getAll()));
    skills.register(createModelSkill(providers));

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

  // ── Static file serving ──
  it('should serve WebUI index.html at /', async () => {
    const { status, text } = await get('/');
    expect(status).toBe(200);
    expect(text).toContain('<!DOCTYPE html>');
    expect(text).toContain('WeChat Agent');
  });

  it('should serve CSS assets', async () => {
    const { text: html } = await get('/');
    const cssMatch = html.match(/href="(\/assets\/[^"]+\.css)"/);
    if (cssMatch) {
      const { status, headers } = await get(cssMatch[1]);
      expect(status).toBe(200);
      expect(headers.get('content-type')).toContain('css');
    }
  });

  it('should serve JS assets', async () => {
    const { text: html } = await get('/');
    const jsMatch = html.match(/src="(\/assets\/[^"]+\.js)"/);
    if (jsMatch) {
      const { status, headers } = await get(jsMatch[1]);
      expect(status).toBe(200);
      expect(headers.get('content-type')).toContain('javascript');
    }
  });

  it('should return index.html for SPA routes (client-side routing)', async () => {
    const { status, text } = await get('/models');
    expect(status).toBe(200);
    expect(text).toContain('<!DOCTYPE html>');
  });

  // ── API coexists with static files ──
  it('API /api/status should work alongside static serving', async () => {
    const { status, body } = await api('/api/status');
    expect(status).toBe(200);
    expect(body.status).toBe('running');
  });

  it('API /api/models should work alongside static serving', async () => {
    const { status, body } = await api('/api/models');
    expect(status).toBe(200);
    expect(body.availableProviders).toContain('mock');
  });

  // ── Full CRUD flow simulating WebUI operations ──
  it('should support full model CRUD flow via API', async () => {
    // Add
    const { body: addRes } = await api('/api/models', {
      method: 'POST',
      body: JSON.stringify({
        name: 'WebUI Test Model',
        provider: 'mock',
        model: 'test-webui',
        apiKey: 'fake-key',
      }),
    });
    expect(addRes.ok).toBe(true);
    const modelId = addRes.id;

    // Activate
    const { status: activateStatus } = await api(`/api/models/${modelId}/activate`, { method: 'POST' });
    expect(activateStatus).toBe(200);

    // Verify active
    const { body: listRes } = await api('/api/models');
    expect(listRes.activeId).toBe(modelId);

    // Delete
    const { status: deleteStatus } = await api(`/api/models/${modelId}`, { method: 'DELETE' });
    expect(deleteStatus).toBe(200);
  });

  it('should support full task CRUD flow via API', async () => {
    // Add
    const { body: addRes } = await api('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({
        name: 'WebUI Test Task',
        type: 'report',
        cron: '0 9 * * *',
        enabled: false,
        config: { topic: 'test' },
      }),
    });
    expect(addRes.ok).toBe(true);

    // List
    const { body: listRes } = await api('/api/tasks');
    const task = listRes.tasks.find((t: any) => t.name === 'WebUI Test Task');
    expect(task).toBeDefined();

    // Delete
    const { status } = await api(`/api/tasks/${task.id}`, { method: 'DELETE' });
    expect(status).toBe(200);
  });
});
