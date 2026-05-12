/**
 * First-boot migration:
 *
 * - If no users exist yet, create an `admin` user with either the
 *   `ADMIN_USERNAME` / `ADMIN_PASSWORD` env vars, or a random
 *   password that we print to the log exactly once.
 * - If `config.json` carries any model configs, move them into the
 *   admin's `user_models` so they keep working without manual setup.
 * - Idempotent on subsequent boots.
 */
import { randomBytes } from 'node:crypto';
import type { AuthStore, User } from '../auth/store.js';
import type { UserProviderManager } from '../accounts/provider-manager.js';
import type { AppConfig } from '../core/types.js';
import { logger } from '../utils/logger.js';

export interface MigrationResult {
  admin: User | null;
  createdAdmin: boolean;
  migratedModels: number;
  generatedPassword?: string;
}

export function bootstrapAdminIfNeeded(
  auth: AuthStore,
  userProviders: UserProviderManager,
  appConfig: AppConfig,
): MigrationResult {
  if (auth.countUsers() > 0) {
    return { admin: null, createdAdmin: false, migratedModels: 0 };
  }

  const username = (process.env.ADMIN_USERNAME || 'admin').trim();
  const envPassword = process.env.ADMIN_PASSWORD;
  const password = envPassword && envPassword.length >= 8
    ? envPassword
    : randomBytes(9).toString('base64url'); // 12 chars, URL-safe

  const admin = auth.signup(username, password, { isAdmin: true });
  if (!admin) throw new Error(`Failed to bootstrap admin user: username "${username}" conflict`);

  let migrated = 0;
  if (appConfig.models?.length) {
    let firstId: string | undefined;
    for (const model of appConfig.models) {
      // Skip placeholder rows from config.example.json — anything without
      // an API key is unusable and would only cause 401s downstream.
      if (!model.apiKey || model.apiKey.trim() === '') {
        logger.info(`[migrate] skipping ${model.id} (no API key)`);
        continue;
      }
      try {
        const stored = userProviders.addModel(admin.id, { ...model, isActive: false });
        if (!firstId) firstId = stored.id;
        migrated++;
      } catch (err) {
        logger.error(`[migrate] failed to migrate model ${model.id}: ${(err as Error).message}`);
      }
    }
    if (firstId) userProviders.setActive(admin.id, firstId);
  }

  logger.warn('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  logger.warn(`First boot — created admin user`);
  logger.warn(`  username: ${admin.username}`);
  if (!envPassword) {
    logger.warn(`  password: ${password}`);
    logger.warn(`  ⚠️  Save this password now — it won't be shown again.`);
    logger.warn(`  💡 Or pre-set ADMIN_PASSWORD env var to control it.`);
  } else {
    logger.warn(`  password: (from ADMIN_PASSWORD env)`);
  }
  if (migrated > 0) {
    logger.warn(`Migrated ${migrated} model(s) from config.json into admin's account.`);
  }
  logger.warn('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  return {
    admin,
    createdAdmin: true,
    migratedModels: migrated,
    generatedPassword: envPassword ? undefined : password,
  };
}
