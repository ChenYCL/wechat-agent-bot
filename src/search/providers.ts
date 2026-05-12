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
// Bing (no key, free fallback — DDG html endpoint stopped working in 2026)
// ─────────────────────────────────────────────────────────────────────────────
class BingProvider implements SearchProvider {
  readonly name = 'bing';
  async search(query: string, opts: SearchOptions = {}): Promise<SearchResult[]> {
    const lang = opts.lang === 'zh' ? 'zh-CN' : 'en-US';
    const mkt = opts.lang === 'zh' ? 'zh-CN' : 'en-US';
    const params = new URLSearchParams({ q: query, mkt, setlang: lang });
    const res = await fetch(`https://www.bing.com/search?${params}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        'Accept-Language': `${lang},${lang.split('-')[0]};q=0.9,en;q=0.8`,
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Bing ${res.status}`);
    const html = await res.text();
    return parseBingHtml(html, opts.maxResults ?? 5);
  }
}

function parseBingHtml(html: string, max: number): SearchResult[] {
  const results: SearchResult[] = [];
  // Split into per-result blocks at each <li class="b_algo">
  const positions: number[] = [];
  const blockRe = /<li[^>]*class="[^"]*b_algo[^"]*"/g;
  let bm: RegExpExecArray | null;
  while ((bm = blockRe.exec(html))) positions.push(bm.index);
  positions.push(html.length);

  for (let i = 0; i < positions.length - 1 && results.length < max; i++) {
    const chunk = html.slice(positions[i], positions[i + 1]);

    // h2 → a[href] → title text
    const linkMatch = chunk.match(/<h2[^>]*>[\s\S]*?<a [^>]*href="([^"]+)"[^>]*>([\s\S]+?)<\/a>/);
    if (!linkMatch) continue;
    const rawHref = linkMatch[1].replace(/&amp;/g, '&');
    const title = stripTags(linkMatch[2]).trim();
    if (!title) continue;

    // Bing wraps the real URL in a ck/a redirect with `u=a1<base64url>`
    let url = rawHref;
    const u = rawHref.match(/[?&]u=a1([A-Za-z0-9_-]+)/);
    if (u) {
      try {
        url = Buffer.from(u[1], 'base64url').toString('utf-8');
      } catch { /* fall back to raw */ }
    }

    // Snippet: first <p> inside the block. Prefer b_algoSlug / b_lineclampN.
    const snip = chunk.match(/<p[^>]*class="[^"]*b_(?:algoSlug|lineclamp\d)[^"]*"[^>]*>([\s\S]+?)<\/p>/)
      ?? chunk.match(/<p[^>]*>([\s\S]+?)<\/p>/);
    const snippet = snip ? stripTags(snip[1]).trim() : '';

    results.push({ title, url, snippet, source: 'bing' });
  }
  return results;
}

function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#?\w+;/g, ' ')
    .replace(/\s+/g, ' ');
}

// ─────────────────────────────────────────────────────────────────────────────
// Auto-selector
// ─────────────────────────────────────────────────────────────────────────────
export function pickSearchProvider(env: NodeJS.ProcessEnv = process.env): SearchProvider {
  if (env.TAVILY_API_KEY) return new TavilyProvider(env.TAVILY_API_KEY);
  if (env.SERPER_API_KEY) return new SerperProvider(env.SERPER_API_KEY);
  if (env.BRAVE_API_KEY) return new BraveProvider(env.BRAVE_API_KEY);
  return new BingProvider();
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
      logger.warn(`[search] ${p.name} failed: ${(err as Error).message}; falling back to Bing`);
      if (p.name === 'bing') throw err;
      return await new BingProvider().search(query, opts);
    }
  }
}
