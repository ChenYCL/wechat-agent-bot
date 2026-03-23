/**
 * Message router - dispatches chat requests to the active provider,
 * with optional skill/MCP tool augmentation.
 */
import type { Agent, ChatRequest, ChatResponse } from './types.js';
import { ProviderRegistry } from '../providers/registry.js';
import { SkillRegistry } from '../skills/registry.js';
import type { MemoryManager } from '../skills/builtin/memory.js';
import { getLangPreference } from '../skills/builtin/lang.js';
import { logger } from '../utils/logger.js';

export class MessageRouter implements Agent {
  private providerRegistry: ProviderRegistry;
  private skillRegistry: SkillRegistry;
  private memoryManager: MemoryManager | null;
  private prompted = new Set<string>(); // track conversations that got the lang prompt

  constructor(
    providerRegistry: ProviderRegistry,
    skillRegistry: SkillRegistry,
    memoryManager?: MemoryManager,
  ) {
    this.providerRegistry = providerRegistry;
    this.skillRegistry = skillRegistry;
    this.memoryManager = memoryManager ?? null;
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const text = request.text?.trim() ?? '';

    // Check for slash commands (skills)
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

    // First message: check if language preference is set
    if (this.memoryManager && !this.prompted.has(request.conversationId)) {
      this.prompted.add(request.conversationId);
      const lang = await getLangPreference(this.memoryManager, request.conversationId);
      if (!lang) {
        // No lang set — remind once, then continue processing the message normally
        const reminder = '💡 提示：发送 /lang 中文 可设置回复语言偏好\n━━━━━━━━━━\n';
        const reply = await this.routeToProvider(request);
        return { ...reply, text: reply.text ? `${reminder}${reply.text}` : reminder };
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
      // Build context: memory + language preference
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
      // User-friendly error — hide internal details
      const friendly = this.friendlyError(rawMsg);
      return { text: `⚠️ AI 暂时无法回复\n\n${friendly}\n\n💡 可尝试:\n• /model list 切换其他模型\n• 稍后重试` };
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
