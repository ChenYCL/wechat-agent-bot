/**
 * Concrete search provider implementations + the auto-selector.
 *
 * Provider precedence (first usable wins):
 *   1. TAVILY_API_KEY   — best quality for LLM use; free tier 1k/mo
 *   2. SERPER_API_KEY   — Google results via serper.dev
 *   3. BRAVE_API_KEY    — Brave Search
 *   4. DuckDuckGo       — no key, no rate limit doc, instant-answer only
 */
import type { SearchProvider, SearchResult, SearchOptions } from './types.js';
import { logger } from '../utils/logger.js';

const TIMEOUT_MS = 12_000;

// ─────────────────────────────────────────────────────────────────────────────
// Tavily
// ─────────────────────────────────────────────────────────────────────────────
class TavilyProvider implements SearchProvider {
  readonly name = 'tavily';
  constructor(private apiKey: string) {}
  async search(query: string, opts: SearchOptions = {}): Promise<SearchResult[]> {
    const body = {
      api_key: this.apiKey,
      query,
      max_results: opts.maxResults ?? 5,
      search_depth: 'basic',
      include_answer: false,
      ...(opts.freshDays ? { days: opts.freshDays } : {}),
    };
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Tavily ${res.status}: ${await res.text().catch(() => '')}`);
    const data = await res.json() as { results?: Array<{ title: string; url: string; content: string; published_date?: string }> };
    return (data.results ?? []).map((r) => ({
      title: r.title, url: r.url, snippet: r.content,
      publishedAt: r.published_date, source: 'tavily',
    }));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Serper (Google)
// ─────────────────────────────────────────────────────────────────────────────
class SerperProvider implements SearchProvider {
  readonly name = 'serper';
  constructor(private apiKey: string) {}
  async search(query: string, opts: SearchOptions = {}): Promise<SearchResult[]> {
    const body: any = { q: query, num: opts.maxResults ?? 5 };
    if (opts.lang === 'zh') body.gl = 'cn';
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': this.apiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Serper ${res.status}: ${await res.text().catch(() => '')}`);
    const data = await res.json() as { organic?: Array<{ title: string; link: string; snippet: string; date?: string }> };
    return (data.organic ?? []).map((r) => ({
      title: r.title, url: r.link, snippet: r.snippet,
      publishedAt: r.date, source: 'serper',
    }));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Brave
// ─────────────────────────────────────────────────────────────────────────────
class BraveProvider implements SearchProvider {
  readonly name = 'brave';
  constructor(private apiKey: string) {}
  async search(query: string, opts: SearchOptions = {}): Promise<SearchResult[]> {
    const params = new URLSearchParams({
      q: query,
      count: String(opts.maxResults ?? 5),
    });
    const res = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
      headers: {
        'Accept': 'application/json',
        'X-Subscription-Token': this.apiKey,
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Brave ${res.status}: ${await res.text().catch(() => '')}`);
    const data = await res.json() as { web?: { results?: Array<{ title: string; url: string; description: string; age?: string }> } };
    return (data.web?.results ?? []).map((r) => ({
      title: r.title, url: r.url, snippet: r.description,
      publishedAt: r.age, source: 'brave',
    }));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DuckDuckGo (no key, free fallback)
// ─────────────────────────────────────────────────────────────────────────────
class DuckDuckGoProvider implements SearchProvider {
  readonly name = 'duckduckgo';
  async search(query: string, opts: SearchOptions = {}): Promise<SearchResult[]> {
    // The HTML endpoint gives real organic results without a key but
    // returns HTML; we parse the minimal "result" blocks. This is
    // best-effort and fragile — DDG can change markup any day.
    const params = new URLSearchParams({ q: query });
    const res = await fetch(`https://html.duckduckgo.com/html/?${params}`, {
      headers: {
        // DDG html endpoint blocks empty UA
        'User-Agent': 'Mozilla/5.0 (compatible; wechat-agent-bot/0.1)',
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`DDG ${res.status}`);
    const html = await res.text();
    const max = opts.maxResults ?? 5;
    const results: SearchResult[] = [];
    const re = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) && results.length < max) {
      const url = decodeURIComponent((m[1].match(/uddg=([^&]+)/)?.[1]) ?? m[1]);
      const stripTags = (s: string) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').trim();
      results.push({
        title: stripTags(m[2]),
        url,
        snippet: stripTags(m[3]),
        source: 'duckduckgo',
      });
    }
    return results;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Auto-selector
// ─────────────────────────────────────────────────────────────────────────────
export function pickSearchProvider(env: NodeJS.ProcessEnv = process.env): SearchProvider {
  if (env.TAVILY_API_KEY) return new TavilyProvider(env.TAVILY_API_KEY);
  if (env.SERPER_API_KEY) return new SerperProvider(env.SERPER_API_KEY);
  if (env.BRAVE_API_KEY) return new BraveProvider(env.BRAVE_API_KEY);
  return new DuckDuckGoProvider();
}

/** Re-evaluates the active provider — useful when env changes at runtime. */
export class DynamicSearchProvider implements SearchProvider {
  get name() { return pickSearchProvider().name; }
  async search(query: string, opts?: SearchOptions): Promise<SearchResult[]> {
    const p = pickSearchProvider();
    try {
      const r = await p.search(query, opts);
      return r;
    } catch (err) {
      logger.warn(`[search] ${p.name} failed: ${(err as Error).message}; falling back to DDG`);
      if (p.name === 'duckduckgo') throw err;
      return await new DuckDuckGoProvider().search(query, opts);
    }
  }
}
