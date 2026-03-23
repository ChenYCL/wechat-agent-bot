/**
 * CLI entry for dry-run mode — test the full pipeline
 * without real WeChat connection.
 *
 * Usage: npm run dry-run
 */
import 'dotenv/config';
import { ConfigStore } from './config/store.js';
import { ProviderRegistry } from './providers/registry.js';
import { SkillRegistry } from './skills/registry.js';
import { MessageRouter } from './core/router.js';
import { DryRunBot } from './core/dry-run.js';
import { createHelpSkill } from './skills/builtin/help.js';
import { createModelSkill } from './skills/builtin/model.js';
import { createClearSkill } from './skills/builtin/clear.js';
import { logger } from './utils/logger.js';

async function main() {
  logger.info('Starting dry-run mode...');

  const config = new ConfigStore();
  const appConfig = await config.load();

  const providers = new ProviderRegistry();
  for (const modelConfig of appConfig.models) {
    try {
      providers.addProvider(modelConfig);
    } catch (err) {
      logger.error(`Failed to register provider ${modelConfig.id}: ${(err as Error).message}`);
    }
  }

  const skills = new SkillRegistry();
  skills.register(createHelpSkill(() => skills.getAll()));
  skills.register(createModelSkill(providers));
  skills.register(createClearSkill(providers));

  const router = new MessageRouter(providers, skills);
  const bot = new DryRunBot(router);

  await bot.interactive();
}

main().catch((err) => {
  logger.error(`Fatal: ${err}`);
  process.exit(1);
});
