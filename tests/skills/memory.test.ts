import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryManager, createRememberSkill, createRecallSkill, createForgetSkill } from '../../src/skills/builtin/memory.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('Memory System', () => {
  let tmpDir: string;
  let manager: MemoryManager;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'wechat-mem-test-'));
    manager = new MemoryManager(tmpDir);
    await manager.init();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe('MemoryManager', () => {
    it('should save and retrieve a memory', async () => {
      await manager.set('conv-1', 'name', 'Alice');
      const mem = await manager.get('conv-1', 'name');
      expect(mem?.content).toBe('Alice');
      expect(mem?.key).toBe('name');
    });

    it('should list all memories for a conversation', async () => {
      await manager.set('conv-1', 'name', 'Alice');
      await manager.set('conv-1', 'role', 'Developer');
      const all = await manager.getAll('conv-1');
      expect(Object.keys(all)).toHaveLength(2);
    });

    it('should update existing memory', async () => {
      await manager.set('conv-1', 'name', 'Alice');
      await manager.set('conv-1', 'name', 'Bob');
      const mem = await manager.get('conv-1', 'name');
      expect(mem?.content).toBe('Bob');
    });

    it('should delete a memory', async () => {
      await manager.set('conv-1', 'name', 'Alice');
      const deleted = await manager.delete('conv-1', 'name');
      expect(deleted).toBe(true);
      const mem = await manager.get('conv-1', 'name');
      expect(mem).toBeUndefined();
    });

    it('should isolate memories per conversation', async () => {
      await manager.set('conv-1', 'name', 'Alice');
      await manager.set('conv-2', 'name', 'Bob');
      expect((await manager.get('conv-1', 'name'))?.content).toBe('Alice');
      expect((await manager.get('conv-2', 'name'))?.content).toBe('Bob');
    });

    it('should build context string', async () => {
      await manager.set('conv-1', 'name', 'Alice');
      await manager.set('conv-1', 'lang', 'Chinese');
      const ctx = await manager.buildContext('conv-1');
      expect(ctx).toContain('name: Alice');
      expect(ctx).toContain('lang: Chinese');
    });

    it('should return empty context for no memories', async () => {
      const ctx = await manager.buildContext('nonexistent');
      expect(ctx).toBe('');
    });

    it('should persist across new manager instances', async () => {
      await manager.set('conv-1', 'name', 'Alice');
      const manager2 = new MemoryManager(tmpDir);
      await manager2.init();
      const mem = await manager2.get('conv-1', 'name');
      expect(mem?.content).toBe('Alice');
    });
  });

  describe('/remember skill', () => {
    it('should save a memory via skill', async () => {
      const skill = createRememberSkill(manager);
      const res = await skill.execute({ conversationId: 'c1', text: 'name Alice' });
      expect(res.text).toContain('Remembered');
      expect((await manager.get('c1', 'name'))?.content).toBe('Alice');
    });

    it('should reject empty input', async () => {
      const skill = createRememberSkill(manager);
      const res = await skill.execute({ conversationId: 'c1', text: '' });
      expect(res.text).toContain('Usage');
    });
  });

  describe('/recall skill', () => {
    it('should recall a specific memory', async () => {
      await manager.set('c1', 'name', 'Alice');
      const skill = createRecallSkill(manager);
      const res = await skill.execute({ conversationId: 'c1', text: 'name' });
      expect(res.text).toContain('Alice');
    });

    it('should list all memories when no key given', async () => {
      await manager.set('c1', 'name', 'Alice');
      await manager.set('c1', 'role', 'Dev');
      const skill = createRecallSkill(manager);
      const res = await skill.execute({ conversationId: 'c1', text: '' });
      expect(res.text).toContain('name');
      expect(res.text).toContain('role');
      expect(res.text).toContain('Memories (2)');
    });
  });

  describe('/forget skill', () => {
    it('should delete a memory', async () => {
      await manager.set('c1', 'name', 'Alice');
      const skill = createForgetSkill(manager);
      const res = await skill.execute({ conversationId: 'c1', text: 'name' });
      expect(res.text).toContain('Forgot');
      expect(await manager.get('c1', 'name')).toBeUndefined();
    });
  });
});
