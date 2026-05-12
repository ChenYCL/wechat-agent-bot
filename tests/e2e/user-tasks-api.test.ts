/**
 * E2E test for /api/user-tasks — boots a real Express server and exercises
 * the CRUD + history endpoints.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../../src/server/index.js';
import { ConfigStore } from '../../src/config/store.js';
import { ProviderRegistry } from '../../src/providers/registry.js';
import { SchedulerManager } from '../../src/scheduler/manager.js';
import { McpClient } from '../../src/mcp/client.js';
import { SkillRegistry } from '../../src/skills/registry.js';
import { HistoryStore } from '../../src/utils/history-store.js';
import { UserTaskManager } from '../../src/tasks/manager.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Server } from 'node:http';

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

describe('E2E /api/user-tasks', () => {
  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'usertask-api-e2e-'));
    const config = new ConfigStore(tmpDir);
    await config.load();

    const historyStore = new HistoryStore(tmpDir);
    await historyStore.init();
    const providers = new ProviderRegistry();
    const scheduler = new SchedulerManager({ store: historyStore });
    const mcp = new McpClient();
    const skills = new SkillRegistry();
    const userTasks = new UserTaskManager({ store: historyStore, scheduler });

    const app = createServer({ config, providers, scheduler, mcp, skills, userTasks });
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

  let createdId: string;

  it('POST /api/user-tasks creates a reminder', async () => {
    const { status, body } = await api('/api/user-tasks', {
      method: 'POST',
      body: JSON.stringify({
        ownerConversationId: 'webui-test',
        type: 'reminder',
        description: 'morning ping',
        message: 'wake up',
        schedule: { kind: 'cron', cron: '0 8 * * *' },
      }),
    });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.task.id).toBeDefined();
    createdId = body.task.id;
  });

  it('GET /api/user-tasks?conversationId=... lists tasks', async () => {
    const { body } = await api('/api/user-tasks?conversationId=webui-test');
    expect(body.tasks.length).toBeGreaterThanOrEqual(1);
  });

  it('GET /api/user-tasks/:id returns detail', async () => {
    const { body, status } = await api(`/api/user-tasks/${createdId}`);
    expect(status).toBe(200);
    expect(body.task.description).toBe('morning ping');
  });

  it('PUT /api/user-tasks/:id edits message', async () => {
    const { status, body } = await api(`/api/user-tasks/${createdId}`, {
      method: 'PUT',
      body: JSON.stringify({ message: 'updated text' }),
    });
    expect(status).toBe(200);
    expect(body.task.message).toBe('updated text');
  });

  it('POST /api/user-tasks/:id/pause and /resume', async () => {
    const paused = await api(`/api/user-tasks/${createdId}/pause`, { method: 'POST' });
    expect(paused.body.task.enabled).toBe(false);
    const resumed = await api(`/api/user-tasks/${createdId}/resume`, { method: 'POST' });
    expect(resumed.body.task.enabled).toBe(true);
  });

  it('GET /api/user-tasks/:id/history returns observations (empty for new reminder)', async () => {
    const { status, body } = await api(`/api/user-tasks/${createdId}/history`);
    expect(status).toBe(200);
    expect(Array.isArray(body.observations)).toBe(true);
  });

  it('DELETE /api/user-tasks/:id removes the task', async () => {
    const { status, body } = await api(`/api/user-tasks/${createdId}`, { method: 'DELETE' });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    const after = await api(`/api/user-tasks/${createdId}`);
    expect(after.status).toBe(404);
  });

  it('POST /api/user-tasks rejects invalid cron', async () => {
    const { status, body } = await api('/api/user-tasks', {
      method: 'POST',
      body: JSON.stringify({
        ownerConversationId: 'webui-test',
        type: 'reminder',
        description: 'x',
        message: 'y',
        schedule: { kind: 'cron', cron: 'not a cron' },
      }),
    });
    expect(status).toBe(400);
    expect(body.error).toContain('cron');
  });
});
