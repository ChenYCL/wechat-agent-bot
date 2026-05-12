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
import { createMcpToolBridge } from './mcp/tool-bridge.js';
import { composeToolBridges } from './providers/composite-bridge.js';
import { createUserTaskToolBridge } from './tasks/tool-bridge.js';
import { SkillRegistry } from './skills/registry.js';
import { loadSkillsFromDir } from './skills/loader.js';
import { MessageRouter } from './core/router.js';
import { WeChatBot } from './core/bot.js';
import { startServer } from './server/index.js';
import { createHelpSkill } from './skills/builtin/help.js';
import { createModelSkill } from './skills/builtin/model.js';
import { createClearSkill } from './skills/builtin/clear.js';
import { MemoryManager, createRememberSkill, createRecallSkill, createForgetSkill } from './skills/builtin/memory.js';
import { createLangSkill } from './skills/builtin/lang.js';
import { createImageSkill } from './skills/builtin/image.js';
import { createWeatherSkill } from './skills/builtin/weather.js';
import { createTranslateSkill } from './skills/builtin/translate.js';
import { createSummarySkill } from './skills/builtin/summary.js';
import { createReportHandler } from './scheduler/tasks/report.js';
import { UserTaskManager } from './tasks/manager.js';
import { createTaskSkill } from './skills/builtin/task.js';
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
  logger.info('SQLite database initialized (data/bot.db)');

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

  // 4. Initialize scheduler (timezone-aware, with run telemetry)
  const scheduler = new SchedulerManager({ store: historyStore });
  scheduler.registerHandler(
    'report',
    createReportHandler({
      getProvider: () => providers.getActive(),
      outbox: historyStore,
    }),
  );

  // 5. Initialize MCP and wire it as the provider tool bridge
  const mcp = new McpClient();
  for (const serverConfig of appConfig.mcpServers) {
    try {
      await mcp.connect(serverConfig);
    } catch (err) {
      logger.error(`Failed to connect MCP server ${serverConfig.name}: ${(err as Error).message}`);
    }
  }
  // 6. Initialize memory manager (shares SQLite DB with history store)
  const memoryManager = new MemoryManager(historyStore);
  await memoryManager.init();
  logger.info('Memory manager initialized (SQLite, permanent)');

  // 7. Initialize user-task manager (NL-driven reminders & watches)
  const userTaskManager = new UserTaskManager({ store: historyStore, scheduler });
  userTaskManager.loadAll();

  // Wire the composite tool bridge: MCP tools + user-task tools.
  // Providers can now invoke task creation/listing during normal chat.
  providers.setToolBridge(composeToolBridges(
    createMcpToolBridge(mcp),
    createUserTaskToolBridge(userTaskManager),
  ));

  // 8. Initialize skills (builtin + auto-loaded from data/skills/)
  const skills = new SkillRegistry();
  skills.register(createHelpSkill(() => skills.getAll()));
  skills.register(createModelSkill(providers));
  skills.register(createClearSkill(providers));
  skills.register(createLangSkill(memoryManager));
  skills.register(createImageSkill());
  skills.register(createWeatherSkill());
  skills.register(createTranslateSkill(providers));
  skills.register(createSummarySkill(providers));
  skills.register(createRememberSkill(memoryManager));
  skills.register(createRecallSkill(memoryManager));
  skills.register(createForgetSkill(memoryManager));
  skills.register(createTaskSkill({ manager: userTaskManager, providers, memory: memoryManager }));

  try {
    const userSkills = await loadSkillsFromDir(join(dataDir, 'skills'));
    for (const skill of userSkills) {
      skills.register(skill);
    }
    if (userSkills.length > 0) {
      logger.info(`Loaded ${userSkills.length} user skill(s) from data/skills/`);
    }
  } catch (err) {
    logger.warn(`Failed to auto-load user skills: ${(err as Error).message}`);
  }

  // 9. Schedule admin (config-defined) tasks
  for (const task of appConfig.scheduledTasks) {
    scheduler.schedule(task);
  }

  // 10. Start API server (WebUI)
  await startServer({ config, providers, scheduler, mcp, skills, userTasks: userTaskManager });

  // 11. Start WeChat bot (with outbox flushing in the router)
  const router = new MessageRouter(providers, skills, memoryManager, historyStore);
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
