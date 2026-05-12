/**
 * QR-login bridge for the WeChat SDK.
 *
 * The SDK's `login()` renders a QR to the terminal via `qrcode-terminal`
 * and then long-polls for the scan to complete. For a WebUI we need to
 * surface the underlying URL (which gets QR-encoded client-side) instead
 * of rendering an ASCII QR no browser can read.
 *
 * Strategy: monkey-patch `qrcode-terminal.default.generate` ONCE at
 * process startup. When the SDK calls `generate(url, opts, cb)` during
 * login, we capture `url` into the most recently registered handler and
 * still invoke `cb` so login() proceeds normally.
 *
 * Concurrency: WeChat login is serialised in this process — only one
 * login can be in flight at a time. Anything else fails fast. That's a
 * fine trade-off for a small VPS deployment; concurrent self-service
 * onboarding is a v2 concern.
 */
// qrcode-terminal ships no types; we only use it for runtime monkey-patching.
// @ts-expect-error untyped CJS dependency from weixin-agent-sdk
import qrcodeTerminal from 'qrcode-terminal';
import { login as sdkLogin } from 'weixin-agent-sdk';
import { logger } from '../utils/logger.js';

interface PendingHandler {
  resolveUrl: (url: string) => void;
  rejectUrl: (err: Error) => void;
}

let patched = false;
let pending: PendingHandler | null = null;

function installPatch(): void {
  if (patched) return;
  patched = true;
  const proxy: any = qrcodeTerminal as any;
  const originalGenerate = proxy.generate?.bind(proxy);
  proxy.generate = function patchedGenerate(url: string, opts: any, cb?: (qr: string) => void) {
    if (pending) {
      const handler = pending;
      handler.resolveUrl(url);
    } else if (originalGenerate) {
      // Nobody listening — render to terminal as the SDK intended.
      try { return originalGenerate(url, opts, cb); } catch { /* fall through */ }
    }
    // Resolve callback so SDK's "await new Promise" continues immediately.
    cb?.('(rendered in WebUI)');
  };
  logger.info('[qr-bridge] qrcode-terminal patched');
}

export interface QrLoginHandle {
  /** Resolves once we capture the QR URL from the SDK. */
  qrUrl: Promise<string>;
  /** Resolves when the user finishes scanning, with the SDK accountId. */
  accountId: Promise<string>;
}

/**
 * Kick off a SDK QR login. Returns two promises: one for the QR URL
 * (resolves in ~1 second), one for the final accountId (resolves when
 * the user finishes scanning, or rejects if the user gives up / QR
 * expires / SDK errors).
 */
export function startQrLogin(): QrLoginHandle {
  installPatch();
  if (pending) {
    throw new Error('Another WeChat login is already in progress; try again in a moment.');
  }

  let resolveUrl!: (u: string) => void;
  let rejectUrl!: (e: Error) => void;
  const qrUrl = new Promise<string>((resolve, reject) => {
    resolveUrl = resolve;
    rejectUrl = reject;
  });
  pending = { resolveUrl, rejectUrl };

  const accountId = sdkLogin({
    log: (msg: string) => logger.debug(`[wechat-login] ${msg}`),
  }).then((id) => {
    pending = null;
    return id;
  }).catch((err) => {
    rejectUrl(err);
    pending = null;
    throw err;
  });

  return { qrUrl, accountId };
}

export function hasPendingLogin(): boolean {
  return pending !== null;
}
