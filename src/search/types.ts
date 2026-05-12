/**
 * Web-search provider abstraction.
 *
 * Implementations:
 *  - tavily   (TAVILY_API_KEY)   — LLM-focused, free tier, best quality
 *  - brave    (BRAVE_API_KEY)    — Brave Search API
 *  - serper   (SERPER_API_KEY)   — Google search via serper.dev
 *  - duckduckgo (no key)         — free, instant answers + Wikipedia, limited
 *
 * Auto-selection at boot: first provider with a usable env var wins;
 * duckduckgo is the always-available fallback.
 */
export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  /** ISO-8601 if the source carries a date; else undefined. */
  publishedAt?: string;
  /** Free-form source label (the engine that returned it). */
  source?: string;
}

export interface SearchOptions {
  maxResults?: number;
  /** Only return results younger than this many days. Best-effort — not all providers support. */
  freshDays?: number;
  /** "zh" / "en" hint. */
  lang?: string;
}

export interface SearchProvider {
  readonly name: string;
  search(query: string, opts?: SearchOptions): Promise<SearchResult[]>;
}
