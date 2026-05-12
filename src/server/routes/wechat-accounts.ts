/**
 * /api/wechat-accounts — manage the current user's WeChat accounts.
 *
 *   GET    /                              List my accounts
 *   POST   /start-login                   Begin a QR login; returns { sessionId, qrUrl }
 *   GET    /login-status/:sessionId       Poll: { pending|success(accountId)|error }
 *   POST   /:accountId/alias              Set alias
 *   POST   /:accountId/pause              Stop receiving messages
 *   POST   /:accountId/resume             Restart message loop
 *   DELETE /:accountId                    Remove (also stops the loop)
 */
import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { requireUser } from '../../auth/middleware.js';
import type { WeChatAccountStore } from '../../accounts/store.js';
import type { MultiAccountBot } from '../../accounts/multi-bot.js';
import { startQrLogin, hasPendingLogin } from '../../accounts/qr-bridge.js';
import { logger } from '../../utils/logger.js';

type PendingState =
  | { state: 'pending'; qrUrl?: string; userId: string; createdAt: number }
  | { state: 'success'; accountId: string; userId: string; createdAt: number }
  | { state: 'error'; error: string; userId: string; createdAt: number };

const PENDING_TTL_MS = 10 * 60 * 1000;

export function createWeChatAccountRoutes(accounts: WeChatAccountStore, bot: MultiAccountBot) {
  const router = Router();
  // sessionId → state; we don't persist (in-flight only).
  const sessions = new Map<string, PendingState>();

  // Periodic prune of stale session entries
  setInterval(() => {
    const cutoff = Date.now() - PENDING_TTL_MS;
    for (const [id, s] of sessions) if (s.createdAt < cutoff) sessions.delete(id);
  }, 60_000).unref();

  router.use(requireUser);

  router.get('/', (req, res) => {
    const list = accounts.listForUser(req.user!.id);
    const running = new Set(bot.listRunning());
    res.json({ accounts: list.map((a) => ({ ...a, running: running.has(a.accountId) })) });
  });

  router.post('/start-login', (req, res) => {
    if (hasPendingLogin()) {
      return res.status(429).json({ error: '另一个微信登录正在进行中，请稍后再试' });
    }
    const sessionId = randomUUID();
    const userId = req.user!.id;
    sessions.set(sessionId, { state: 'pending', userId, createdAt: Date.now() });

    let handle;
    try {
      handle = startQrLogin();
    } catch (err) {
      sessions.delete(sessionId);
      return res.status(409).json({ error: (err as Error).message });
    }

    handle.qrUrl
      .then((url) => {
        const cur = sessions.get(sessionId);
        if (cur && cur.state === 'pending') sessions.set(sessionId, { ...cur, qrUrl: url });
      })
      .catch((err) => {
        logger.warn(`[wechat-accounts] qrUrl rejected: ${err.message}`);
      });

    handle.accountId
      .then(async (accountId) => {
        // Register the new account to this user; kick off bot loop.
        try {
          accounts.registerPending(accountId, userId);
          await bot.startAccount(accountId);
          accounts.markActive(accountId);
          sessions.set(sessionId, { state: 'success', accountId, userId, createdAt: Date.now() });
        } catch (err) {
          sessions.set(sessionId, { state: 'error', error: (err as Error).message, userId, createdAt: Date.now() });
        }
      })
      .catch((err) => {
        sessions.set(sessionId, { state: 'error', error: err.message, userId, createdAt: Date.now() });
      });

    res.json({ sessionId });
  });

  router.get('/login-status/:sessionId', (req, res) => {
    const s = sessions.get(req.params.sessionId);
    if (!s) return res.status(404).json({ error: 'Unknown session' });
    if (s.userId !== req.user!.id) return res.status(403).json({ error: 'Not your session' });
    if (s.state === 'pending') return res.json({ state: 'pending', qrUrl: s.qrUrl });
    if (s.state === 'success') return res.json({ state: 'success', accountId: s.accountId });
    return res.json({ state: 'error', error: s.error });
  });

  router.post('/:accountId/alias', (req, res) => {
    const ok = accounts.setAlias(req.params.accountId, req.body?.alias ?? null, req.user!.id);
    if (!ok) return res.status(404).json({ error: 'Account not found' });
    res.json({ ok: true });
  });

  router.post('/:accountId/pause', async (req, res) => {
    const a = accounts.get(req.params.accountId);
    if (!a || a.userId !== req.user!.id) return res.status(404).json({ error: 'Account not found' });
    await bot.stopAccount(a.accountId);
    accounts.markLoggedOut(a.accountId);
    res.json({ ok: true });
  });

  router.post('/:accountId/resume', async (req, res) => {
    const a = accounts.get(req.params.accountId);
    if (!a || a.userId !== req.user!.id) return res.status(404).json({ error: 'Account not found' });
    try {
      await bot.startAccount(a.accountId);
      accounts.markActive(a.accountId);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.delete('/:accountId', async (req, res) => {
    const a = accounts.get(req.params.accountId);
    if (!a || a.userId !== req.user!.id) return res.status(404).json({ error: 'Account not found' });
    await bot.stopAccount(a.accountId);
    accounts.delete(a.accountId, req.user!.id);
    res.json({ ok: true });
  });

  return router;
}
