/**
 * Per-user model configurations stored in SQLite (`user_models` table).
 * Each user holds their own set of providers + their own "active" model.
 * The legacy `config.json` lives on for global settings (server port,
 * MCP servers, scheduled tasks), but model configs move here so each
 * tenant has their own API keys.
 */
import { randomUUID } from 'node:crypto';
import type { HistoryStore } from '../utils/history-store.js';
import type { ModelConfig } from '../core/types.js';

export interface StoredUserModel extends ModelConfig {
  userId: string;
  isActive: boolean;
  createdAt: number;
}

export class UserModelStore {
  constructor(private store: HistoryStore) {}

  list(userId: string): StoredUserModel[] {
    const rows = this.store.rawDb.prepare(
      'SELECT * FROM user_models WHERE user_id = ? ORDER BY created_at ASC',
    ).all(userId) as any[];
    return rows.map(rowToModel);
  }

  get(userId: string, modelId: string): StoredUserModel | null {
    const row = this.store.rawDb.prepare(
      'SELECT * FROM user_models WHERE user_id = ? AND id = ?',
    ).get(userId, modelId) as any;
    return row ? rowToModel(row) : null;
  }

  insert(userId: string, config: Omit<ModelConfig, 'id'> & { id?: string; isActive?: boolean }): StoredUserModel {
    const id = config.id ?? randomUUID();
    this.store.rawDb.prepare(`
      INSERT INTO user_models (id, user_id, name, provider, model, api_key, base_url, system_prompt, max_history, temperature, max_tokens, stream, extra, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      userId,
      config.name,
      config.provider,
      config.model,
      config.apiKey,
      config.baseUrl ?? null,
      config.systemPrompt ?? null,
      config.maxHistory ?? null,
      config.temperature ?? null,
      config.maxTokens ?? null,
      config.stream === undefined ? null : (config.stream ? 1 : 0),
      config.extra ? JSON.stringify(config.extra) : null,
      config.isActive ? 1 : 0,
    );
    return this.get(userId, id)!;
  }

  update(userId: string, modelId: string, patch: Partial<ModelConfig>): StoredUserModel | null {
    const existing = this.get(userId, modelId);
    if (!existing) return null;

    const fields: string[] = [];
    const args: any[] = [];
    const m = (col: string, key: keyof ModelConfig, transform?: (v: any) => any) => {
      if (key in patch) {
        fields.push(`${col} = ?`);
        const v = (patch as any)[key];
        args.push(v === undefined ? null : transform ? transform(v) : v);
      }
    };
    m('name', 'name');
    m('provider', 'provider');
    m('model', 'model');
    m('api_key', 'apiKey');
    m('base_url', 'baseUrl');
    m('system_prompt', 'systemPrompt');
    m('max_history', 'maxHistory');
    m('temperature', 'temperature');
    m('max_tokens', 'maxTokens');
    if ('stream' in patch) {
      fields.push('stream = ?');
      args.push(patch.stream === undefined ? null : (patch.stream ? 1 : 0));
    }
    if ('extra' in patch) {
      fields.push('extra = ?');
      args.push(patch.extra ? JSON.stringify(patch.extra) : null);
    }
    if (fields.length === 0) return existing;

    args.push(userId, modelId);
    this.store.rawDb.prepare(
      `UPDATE user_models SET ${fields.join(', ')} WHERE user_id = ? AND id = ?`,
    ).run(...args);
    return this.get(userId, modelId);
  }

  delete(userId: string, modelId: string): boolean {
    return this.store.rawDb.prepare(
      'DELETE FROM user_models WHERE user_id = ? AND id = ?',
    ).run(userId, modelId).changes > 0;
  }

  /** Atomically mark exactly one model as active for the user. */
  setActive(userId: string, modelId: string): boolean {
    const tx = this.store.rawDb.transaction(() => {
      const result = this.store.rawDb.prepare(
        'UPDATE user_models SET is_active = (id = ?) WHERE user_id = ?',
      ).run(modelId, userId);
      return result.changes > 0;
    });
    return tx();
  }

  getActive(userId: string): StoredUserModel | null {
    const row = this.store.rawDb.prepare(
      'SELECT * FROM user_models WHERE user_id = ? AND is_active = 1 LIMIT 1',
    ).get(userId) as any;
    if (row) return rowToModel(row);
    // Fallback: first model for the user
    const fallback = this.store.rawDb.prepare(
      'SELECT * FROM user_models WHERE user_id = ? ORDER BY created_at ASC LIMIT 1',
    ).get(userId) as any;
    return fallback ? rowToModel(fallback) : null;
  }
}

function rowToModel(row: any): StoredUserModel {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    provider: row.provider,
    model: row.model,
    apiKey: row.api_key,
    baseUrl: row.base_url ?? undefined,
    systemPrompt: row.system_prompt ?? undefined,
    maxHistory: row.max_history ?? undefined,
    temperature: row.temperature ?? undefined,
    maxTokens: row.max_tokens ?? undefined,
    stream: row.stream === null ? undefined : row.stream === 1,
    extra: row.extra ? JSON.parse(row.extra) : undefined,
    isActive: row.is_active === 1,
    createdAt: row.created_at * 1000,
  };
}
