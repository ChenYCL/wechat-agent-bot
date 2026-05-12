/**
 * Heuristic "auto-search" — when a user's message looks time-sensitive,
 * run a web search server-side BEFORE invoking the LLM, and inject the
 * results as context. This works even when the model lacks tool-calling
 * support (relays like 中转-gpt-5.5 silently ignore the `tools` field).
 *
 * Triggered on keyword classes:
 *   - explicit-time:  今天 / 今日 / 现在 / 目前 / 最新 / 此刻 / 当前 / 这周
 *   - market/finance: 股价 / 涨跌 / 市值 / 汇率 / 利率 / 比特币 / BTC
 *   - news/events:    新闻 / 头条 / 发布 / 上线 / 加息 / 召开
 *   - prices:         房价 / 价格 / 油价 / 黄金 / 票价
 *   - explicit year:  2025 / 2026 / 2027 (any year > current year - 2)
 *
 * Conservative defaults so we don't burn quota on chit-chat.
 */
import type { SearchProvider } from './types.js';
import { logger } from '../utils/logger.js';

const KEYWORDS = [
  // time
  /今天|今日|现在|目前|最新|此刻|当前|这周|本周|这个月|本月|刚刚|最近/,
  /\btoday\b|\btomorrow\b|\bnow\b|\blatest\b|\brecent\b|\bcurrent\b|\bthis week\b/i,
  // market / finance
  /股价|涨跌|市值|汇率|利率|加息|降息|比特币|以太坊/,
  /\bbtc\b|\beth\b|\bbitcoin\b|\bstock price\b|\bexchange rate\b/i,
  // news / events
  /新闻|头条|发布|上线|召开|签约|公布/,
  /\bnews\b|\brelease\b|\blaunched?\b|\bannouncement\b/i,
  // prices
  /房价|价格|油价|金价|黄金|票价|多少钱|什么价/,
  /\bprice\b|\bcost\b|\bhow much\b/i,
  // weather (we already have /weather but model may not call it)
  /天气|降雨|气温|空气质量|aqi/i,
];

function looksTimeSensitive(text: string): boolean {
  if (!text || text.length < 2) return false;
  // explicit year > nowYear - 2 → likely about current/recent
  const nowYear = new Date().getFullYear();
  const yearMatch = text.match(/\b(20\d{2})\b/);
  if (yearMatch && parseInt(yearMatch[1], 10) >= nowYear - 1) return true;
  return KEYWORDS.some((re) => re.test(text));
}

export interface AutoSearchOptions {
  /** Skip if message contains this token (escape hatch). */
  escapeToken?: string;
  /** Hard rate limit per conversation. Default 1 search per 30s. */
  minIntervalMs?: number;
  /** Max chars to inject. */
  maxContextChars?: number;
  /** How many results to fetch. */
  maxResults?: number;
}

export class AutoSearchInjector {
  private lastSearchAt = new Map<string, number>();
  private readonly minIntervalMs: number;
  private readonly maxContextChars: number;
  private readonly maxResults: number;
  private readonly escapeToken: string;

  constructor(private provider: SearchProvider, opts: AutoSearchOptions = {}) {
    this.minIntervalMs = opts.minIntervalMs ?? 30_000;
    this.maxContextChars = opts.maxContextChars ?? 1500;
    this.maxResults = opts.maxResults ?? 3;
    this.escapeToken = opts.escapeToken ?? '[no-search]';
  }

  /**
   * Returns a context block to prepend to the user message, or empty
   * string if no search was performed. Never throws — search failure
   * is logged and silently skipped.
   */
  async maybeSearch(conversationId: string, userText: string): Promise<string> {
    if (!userText) return '';
    if (userText.includes(this.escapeToken)) return '';
    if (!looksTimeSensitive(userText)) {
      logger.debug(`[auto-search] skipped (no keyword): "${userText.slice(0, 60)}"`);
      return '';
    }
    logger.info(`[auto-search] triggered for: "${userText.slice(0, 80)}"`);

    const now = Date.now();
    const last = this.lastSearchAt.get(conversationId) ?? 0;
    if (now - last < this.minIntervalMs) return '';
    this.lastSearchAt.set(conversationId, now);

    const query = userText.slice(0, 200).replace(this.escapeToken, '').trim();
    try {
      const results = await this.provider.search(query, { maxResults: this.maxResults });
      if (results.length === 0) {
        // Tell the model explicitly that the search returned nothing.
        // Without this, models tend to hallucinate "I just searched and…"
        // based on their training data and present it as fresh.
        logger.warn(`[auto-search] 0 results for "${query.slice(0, 60)}"`);
        return '[Live web search ran for this query and returned NO results. Do NOT fabricate prices, statistics or news. Tell the user the search returned nothing and suggest a more specific query.]\n';
      }
      const lines: string[] = [
        '[Live web search context — injected automatically because the user asked about a time-sensitive topic.',
        ' Use these facts in your answer. Cite the relevant URL inline if helpful.]',
        '',
      ];
      let chars = 0;
      for (const r of results) {
        const date = r.publishedAt ? ` · ${r.publishedAt}` : '';
        const block = `• ${r.title}${date}\n  ${r.snippet}\n  ${r.url}`;
        if (chars + block.length > this.maxContextChars) break;
        lines.push(block);
        chars += block.length + 1;
      }
      lines.push('');
      logger.info(`[auto-search] injected ${results.length} results for "${query.slice(0, 60)}" (${this.provider.name})`);
      return lines.join('\n');
    } catch (err) {
      const msg = (err as Error).message;
      logger.warn(`[auto-search] failed: ${msg}`);
      return `[Live web search FAILED: ${msg}. Tell the user the search provider is unavailable and that the operator should set a TAVILY_API_KEY (free 1000/mo at app.tavily.com). Do NOT fabricate current data.]\n`;
    }
  }
}
