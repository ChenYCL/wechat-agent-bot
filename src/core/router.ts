/**
 * Message router - dispatches chat requests to the active provider,
 * with optional skill/MCP tool augmentation, memory context, and
 * outbox flushing for scheduled-task deliveries.
 */
import type { Agent, ChatRequest, ChatResponse } from './types.js';
import { ProviderRegistry } from '../providers/registry.js';
import { SkillRegistry } from '../skills/registry.js';
import type { MemoryManager } from '../skills/builtin/memory.js';
import type { HistoryStore } from '../utils/history-store.js';
import { getLangPreference } from '../skills/builtin/lang.js';
import { logger } from '../utils/logger.js';

const LANG_PROMPTED_KEY = '_lang_prompted';

export class MessageRouter implements Agent {
  private providerRegistry: ProviderRegistry;
  private skillRegistry: SkillRegistry;
  private memoryManager: MemoryManager | null;
  private outbox: HistoryStore | null;

  constructor(
    providerRegistry: ProviderRegistry,
    skillRegistry: SkillRegistry,
    memoryManager?: MemoryManager,
    outbox?: HistoryStore,
  ) {
    this.providerRegistry = providerRegistry;
    this.skillRegistry = skillRegistry;
    this.memoryManager = memoryManager ?? null;
    this.outbox = outbox ?? null;
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    // First: flush any queued scheduled-task deliveries for this conversation.
    const queuedPrefix = await this.drainOutbox(request.conversationId);

    const reply = await this.handleInner(request);

    if (queuedPrefix) {
      return {
        ...reply,
        text: reply.text ? `${queuedPrefix}\n${reply.text}` : queuedPrefix,
      };
    }
    return reply;
  }

  private async handleInner(request: ChatRequest): Promise<ChatResponse> {
    const text = request.text?.trim() ?? '';

    // Slash commands → skills.
    if (text.startsWith('/')) {
      const spaceIdx = text.indexOf(' ');
      const cmd = spaceIdx > 0 ? text.slice(1, spaceIdx) : text.slice(1);
      const args = spaceIdx > 0 ? text.slice(spaceIdx + 1) : '';

      const skill = this.skillRegistry.get(cmd);
      if (skill) {
        logger.info(`Executing skill: ${cmd}`);
        return skill.execute({ ...request, text: args });
      }
    }

    // Language-preference one-time reminder (persisted, so we never re-prompt
    // after the user has been shown the hint, even across process restarts).
    if (this.memoryManager) {
      const lang = await getLangPreference(this.memoryManager, request.conversationId);
      if (!lang) {
        const promptedMem = await this.memoryManager.get(request.conversationId, LANG_PROMPTED_KEY);
        if (!promptedMem) {
          await this.memoryManager.set(request.conversationId, LANG_PROMPTED_KEY, '1');
          const reminder = '💡 提示：发送 /lang 中文 可设置回复语言偏好\n━━━━━━━━━━\n';
          const reply = await this.routeToProvider(request);
          return { ...reply, text: reply.text ? `${reminder}${reply.text}` : reminder };
        }
      }
    }

    return this.routeToProvider(request);
  }

  private async routeToProvider(request: ChatRequest): Promise<ChatResponse> {
    const provider = this.providerRegistry.getActive();
    if (!provider) {
      return { text: '⚠️ 未配置 AI 模型\n\n请通过 WebUI 配置模型，或发送 /model list 查看。' };
    }

    try {
      let contextPrefix = '';
      if (this.memoryManager) {
        const memCtx = await this.memoryManager.buildContext(request.conversationId);
        if (memCtx) contextPrefix += memCtx;

        const lang = await getLangPreference(this.memoryManager, request.conversationId);
        if (lang) {
          contextPrefix += `\n[IMPORTANT: Always reply in ${lang}. This is the user's language preference.]\n`;
        }
      }

      const enrichedRequest = contextPrefix && request.text
        ? { ...request, text: `${contextPrefix}\n${request.text}` }
        : request;

      return await provider.chat(enrichedRequest);
    } catch (err) {
      const rawMsg = (err as Error).message || 'Unknown error';
      logger.error(`Provider error: ${rawMsg}`);
      const friendly = this.friendlyError(rawMsg);
      return { text: `⚠️ AI 暂时无法回复\n\n${friendly}\n\n💡 可尝试:\n• /model list 切换其他模型\n• 稍后重试` };
    }
  }

  private async drainOutbox(conversationId: string): Promise<string> {
    if (!this.outbox) return '';
    try {
      const queued = this.outbox.drainOutbox(conversationId);
      if (queued.length === 0) return '';
      const parts = queued.map((q) => q.payload.text).filter((t): t is string => !!t);
      if (parts.length === 0) return '';
      logger.info(`[outbox] Delivered ${queued.length} queued message(s) to ${conversationId}`);
      return parts.join('\n\n━━━━━━━━━━\n\n');
    } catch (err) {
      logger.warn(`[outbox] Drain failed for ${conversationId}: ${(err as Error).message}`);
      return '';
    }
  }

  async clearSession(conversationId: string): Promise<void> {
    const provider = this.providerRegistry.getActive();
    if (provider?.clearSession) {
      await provider.clearSession(conversationId);
    }
  }

  private friendlyError(raw: string): string {
    if (raw.includes('额度') || raw.includes('quota') || raw.includes('insufficient'))
      return '🔑 API 额度已用尽，请充值或更换 Key';
    if (raw.includes('401') || raw.includes('auth') || raw.includes('Unauthorized'))
      return '🔑 API Key 无效或已过期';
    if (raw.includes('429') || raw.includes('rate'))
      return '⏳ 请求过于频繁，请稍后再试';
    if (raw.includes('timeout') || raw.includes('ETIMEDOUT'))
      return '⏳ 请求超时，网络可能不稳定';
    if (raw.includes('ECONNREFUSED') || raw.includes('ENOTFOUND'))
      return '🌐 无法连接到 AI 服务，请检查网络';
    if (raw.includes('500') || raw.includes('502') || raw.includes('503'))
      return '🔧 AI 服务暂时不可用';
    return '出了点问题，请稍后重试';
  }
}
