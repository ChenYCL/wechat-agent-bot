/**
 * Raw HTTP push — last-resort fallback when SDK Bot.sendMessage fails
 * due to "no context_token cached" (i.e. the bot has never received an
 * inbound message from anyone on this account, so the SDK has no token
 * to echo).
 *
 * The underlying `ilink/bot/sendmessage` HTTP endpoint actually accepts
 * requests with `context_token: undefined` — the constraint is only at
 * the SDK wrapper layer. We hit it directly here, reading the saved
 * per-account token from the SDK's state files.
 *
 * Trade-off: messages sent this way are NOT threaded into an existing
 * conversation (no contextToken means a free-standing bot message), but
 * delivery is reliable. Used as `multiBot.send`'s second attempt after
 * Bot.sendMessage fails.
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
}

function resolveStateDir(): string {
  return process.env.OPENCLAW_STATE_DIR?.trim()
    || process.env.CLAWDBOT_STATE_DIR?.trim()
    || join(homedir(), '.openclaw');
}

function loadAccountState(accountId: string): AccountState | null {
  const file = join(resolveStateDir(), 'openclaw-weixin', 'accounts', `${accountId}.json`);
  if (!existsSync(file)) return null;
  try {
    const data = JSON.parse(readFileSync(file, 'utf-8'));
    if (!data.token || !data.baseUrl) return null;
    return { token: data.token, baseUrl: data.baseUrl };
  } catch (err) {
    logger.warn(`[raw-push] failed to read account state for ${accountId}: ${(err as Error).message}`);
    return null;
  }
}

function generateClientId(): string {
  return randomBytes(8).toString('hex');
}

function randomWechatUin(): string {
  const u = randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(u), 'utf-8').toString('base64');
}

export async function rawPushTextMessage(
  accountId: string,
  toUserId: string,
  text: string,
  opts: { timeoutMs?: number } = {},
): Promise<{ ok: boolean; error?: string }> {
  if (!text) return { ok: false, error: 'empty text' };
  const state = loadAccountState(accountId);
  if (!state) return { ok: false, error: `account ${accountId} not registered` };

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
      return { ok: false, error: `HTTP ${res.status}: ${raw.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
