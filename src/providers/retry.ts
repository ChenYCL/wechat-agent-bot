/**
 * Tiny retry helper for provider API calls.
 *
 * Retries on transient errors (HTTP 429 / 5xx, network timeouts) using
 * exponential backoff with jitter. Other errors are re-thrown immediately
 * so we don't waste tokens or amplify quota errors.
 */
import { logger } from '../utils/logger.js';

const TRANSIENT_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const TRANSIENT_KEYWORDS = ['ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND', 'timeout', 'fetch failed', 'socket hang up'];

export interface RetryOptions {
  attempts?: number;
  baseMs?: number;
  maxMs?: number;
  label?: string;
}

function isTransient(err: unknown): boolean {
  const e = err as { status?: number; code?: string; message?: string };
  if (e?.status && TRANSIENT_STATUS.has(e.status)) return true;
  const msg = String(e?.message || '');
  return TRANSIENT_KEYWORDS.some((kw) => msg.includes(kw));
}

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const baseMs = opts.baseMs ?? 500;
  const maxMs = opts.maxMs ?? 5_000;
  const label = opts.label ?? 'request';

  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isTransient(err) || i === attempts - 1) throw err;
      const delay = Math.min(maxMs, baseMs * 2 ** i) + Math.random() * 200;
      logger.warn(`[retry] ${label} transient error (${(err as Error).message}); retry ${i + 1}/${attempts - 1} in ${Math.round(delay)}ms`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

/**
 * Reasoning-style models that reject `temperature` / certain other params.
 * (o1, o3, o4 series at the time of writing.)
 */
export function modelRejectsTemperature(model: string): boolean {
  return /^o[1-9]\b|^o[1-9]-/i.test(model) || /^gpt-.*-reasoning/i.test(model);
}
