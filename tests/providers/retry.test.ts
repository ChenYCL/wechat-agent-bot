import { describe, it, expect, vi } from 'vitest';
import { withRetry, modelRejectsTemperature } from '../../src/providers/retry.js';

describe('withRetry', () => {
  it('returns the result when fn succeeds on first try', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    expect(await withRetry(fn)).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on transient errors and eventually returns', async () => {
    let attempts = 0;
    const fn = vi.fn().mockImplementation(async () => {
      attempts++;
      if (attempts < 3) {
        const e = new Error('429 Too Many Requests');
        (e as any).status = 429;
        throw e;
      }
      return 'recovered';
    });
    const result = await withRetry(fn, { attempts: 4, baseMs: 1, maxMs: 5 });
    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does not retry on non-transient errors', async () => {
    const fn = vi.fn().mockImplementation(async () => {
      const e = new Error('401 Unauthorized');
      (e as any).status = 401;
      throw e;
    });
    await expect(withRetry(fn, { attempts: 3, baseMs: 1, maxMs: 5 })).rejects.toThrow('401');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('gives up after the configured attempts', async () => {
    const fn = vi.fn().mockImplementation(async () => {
      const e = new Error('503 Service Unavailable');
      (e as any).status = 503;
      throw e;
    });
    await expect(withRetry(fn, { attempts: 2, baseMs: 1, maxMs: 5 })).rejects.toThrow('503');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe('modelRejectsTemperature', () => {
  it('flags o1/o3 reasoning models', () => {
    expect(modelRejectsTemperature('o1')).toBe(true);
    expect(modelRejectsTemperature('o1-mini')).toBe(true);
    expect(modelRejectsTemperature('o3-pro')).toBe(true);
  });

  it('does not flag regular models', () => {
    expect(modelRejectsTemperature('gpt-4o')).toBe(false);
    expect(modelRejectsTemperature('claude-sonnet-4')).toBe(false);
  });
});
