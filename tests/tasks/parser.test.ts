/**
 * Parser tests with a stub provider — we control the LLM reply and
 * verify that valid/invalid JSON, error responses, and code fences are
 * all handled.
 */
import { describe, it, expect } from 'vitest';
import { ProviderRegistry } from '../../src/providers/registry.js';
import { parseTaskFromText } from '../../src/tasks/parser.js';
import type { ChatRequest, ChatResponse } from '../../src/core/types.js';

function makeProviders(reply: string): ProviderRegistry {
  const r = new ProviderRegistry();
  r.registerFactory('stub', (cfg) => ({
    id: cfg.id, name: cfg.name, config: cfg,
    async chat(_req: ChatRequest): Promise<ChatResponse> { return { text: reply }; },
    async clearSession() {},
  }));
  r.addProvider({ id: 's', name: 's', provider: 'stub', model: 'm', apiKey: 'k' });
  return r;
}

describe('parseTaskFromText', () => {
  it('parses a valid one-shot reminder', async () => {
    const providers = makeProviders(JSON.stringify({
      type: 'reminder',
      description: '明天 8 点叫我起床',
      message: '该起床了',
      schedule: { kind: 'once', runAt: '2099-01-01T08:00:00+08:00' },
    }));

    const res = await parseTaskFromText('明天 8 点叫我起床', {
      providers,
      ownerConversationId: 'c1',
    });
    expect(res.ok).toBe(true);
    expect(res.draft?.type).toBe('reminder');
    expect(res.draft?.schedule?.kind).toBe('once');
    expect(typeof res.draft?.schedule?.runAt).toBe('number');
  });

  it('parses a cron reminder', async () => {
    const providers = makeProviders(JSON.stringify({
      type: 'reminder',
      description: '每天 8 点喝水',
      message: '喝水时间到',
      schedule: { kind: 'cron', cron: '0 8 * * *' },
    }));
    const res = await parseTaskFromText('每天 8 点提醒我喝水', { providers, ownerConversationId: 'c1' });
    expect(res.ok).toBe(true);
    expect(res.draft?.schedule?.cron).toBe('0 8 * * *');
  });

  it('parses a watch task and defaults pollCron when missing', async () => {
    const providers = makeProviders(JSON.stringify({
      type: 'watch',
      description: 'BTC < 50k 提醒',
      message: 'BTC 跌到 {value}',
      watch: {
        fetcher: { type: 'http', url: 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd', jsonPath: 'bitcoin.usd' },
        condition: { op: '<', value: 50000 },
        oneShot: true,
      },
    }));
    const res = await parseTaskFromText('BTC 跌破 5 万美元提醒我', { providers, ownerConversationId: 'c1' });
    expect(res.ok).toBe(true);
    expect(res.draft?.type).toBe('watch');
    expect(res.draft?.watch?.pollCron).toBe('*/5 * * * *');
  });

  it('handles fenced JSON output from chatty LLMs', async () => {
    const providers = makeProviders(
      'Sure! Here you go:\n```json\n' +
      JSON.stringify({
        type: 'reminder',
        description: 'x',
        message: 'y',
        schedule: { kind: 'cron', cron: '0 9 * * *' },
      }) +
      '\n```',
    );
    const res = await parseTaskFromText('每天 9 点 X', { providers, ownerConversationId: 'c1' });
    expect(res.ok).toBe(true);
  });

  it('propagates LLM-returned errors', async () => {
    const providers = makeProviders(JSON.stringify({ error: '我不知道该用什么数据源' }));
    const res = await parseTaskFromText('XYZ', { providers, ownerConversationId: 'c1' });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('数据源');
  });

  it('reports schema failures clearly', async () => {
    const providers = makeProviders(JSON.stringify({ type: 'wat', description: 'x', message: 'y' }));
    const res = await parseTaskFromText('X', { providers, ownerConversationId: 'c1' });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/validation|invalid_union|expected/i);
  });

  it('reports missing JSON', async () => {
    const providers = makeProviders('I cannot help with that.');
    const res = await parseTaskFromText('X', { providers, ownerConversationId: 'c1' });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('parse');
  });

  it('fails fast when no provider configured', async () => {
    const providers = new ProviderRegistry();
    const res = await parseTaskFromText('X', { providers, ownerConversationId: 'c1' });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('No active AI provider');
  });
});
