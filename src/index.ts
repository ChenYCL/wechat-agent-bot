/**
 * WeChat Agent Bot - Main Entry Point
 *
 * Bootstraps all modules: config, providers, scheduler, MCP, skills,
 * API server, and the WeChat bot message loop.
 */
import 'dotenv/config';
import { ConfigStore } from './config/store.js';
import { ProviderRegistry } from './providers/registry.js';
import { SchedulerManager } from './scheduler/manager.js';
import { McpClient } from './mcp/client.js';
import { SkillRegistry } from './skills/registry.js';
import { MessageRouter } from './core/router.js';
import { WeChatBot } from './core/bot.js';
import { startServer } from './server/index.js';
import { createHelpSkill } from './skills/builtin/help.js';
import { createModelSkill } from './skills/builtin/model.js';
import { createClearSkill } from './skills/builtin/clear.js';
import { MemoryManager, createRememberSkill, createRecallSkill, createForgetSkill } from './skills/builtin/memory.js';
import { createImageSkill } from './skills/builtin/image.js';
import { createWeatherSkill } from './skills/builtin/weather.js';
import { createTranslateSkill } from './skills/builtin/translate.js';
import { createSummarySkill } from './skills/builtin/summary.js';
import { createReportHandler } from './scheduler/tasks/report.js';
import { HistoryStore } from './utils/history-store.js';
import { logger } from './utils/logger.js';
import { join } from 'node:path';

async function main() {
  logger.info('WeChat Agent Bot starting...');

  // 1. Load config
  const config = new ConfigStore();
  const appConfig = await config.load();

  // 2. Initialize persistent history store
  const dataDir = join(process.cwd(), 'data');
  const historyStore = new HistoryStore(dataDir);
  await historyStore.init();
  logger.info('Conversation history store initialized (persistent, 7-day TTL)');

  // 3. Initialize provider registry
  const providers = new ProviderRegistry();
  providers.setHistoryStore(historyStore);
  for (const modelConfig of appConfig.models) {
    try {
      providers.addProvider(modelConfig);
    } catch (err) {
      logger.error(`Failed to register provider ${modelConfig.id}: ${(err as Error).message}`);
    }
  }

  // 3. Initialize scheduler
  const scheduler = new SchedulerManager();
  scheduler.registerHandler('report', createReportHandler(() => providers.getActive()));

  // 4. Initialize MCP
  const mcp = new McpClient();
  for (const serverConfig of appConfig.mcpServers) {
    try {
      await mcp.connect(serverConfig);
    } catch (err) {
      logger.error(`Failed to connect MCP server ${serverConfig.name}: ${(err as Error).message}`);
    }
  }

  // 5. Initialize memory manager
  const memoryManager = new MemoryManager(dataDir);
  await memoryManager.init();
  logger.info('Memory manager initialized (persistent)');

  // 6. Initialize skills
  const skills = new SkillRegistry();
  skills.register(createHelpSkill(() => skills.getAll()));
  skills.register(createModelSkill(providers));
  skills.register(createClearSkill(providers));
  skills.register(createImageSkill());
  skills.register(createWeatherSkill());
  skills.register(createTranslateSkill(providers));
  skills.register(createSummarySkill(providers));
  skills.register(createRememberSkill(memoryManager));
  skills.register(createRecallSkill(memoryManager));
  skills.register(createForgetSkill(memoryManager));

  // 7. Schedule tasks
  for (const task of appConfig.scheduledTasks) {
    scheduler.schedule(task);
  }

  // 8. Start API server (WebUI)
  await startServer({ config, providers, scheduler, mcp, skills });

  // 9. Start WeChat bot
  const router = new MessageRouter(providers, skills, memoryManager);
  const bot = new WeChatBot(router);

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down...');
    bot.stop();
    scheduler.cancelAll();
    await historyStore.close();
    await mcp.disconnectAll();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  try {
    await bot.login();
    await bot.start();
  } catch (err) {
    logger.error(`Bot failed: ${(err as Error).message}`);
    shutdown();
  }
}

main().catch((err) => {
  logger.error(`Fatal error: ${err}`);
  process.exit(1);
});
