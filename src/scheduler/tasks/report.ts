/**
 * Built-in scheduled task: research-report / daily-summary generator.
 *
 * Each run asks the active provider to generate content for `config.topic`
 * and enqueues the result into the outbox for every target conversation.
 * The bot's router flushes the outbox on the next inbound message from
 * that conversation, so the user always sees the queued content.
 */
import type { ScheduledTask } from '../../core/types.js';
import type { BaseProvider } from '../../providers/base.js';
import type { HistoryStore } from '../../utils/history-store.js';
import { logger } from '../../utils/logger.js';

export interface ReportTaskConfig {
  topic: string;
  provider?: string;
  prompt?: string;
}

export interface ReportHandlerDeps {
  getProvider: () => BaseProvider | null;
  outbox?: HistoryStore;
  /** Optional immediate sender. If provided, it's tried first; outbox is fallback. */
  send?: (conversationId: string, content: { text?: string }) => Promise<boolean>;
}

export function createReportHandler(deps: ReportHandlerDeps | (() => BaseProvider | null)) {
  // Back-compat: accept the old function-only form for tests.
  const opts: ReportHandlerDeps = typeof deps === 'function' ? { getProvider: deps } : deps;

  return async (task: ScheduledTask): Promise<void> => {
    const config = task.config as unknown as ReportTaskConfig;
    const provider = opts.getProvider();

    if (!provider) {
      logger.warn(`[report] No provider available for task "${task.name}"`);
      return;
    }

    const prompt = config.prompt
      ?? `Please generate a brief research report about: ${config.topic}. Include key developments, trends, and insights.`;

    const response = await provider.chat({
      conversationId: `__scheduled__${task.id}`,
      text: prompt,
      disableTools: true,
    });

    const replyText = response.text?.trim() ?? '';
    if (!replyText) {
      logger.warn(`[report] Empty reply for task "${task.name}"`);
      return;
    }

    logger.info(`[report] Generated for "${config.topic}" (${replyText.length} chars)`);

    const targets = task.targetConversations ?? [];
    if (targets.length === 0) {
      logger.warn(`[report] Task "${task.name}" has no targetConversations — nothing to deliver`);
      return;
    }

    const header = `📰 ${task.name}\n━━━━━━━━━━\n`;
    const payload = { text: `${header}${replyText}` };

    for (const conv of targets) {
      let delivered = false;
      if (opts.send) {
        try {
          delivered = await opts.send(conv, payload);
        } catch (err) {
          logger.warn(`[report] Direct send failed for ${conv}: ${(err as Error).message}`);
        }
      }
      if (!delivered && opts.outbox) {
        opts.outbox.enqueueOutbox(conv, payload, `task:${task.id}`);
        logger.info(`[report] Queued for ${conv} (will deliver on next inbound)`);
      } else if (delivered) {
        logger.info(`[report] Delivered to ${conv}`);
      } else {
        logger.warn(`[report] No delivery path available for ${conv}`);
      }
    }
  };
}
