/**
 * LLM-facing `web_search` tool. Composed into the provider tool-bridge
 * stack so any active model (with tool-calling enabled) can pull fresh
 * web results mid-conversation — no need for the user to type /search.
 *
 * Result snippets are returned to the model as compact JSON; the model
 * is expected to synthesise them into the final reply.
 */
import type { ToolBridge, ToolContext, ToolDescriptor } from '../providers/base.js';
import type { SearchProvider } from './types.js';
import { logger } from '../utils/logger.js';

const TOOL: ToolDescriptor = {
  name: 'web_search',
  description: [
    'Search the live web. Use this whenever the user asks about events, prices,',
    'news, statistics, schedules or anything time-sensitive that may have changed',
    'since your training cutoff. Returns titles, snippets, URLs, and dates.',
    'Synthesize the snippets into your reply; cite URLs when appropriate.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      query: { type: 'string', description: 'The search query. Use the user\'s language. Be specific.' },
      max_results: { type: 'integer', minimum: 1, maximum: 10, description: 'Default 5.' },
      fresh_days: { type: 'integer', minimum: 1, description: 'Only return results younger than this many days; use for fast-moving topics like news / prices.' },
    },
    required: ['query'],
  },
};

function str(v: unknown): string { return typeof v === 'string' ? v : ''; }
function num(v: unknown, fallback?: number): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && /^\d+$/.test(v)) return parseInt(v, 10);
  return fallback;
}

export function createSearchToolBridge(provider: SearchProvider): ToolBridge {
  return {
    listTools(): ToolDescriptor[] {
      return [TOOL];
    },
    async callTool(name: string, args: Record<string, unknown>, _ctx?: ToolContext): Promise<unknown> {
      if (name !== 'web_search') throw new Error(`Unknown search tool: ${name}`);
      const query = str(args.query).trim();
      if (!query) return { error: 'query is required' };
      const maxResults = num(args.max_results, 5);
      const freshDays = num(args.fresh_days);
      try {
        const results = await provider.search(query, { maxResults, freshDays });
        return {
          provider: provider.name,
          query,
          results: results.map((r) => ({
            title: r.title,
            url: r.url,
            snippet: r.snippet,
            published_at: r.publishedAt,
          })),
        };
      } catch (err) {
        logger.warn(`[tool web_search] failed: ${(err as Error).message}`);
        return { error: (err as Error).message };
      }
    },
  };
}
