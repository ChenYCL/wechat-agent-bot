/**
 * WeChat Agent Bot - Main Entry Point
 *
 * Multi-tenant: each app user owns their own WeChat accounts, model
 * configs and tasks. A single Node process runs N WeChat long-polls,
 * one per active account. All storage is in `data/bot.db`, with rows
 * scoped by `accountId::rawConversationId` so accounts don't cross-talk.
 *
 * On first boot we create an `admin` user (random password printed once,
 * or `ADMIN_USERNAME`/`ADMIN_PASSWORD` env) and migrate any models in
 * `config.json` into that admin's account.
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
import { createTaskSkill } from './skills/builtin/task.js';
import { createReportHandler } from './scheduler/tasks/report.js';
import { UserTaskManager } from './tasks/manager.js';
import { fromUserProviders } from './skills/provider-access.js';
import { HistoryStore } from './utils/history-store.js';
import { AuthStore } from './auth/store.js';
import { WeChatAccountStore } from './accounts/store.js';
import { UserProviderManager } from './accounts/provider-manager.js';
import { ContextResolver } from './accounts/context.js';
import { MultiAccountBot } from './accounts/multi-bot.js';
import { bootstrapAdminIfNeeded } from './boot/migrate.js';
import { logger } from './utils/logger.js';
import { join } from 'node:path';

async function main() {
  logger.info('WeChat Agent Bot starting...');

  // 1. Load config (server port, MCP servers, scheduled tasks)
  const config = new ConfigStore();
  const appConfig = await config.load();

  // 2. Persistent SQLite store (history, memories, outbox, users, accounts, models, tasks)
  const dataDir = join(process.cwd(), 'data');
  const historyStore = new HistoryStore(dataDir);
  await historyStore.init();
  logger.info('SQLite database initialized (data/bot.db)');

  // 3. Auth + multi-tenant stores
  const auth = new AuthStore(historyStore);
  const accountsStore = new WeChatAccountStore(historyStore);
  const userProviders = new UserProviderManager(historyStore);
  bootstrapAdminIfNeeded(auth, userProviders, appConfig);

  // 4. Memory manager (conversation-keyed; works for both single & multi-tenant)
  const memoryManager = new MemoryManager(historyStore);
  await memoryManager.init();
  logger.info('Memory manager initialized');

  // 5. Scheduler (timezone-aware + telemetry)
  const scheduler = new SchedulerManager({ store: historyStore });

  // Proactive push via the SDK's Bot.sendMessage (uses cached
  // context_token from the most recent inbound; valid ~24h).
  // Returns true on success so handlers skip outbox queueing.
  const wechatPush = async (scopedConv: string, content: { text?: string }): Promise<boolean> => {
    if (process.env.WECHAT_PUSH === '0') return false;
    return multiBot.send(scopedConv, content);
  };

  // The legacy `report` task expects a single global provider — wire it to
  // the admin's active model so server-wide scheduled reports still work.
  scheduler.registerHandler(
    'report',
    createReportHandler({
      getProvider: () => {
        const adminId = firstAdminId(auth);
        return adminId ? userProviders.getActive(adminId) : null;
      },
      outbox: historyStore,
      send: async (conv, content) => wechatPush(conv, content),
    }),
  );

  // 6. User-task manager (per-conversation reminders & watches)
  const userTaskManager = new UserTaskManager({ store: historyStore, scheduler, deliver: wechatPush });
  userTaskManager.loadAll();

  // 7. MCP client + composite tool bridge wired into user providers
  const mcp = new McpClient();
  for (const serverConfig of appConfig.mcpServers) {
    try {
      await mcp.connect(serverConfig);
    } catch (err) {
      logger.error(`Failed to connect MCP server ${serverConfig.name}: ${(err as Error).message}`);
    }
  }
  userProviders.setToolBridge(composeToolBridges(
    createMcpToolBridge(mcp),
    createUserTaskToolBridge(userTaskManager),
  ));

  // 8. Skill registry (built-in + user-loaded)
  const contextResolver = new ContextResolver(accountsStore);
  const providerAccess = fromUserProviders(userProviders, contextResolver);
  const skills = new SkillRegistry();
  skills.register(createHelpSkill(() => skills.getAll()));
  skills.register(createModelSkill(providerAccess));
  skills.register(createClearSkill(providerAccess));
  skills.register(createLangSkill(memoryManager));
  skills.register(createImageSkill(providerAccess));
  skills.register(createWeatherSkill());
  skills.register(createTranslateSkill(providerAccess));
  skills.register(createSummarySkill(providerAccess));
  skills.register(createRememberSkill(memoryManager));
  skills.register(createRecallSkill(memoryManager));
  skills.register(createForgetSkill(memoryManager));
  skills.register(createTaskSkill({ manager: userTaskManager, providers: providerAccess, memory: memoryManager }));

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

  // 10. Build the router (per-user model resolution) and the multi-account bot
  const router = new MessageRouter(providerAccess, skills, memoryManager, historyStore);
  const multiBot = new MultiAccountBot(router, accountsStore);

  // 11. Start the HTTP/WebUI server (auth + multi-tenant + legacy routes)
  // Pass a dummy legacy ProviderRegistry — required by old single-tenant
  // /api/models routes; safe to leave empty when no admin tokens use them.
  const legacyRegistry = new ProviderRegistry();
  legacyRegistry.setHistoryStore(historyStore);
  await startServer({
    config,
    providers: legacyRegistry,
    scheduler,
    mcp,
    skills,
    userTasks: userTaskManager,
    auth,
    wechatAccounts: accountsStore,
    multiBot,
    userProviders,
  });

  // 12. Boot one bot loop per active WeChat account
  await multiBot.startAll();
  if (multiBot.listRunning().length === 0) {
    logger.info('No WeChat accounts linked yet. Open the WebUI to scan a QR code.');
  }

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down...');
    await multiBot.stopAll();
    scheduler.cancelAll();
    await historyStore.close();
    await mcp.disconnectAll();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

function firstAdminId(auth: AuthStore): string | null {
  const all = auth.listUsers();
  return all.find((u) => u.isAdmin)?.id ?? all[0]?.id ?? null;
}

main().catch((err) => {
  logger.error(`Fatal error: ${err}`);
  process.exit(1);
});
