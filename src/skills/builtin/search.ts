/**
 * /search skill — manual web search.
 *
 *   /search <query>             top 5 results, formatted as a list
 *   /search -n 10 <query>       custom result count
 *   /search -fresh 7 <query>    only results from last N days (provider-dependent)
 */
import type { Skill } from '../registry.js';
import type { ChatRequest, ChatResponse } from '../../core/types.js';
import type { SearchProvider } from '../../search/types.js';
import { logger } from '../../utils/logger.js';

function parse(text: string): { n: number; freshDays?: number; query: string } {
  const tokens = text.split(/\s+/);
  let n = 5;
  let freshDays: number | undefined;
  const rest: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if ((t === '-n' || t === '--n') && /^\d+$/.test(tokens[i + 1] || '')) { n = parseInt(tokens[++i], 10); continue; }
    if ((t === '-fresh' || t === '--fresh') && /^\d+$/.test(tokens[i + 1] || '')) { freshDays = parseInt(tokens[++i], 10); continue; }
    rest.push(t);
  }
  return { n: Math.min(n, 10), freshDays, query: rest.join(' ').trim() };
}

function detectLang(s: string): 'zh' | 'en' {
  return /[一-鿿]/.test(s) ? 'zh' : 'en';
}

export function createSearchSkill(provider: SearchProvider): Skill {
  return {
    name: 'search',
    description: '网页搜索. /search <关键词>',
    async execute(request: ChatRequest): Promise<ChatResponse> {
      const text = request.text?.trim() || '';
      if (!text) return { text: '用法：/search <关键词>\n例如：/search 深圳 2026 房价' };
      const { n, freshDays, query } = parse(text);
      if (!query) return { text: '⚠️ 缺少查询关键词' };

      try {
        logger.info(`[search] "${query}" via ${provider.name} (n=${n}, fresh=${freshDays ?? '-'})`);
        const results = await provider.search(query, { maxResults: n, freshDays, lang: detectLang(query) });
        if (results.length === 0) return { text: `🔍 没找到 "${query}" 的结果` };
        const lines = results.map((r, i) => {
          const dateBadge = r.publishedAt ? ` · ${r.publishedAt}` : '';
          return `**${i + 1}. ${r.title}**${dateBadge}\n${r.snippet}\n🔗 ${r.url}`;
        });
        return { text: `🔍 **${query}** (${provider.name})\n\n${lines.join('\n\n')}` };
      } catch (err) {
        return { text: `⚠️ 搜索失败：${(err as Error).message}` };
      }
    },
  };
}
