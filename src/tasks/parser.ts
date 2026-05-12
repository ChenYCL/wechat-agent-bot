/**
 * LLM-based natural-language → UserTaskDraft parser.
 *
 * The active provider is asked to translate a free-form Chinese/English
 * request like "茅台跌破 1500 提醒我" into a strict JSON spec that we
 * then validate before persisting.
 *
 * Two safety nets:
 *   1. We never ship the JSON straight to the scheduler — UserTaskManager
 *      validates schedule/cron and watch.fetcher.url before arming.
 *   2. Output is also Zod-validated here so a malformed LLM reply
 *      surfaces as a useful error to the user instead of crashing.
 */
import { z } from 'zod';
import type { ProviderAccess } from '../skills/provider-access.js';
import type { UserTaskDraft, TaskType } from './types.js';
import { logger } from '../utils/logger.js';

const ReminderSchema = z.object({
  type: z.literal('reminder'),
  description: z.string().min(1),
  message: z.string().min(1),
  schedule: z.object({
    kind: z.enum(['once', 'cron']),
    runAt: z.union([z.string(), z.number()]).optional(),
    cron: z.string().optional(),
  }),
});

const WatchSchema = z.object({
  type: z.literal('watch'),
  description: z.string().min(1),
  message: z.string().min(1),
  watch: z.object({
    pollCron: z.string().optional(),
    fetcher: z.object({
      type: z.literal('http'),
      url: z.string().url(),
      method: z.enum(['GET', 'POST']).optional(),
      headers: z.record(z.string()).optional(),
      body: z.string().optional(),
      jsonPath: z.string().optional(),
      regex: z.string().optional(),
    }),
    condition: z.object({
      op: z.enum(['<', '>', '<=', '>=', '==', '!=', 'contains', 'not_contains', 'changes']),
      value: z.union([z.string(), z.number()]).optional(),
    }),
    oneShot: z.boolean().optional(),
  }),
});

const DraftSchema = z.union([ReminderSchema, WatchSchema]);
const ErrorSchema = z.object({ error: z.string() });

export interface ParseTaskOptions {
  providers: ProviderAccess;
  ownerConversationId: string;
  /** Optional language preference (e.g. "中文", "English"). Steers `description` / `message` wording. */
  language?: string | null;
  /** Override now() for deterministic tests. */
  now?: Date;
}

export interface ParseResult {
  ok: boolean;
  draft?: UserTaskDraft;
  error?: string;
  rawLlmReply?: string;
}

