/**
 * Express middleware that resolves the current user from either a
 * session cookie ("sid") or a bearer token (treated as a session
 * token). Successful resolutions attach `req.user`; failed lookups
 * leave it undefined — route handlers decide whether to require auth.
 *
 * Use `requireUser` for hard-gated endpoints; use `attachUser` for
 * routes that want to optionally know the caller.
 */
import type { Request, Response, NextFunction } from 'express';
import type { AuthStore, User } from './store.js';

declare module 'express-serve-static-core' {
  interface Request {
    user?: User;
    sessionToken?: string;
  }
}

const COOKIE_NAME = 'sid';

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const pair of header.split(';')) {
    const eq = pair.indexOf('=');
    if (eq < 0) continue;
    const k = pair.slice(0, eq).trim();
    const v = pair.slice(eq + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export function attachUser(auth: AuthStore) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const cookies = parseCookies(req.headers.cookie);
    const cookieToken = cookies[COOKIE_NAME];
    const bearer = req.headers.authorization?.replace(/^Bearer /, '');
    const token = cookieToken || bearer;
    if (token) {
      const user = auth.resolveSession(token);
      if (user) {
        req.user = user;
        req.sessionToken = token;
      }
    }
    next();
  };
}

export function requireUser(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  next();
}

export function setSessionCookie(res: Response, token: string, maxAgeMs: number): void {
  // `Secure` blocks cookies over plain HTTP — only enable when we know
  // we're behind HTTPS (explicit env opt-in to avoid surprising lockout
  // on a fresh VPS that doesn't have TLS yet).
  const secure = process.env.SECURE_COOKIES === '1' ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(maxAgeMs / 1000)}${secure}`,
  );
}

export function clearSessionCookie(res: Response): void {
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`,
  );
}
