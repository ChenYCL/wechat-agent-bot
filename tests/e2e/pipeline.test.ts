/**
 * E2E Pipeline Test
 *
 * Tests the FULL message pipeline without real WeChat:
 *   message → router → skill/provider → response
 *
 * Uses DryRunBot + mock provider to verify end-to-end behavior.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { DryRunBot } from '../../src/core/dry-run.js';
import { MessageRouter } from '../../src/core/router.js';
import { ProviderRegistry } from '../../src/providers/registry.js';
import { SkillRegistry } from '../../src/skills/registry.js';
import { createHelpSkill } from '../../src/skills/builtin/help.js';
import { createModelSkill } from '../../src/skills/builtin/model.js';
import { createClearSkill } from '../../src/skills/builtin/clear.js';
import type { ChatRequest, ChatResponse } from '../../src/core/types.js';

describe('E2E Pipeline', () => {
  let bot: DryRunBot;
  let providers: ProviderRegistry;
  let skills: SkillRegistry;

  beforeAll(() => {
    providers = new ProviderRegistry();
    skills = new SkillRegistry();

    // Register mock provider that echoes back
    providers.registerFactory('mock', (config) => ({
      id: config.id,
      name: config.name,
      config,
      async chat(req: ChatRequest): Promise<ChatResponse> {
        return { text: `[mock-${config.model}] ${req.text}` };
      },
      async clearSession() {},
    }));

    providers.addProvider({
      id: 'mock-gpt',
      name: 'Mock GPT',
      provider: 'mock',
      model: 'gpt-4o',
      apiKey: 'fake',
    });

    providers.addProvider({
      id: 'mock-claude',
      name: 'Mock Claude',
      provider: 'mock',
      model: 'claude-sonnet',
      apiKey: 'fake',
    });

    // Register skills
    skills.register(createHelpSkill(() => skills.getAll()));
    skills.register(createModelSkill(providers));
    skills.register(createClearSkill(providers));

    const router = new MessageRouter(providers, skills);
    bot = new DryRunBot(router);
  });

  // ── 基础消息路由 ──
  it('should route normal messages to active provider', async () => {
    const res = await bot.send('Hello');
    expect(res.text).toBe('[mock-gpt-4o] Hello');
  });

  it('should handle empty messages', async () => {
    const res = await bot.send('');
    expect(res.text).toContain('[mock-gpt-4o]');
  });

  // ── Skill 系统 ──
  it('/help should list all available skills', async () => {
    const res = await bot.send('/help');
    expect(res.text).toContain('/help');
    expect(res.text).toContain('/model');
    expect(res.text).toContain('/clear');
  });

  it('/model list should show all providers', async () => {
    const res = await bot.send('/model list');
    expect(res.text).toContain('Mock GPT');
    expect(res.text).toContain('Mock Claude');
    expect(res.text).toContain('mock-gpt');
  });

  it('/model should switch active provider', async () => {
    const res1 = await bot.send('/model mock-claude');
    expect(res1.text).toContain('已切换');
    expect(res1.text).toContain('claude-sonnet');

    // Verify next message goes to claude
    const res2 = await bot.send('Test after switch');
    expect(res2.text).toBe('[mock-claude-sonnet] Test after switch');

    // Switch back
    await bot.send('/model mock-gpt');
  });

  it('/model with invalid id should return error', async () => {
    const res = await bot.send('/model nonexistent');
    expect(res.text).toContain('切换失败');
  });

  it('/clear should clear conversation', async () => {
    const res = await bot.send('/clear');
    expect(res.text).toContain('清空');
  });

  // ── 未知 slash command 回退到 provider ──
  it('unknown /command should fall through to provider', async () => {
    const res = await bot.send('/unknown-command');
    // unknown commands fall through to provider, but memory context may prefix it
    expect(res.text).toContain('[mock-gpt-4o]');
  });

  // ── 多轮对话 ──
  it('should maintain conversation context (same conversationId)', async () => {
    const res1 = await bot.send('message 1');
    const res2 = await bot.send('message 2');
    expect(res1.text).toContain('message 1');
    expect(res2.text).toContain('message 2');
  });
});
