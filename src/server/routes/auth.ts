/**
 * Auth endpoints: signup, login, logout, current user (`me`).
 *
 * For VPS / multi-user deployments:
 *  - If `DISABLE_SIGNUP=1` is set, /api/auth/signup returns 403 unless
 *    a valid admin session is presented. (Admins can still invite.)
 *  - Set `API_SECRET` to also accept a bearer token as a master key
 *    (legacy single-tenant compatibility).
 */
import { Router } from 'express';
import type { AuthStore } from '../../auth/store.js';
import { setSessionCookie, clearSessionCookie, requireUser } from '../../auth/middleware.js';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function createAuthRoutes(auth: AuthStore) {
  const router = Router();

  router.post('/signup', (req, res) => {
    if (process.env.DISABLE_SIGNUP === '1' && !req.user?.isAdmin) {
      return res.status(403).json({ error: 'Signups are disabled. Contact the admin.' });
    }
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'username and password required' });
    try {
      const user = auth.signup(username, password);
      if (!user) return res.status(409).json({ error: 'Username already taken' });
      const session = auth.createSession(user.id, SESSION_TTL_MS);
      setSessionCookie(res, session.token, SESSION_TTL_MS);
      res.json({ user });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  router.post('/login', (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'username and password required' });
    const user = auth.verifyPassword(username, password);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    const session = auth.createSession(user.id, SESSION_TTL_MS);
    setSessionCookie(res, session.token, SESSION_TTL_MS);
    res.json({ user });
  });

  router.post('/logout', (req, res) => {
    if (req.sessionToken) auth.deleteSession(req.sessionToken);
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  router.get('/me', requireUser, (req, res) => {
    res.json({ user: req.user });
  });

  router.post('/password', requireUser, (req, res) => {
    const { oldPassword, newPassword } = req.body || {};
    if (!oldPassword || !newPassword) return res.status(400).json({ error: 'oldPassword and newPassword required' });
    try {
      const ok = auth.changePassword(req.user!.id, oldPassword, newPassword);
      if (!ok) return res.status(401).json({ error: 'Old password incorrect' });
      // Invalidate other sessions for this user (force re-login elsewhere)
      auth.deleteSessionsForUser(req.user!.id);
      const session = auth.createSession(req.user!.id, SESSION_TTL_MS);
      setSessionCookie(res, session.token, SESSION_TTL_MS);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  return router;
}
