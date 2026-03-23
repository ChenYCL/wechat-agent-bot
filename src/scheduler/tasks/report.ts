/**
 * Built-in scheduled task: Research report generator.
 * Sends periodic AI-generated reports to configured conversations.
 */
import type { ScheduledTask } from '../../core/types.js';
import type { BaseProvider } from '../../providers/base.js';
import { logger } from '../../utils/logger.js';

export interface ReportTaskConfig {
  topic: string;
  provider?: string;
  prompt?: string;
}

export function createReportHandler(getProvider: () => BaseProvider | null) {
  return async (task: ScheduledTask): Promise<void> => {
    const config = task.config as unknown as ReportTaskConfig;
    const provider = getProvider();

    if (!provider) {
      logger.warn('No provider available for report task');
      return;
    }

    const prompt = config.prompt
      ?? `Please generate a brief research report about: ${config.topic}. Include key developments, trends, and insights.`;

    const response = await provider.chat({
      conversationId: `scheduled-${task.id}`,
      text: prompt,
    });

    logger.info(`Report generated for "${config.topic}": ${response.text?.slice(0, 100)}...`);

    // TODO: Send to target conversations via WeChat send API
    // This will be implemented when the send mechanism is integrated
  };
}
