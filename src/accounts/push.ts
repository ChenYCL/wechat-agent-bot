/**
 * Proactive WeChat push — bypasses the SDK's reply-only public API.
 *
 * The SDK exports only `login` and `start`. Its internal `sendMessageWeixin`
 * helper hard-requires a `contextToken` (which only inbound messages carry),
 * but the underlying HTTP endpoint (`ilink/bot/sendmessage`) actually
 * accepts requests without one — `context_token` is optional at the wire
 * level, the guard is just SDK ergonomics.
 *
 * We use that here to push reminder / watch-trigger messages without
 * waiting for the user to message us first. We read the saved token from
 * the SDK's per-account state file (`~/.weixin-agent-sdk/accounts/<id>.json`)
 * and call the API directly with the same headers + payload shape the SDK
 * uses for normal replies.
 *
 * Caveat: the inability to thread the push into an existing conversation
 * means the user may see the message as a separate bot bubble. Worst case
 * is "the API rejects it"; the caller is expected to fall back to outbox
 * queuing in that case.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { logger } from '../utils/logger.js';

const MSG_TYPE_BOT = 2;
const ITEM_TYPE_TEXT = 1;
const STATE_FINISH = 2;

interface AccountState {
  token: string;
  baseUrl: string;
  cdnBaseUrl?: string;
  userId: string;
}

function resolveStateDir(): string {
  return process.env.OPENCLAW_STATE_DIR?.trim()
    || process.env.CLAWDBOT_STATE_DIR?.trim()
    || join(homedir(), '.openclaw');
}

function loadAccountState(accountId: string): AccountState | null {
  const file = join(resolveStateDir(), 'openclaw-weixin', 'accounts', `${accountId}.json`);
  if (!existsSync(file)) {
    logger.warn(`[push] account state file not found: ${file}`);
    return null;
  }
  try {
    const data = JSON.parse(readFileSync(file, 'utf-8'));
    if (!data.token || !data.baseUrl) return null;
    return {
      token: data.token,
      baseUrl: data.baseUrl,
      cdnBaseUrl: data.cdnBaseUrl,
      userId: data.userId,
    };
  } catch (err) {
    logger.warn(`[push] failed to read account state for ${accountId}: ${(err as Error).message}`);
    return null;
  }
}

function generateClientId(): string {
  return randomBytes(8).toString('hex');
}

function randomWechatUin(): string {
  const uint32 = randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(uint32), 'utf-8').toString('base64');
}

export interface PushResult {
  ok: boolean;
  status?: number;
  error?: string;
}

/** Send a single text message to `toUserId` from the account `accountId`. */
export async function pushTextMessage(
  accountId: string,
  toUserId: string,
  text: string,
  opts: { timeoutMs?: number } = {},
): Promise<PushResult> {
  if (!text) return { ok: false, error: 'empty text' };
  const state = loadAccountState(accountId);
  if (!state) return { ok: false, error: `account ${accountId} not registered with the SDK` };

  const body = JSON.stringify({
    msg: {
      from_user_id: '',
      to_user_id: toUserId,
      client_id: generateClientId(),
      message_type: MSG_TYPE_BOT,
      message_state: STATE_FINISH,
      item_list: [{ type: ITEM_TYPE_TEXT, text_item: { text } }],
    },
    base_info: {},
  });

  const base = state.baseUrl.endsWith('/') ? state.baseUrl : `${state.baseUrl}/`;
  const url = new URL('ilink/bot/sendmessage', base);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'AuthorizationType': 'ilink_bot_token',
    'Content-Length': String(Buffer.byteLength(body, 'utf-8')),
    'X-WECHAT-UIN': randomWechatUin(),
    'Authorization': `Bearer ${state.token}`,
  };

  try {
    const res = await fetch(url.toString(), {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
    });
    if (!res.ok) {
      const raw = await res.text().catch(() => '');
      logger.warn(`[push] HTTP ${res.status} from ${accountId} → ${toUserId}: ${raw.slice(0, 200)}`);
      return { ok: false, status: res.status, error: raw.slice(0, 200) };
    }
    logger.info(`[push] delivered to ${toUserId} via ${accountId} (${text.length} chars)`);
    return { ok: true, status: res.status };
  } catch (err) {
    logger.warn(`[push] network error: ${(err as Error).message}`);
    return { ok: false, error: (err as Error).message };
  }
}
