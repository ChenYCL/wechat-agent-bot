/**
 * Conversation context — bridges between SDK-level (raw conversationId per
 * account) and our internal scoped representation.
 *
 *   raw          = the value the SDK hands us (peer wxid for a chat)
 *   accountId    = which WeChat account received the message
 *   scopedId     = "${accountId}::${raw}" — globally unique in our SQLite
 *
 * The router and skills work on scopedIds. Storage layers (history,
 * memory, outbox, user_tasks) are keyed by scopedId so two different
 * accounts talking to "wxid_alice" don't share state.
 *
 * Synthetic ids — prefixed with `__` (e.g. `__task-parser__abc`) — are
 * used for internal LLM calls and never map to a real account.
 */
import type { WeChatAccountStore } from './store.js';

const SEPARATOR = '::';

export interface ConversationContext {
  raw: string;
  accountId: string;
  userId: string;
  scopedId: string;
}

export function encodeScopedId(accountId: string, raw: string): string {
  return `${accountId}${SEPARATOR}${raw}`;
}

export function decodeScopedId(scopedId: string): { accountId: string; raw: string } | null {
  if (!scopedId || scopedId.startsWith('__')) return null;
  const idx = scopedId.indexOf(SEPARATOR);
  if (idx <= 0) return null;
  return {
    accountId: scopedId.slice(0, idx),
    raw: scopedId.slice(idx + SEPARATOR.length),
  };
}

export function isSyntheticId(id: string): boolean {
  return id.startsWith('__');
}

export class ContextResolver {
  constructor(private accounts: WeChatAccountStore) {}

  fromScopedId(scopedId: string): ConversationContext | null {
    const parts = decodeScopedId(scopedId);
    if (!parts) return null;
    const userId = this.accounts.ownerOf(parts.accountId);
    if (!userId) return null;
    return { raw: parts.raw, accountId: parts.accountId, userId, scopedId };
  }

  fromAccountAndRaw(accountId: string, raw: string): ConversationContext | null {
    const userId = this.accounts.ownerOf(accountId);
    if (!userId) return null;
    return { raw, accountId, userId, scopedId: encodeScopedId(accountId, raw) };
  }
}