export async function parseTaskFromText(input: string, opts: ParseTaskOptions): Promise<ParseResult> {
  const provider = opts.providers.getActive(opts.ownerConversationId);
  if (!provider) return { ok: false, error: 'No active AI provider configured' };

  const now = opts.now ?? new Date();
  const langHint = opts.language ? `\nReply description/message in: ${opts.language}` : '';
  const systemPrompt = buildSystemPrompt(now, langHint);

  let reply: string;
  try {
    const res = await provider.chat({
      conversationId: `__task-parser__${opts.ownerConversationId}__${Date.now()}`,
      text: `${systemPrompt}\n\nUser request:\n${input}\n\nRespond with JSON only.`,
      disableTools: true,
    });
    reply = res.text?.trim() || '';
  } catch (err) {
    return { ok: false, error: `LLM call failed: ${(err as Error).message}` };
  }

  const jsonStr = extractJson(reply);
  if (!jsonStr) {
    logger.warn(`[task-parser] No JSON in LLM reply: ${reply.slice(0, 200)}`);
    return { ok: false, error: 'Could not parse a task from your request. Try being more explicit.', rawLlmReply: reply };
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(jsonStr);
  } catch (err) {
    return { ok: false, error: `Invalid JSON from LLM: ${(err as Error).message}`, rawLlmReply: reply };
  }

  // Handle explicit error response from LLM
  const errParse = ErrorSchema.safeParse(parsedJson);
  if (errParse.success) {
    return { ok: false, error: errParse.data.error, rawLlmReply: reply };
  }

  const parsed = DraftSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return {
      ok: false,
      error: `Task spec validation failed: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
      rawLlmReply: reply,
    };
  }

  const data = parsed.data;
  const draft: UserTaskDraft = {
    ownerConversationId: opts.ownerConversationId,
    type: data.type as TaskType,
    description: data.description,
    message: data.message,
    schedule: data.type === 'reminder' ? normalizeSchedule(data.schedule) : undefined,
    watch: data.type === 'watch'
      ? {
          pollCron: data.watch.pollCron || '*/5 * * * *',
          fetcher: data.watch.fetcher,
          condition: data.watch.condition,
          oneShot: data.watch.oneShot,
        }
      : undefined,
  };

  return { ok: true, draft };
}

function normalizeSchedule(s: { kind: 'once' | 'cron'; runAt?: string | number; cron?: string }): { kind: 'once' | 'cron'; runAt?: number; cron?: string } {
  if (s.kind === 'once') {
    if (s.runAt == null) return { kind: 'once' };
    if (typeof s.runAt === 'number') return { kind: 'once', runAt: s.runAt };
    const ms = Date.parse(s.runAt);
    return { kind: 'once', runAt: Number.isFinite(ms) ? ms : undefined };
  }
  return { kind: 'cron', cron: s.cron };
}

function buildSystemPrompt(now: Date, langHint: string): string {
  const isoNow = now.toISOString();
  const localNow = now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  return `You convert a user's natural-language request into a structured task spec for a WeChat bot.
Return ONLY a JSON object — no markdown fences, no commentary.

Current time:
  - UTC: ${isoNow}
  - Local (Asia/Shanghai): ${localNow}
${langHint}

Two task types are supported:

1) "reminder" — fire at one or more points in time.
   Schema:
   {
     "type": "reminder",
     "description": "<one-line summary of intent>",
     "message": "<text to send to the user when it fires>",
     "schedule": {
       "kind": "once" | "cron",
       "runAt": "<ISO-8601 with TZ, only if kind=once>",
       "cron": "<5-field cron, only if kind=cron>"
     }
   }

2) "watch" — periodically fetch an HTTP endpoint, extract a value, and
   fire when a condition is met. Use this for price alerts, status
   monitors, threshold checks, anything that needs polling external data.
   Schema:
   {
     "type": "watch",
     "description": "<one-line summary>",
     "message": "<delivered when condition is met; can use {value} placeholder>",
     "watch": {
       "pollCron": "*/5 * * * *",
       "fetcher": {
         "type": "http",
         "url": "https://...",
         "method": "GET",
         "headers": {"Accept": "application/json"},
         "jsonPath": "data.0.price"
       },
       "condition": { "op": "<" | ">" | "<=" | ">=" | "==" | "!=" | "contains" | "not_contains" | "changes",
                      "value": <number or string; omit for "changes"> },
       "oneShot": true
     }
   }

Rules:
- For one-off reminders, ALWAYS produce an absolute ISO timestamp in runAt. Convert relative phrases like "tomorrow 8am" to absolute time using the current Asia/Shanghai time provided above.
- For recurring reminders, prefer cron over once. Examples: weekly Monday 9am = "0 9 * * 1"; every day 7am = "0 7 * * *".
- For watch tasks, you MUST supply a real, working public HTTP URL with no auth. If the user wants something that requires a paid/login API, return an error.
- jsonPath uses dotted access (e.g. "items.0.value"). Omit it if the response is plain text.
- Default pollCron to "*/5 * * * *" unless the user implied otherwise.
- Default oneShot to true unless the user clearly wants repeated alerts.
- The user's local timezone is Asia/Shanghai unless they state otherwise.

If you CANNOT confidently produce a valid spec (ambiguous, missing data source, etc.), return:
  { "error": "<short reason in the user's language>" }

Some real public endpoints you can use:

== Weather ==
url: https://wttr.in/{city}?format=j1
jsonPath: "current_condition.0.temp_C"

== A-share stock (中国 A 股 — 实测可用) ==
url: https://hq.sinajs.cn/list=<prefix><code>
  where <prefix> = "sh" for 60xxxx/68xxxx (沪市), "sz" for 00xxxx/30xxxx (深市)
  e.g. 茅台 600519 → sh600519; 贤丰控股 002141 → sz002141
headers: { "Referer": "https://finance.sina.com.cn/" }   // ⚠️ required, else empty body
regex: "\\"[^,]*,[^,]*,[^,]*,([0-9.]+)"   // captures 当前价 (4th field)
  Sina format: var hq_str_sz002141="股票名,开盘,昨收,当前价,今高,今低,..."
NO jsonPath — sina returns plain text, not JSON.

== US stock (Yahoo Finance) ==
url: https://query1.finance.yahoo.com/v8/finance/chart/AAPL?interval=1m
jsonPath: "chart.result.0.meta.regularMarketPrice"

== Crypto (CoinGecko) ==
url: https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd
jsonPath: "bitcoin.usd"

Output JSON only.`;
}

function extractJson(text: string): string | null {
  // Strip markdown code fences if present
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  // Otherwise, take the first balanced { ... } block
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (escape) { escape = false; continue; }
    if (c === '\\') { escape = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}
