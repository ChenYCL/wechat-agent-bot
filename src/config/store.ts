/**
 * JSON file-based configuration persistence.
 * Stores all app config in data/config.json.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { AppConfig, ModelConfig, ScheduledTask, McpServerConfig } from '../core/types.js';
import { logger } from '../utils/logger.js';

/** Strip __proto__ and constructor keys to prevent prototype pollution. */
function stripProto<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

const DEFAULT_CONFIG: AppConfig = {
  server: {
    port: parseInt(process.env.PORT || '3210', 10),
    host: process.env.HOST || '127.0.0.1',
  },
  defaultProvider: process.env.DEFAULT_PROVIDER || 'openai',
  models: [],
  scheduledTasks: [],
  skills: [],
  mcpServers: [],
};

export class ConfigStore {
  private configPath: string;
  private config: AppConfig;

  constructor(dataDir?: string) {
    const dir = dataDir || join(process.cwd(), 'data');
    this.configPath = join(dir, 'config.json');
    this.config = { ...DEFAULT_CONFIG };
  }

  async load(): Promise<AppConfig> {
    try {
      if (existsSync(this.configPath)) {
        const raw = await readFile(this.configPath, 'utf-8');
        this.config = { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
        logger.info(`Config loaded from ${this.configPath}`);
      } else {
        // Try loading from config.example.json template
        const templatePath = join(process.cwd(), 'config.example.json');
        if (existsSync(templatePath)) {
          const raw = await readFile(templatePath, 'utf-8');
          this.config = { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
          logger.info('Config loaded from config.example.json template');
        } else {
          logger.info('No config file found, using defaults');
        }
        await this.initFromEnv();
      }
    } catch (err) {
      logger.error(`Failed to load config: ${(err as Error).message}`);
    }
    return this.config;
  }

  async save(): Promise<void> {
    const dir = dirname(this.configPath);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
    await writeFile(this.configPath, JSON.stringify(this.config, null, 2), { encoding: 'utf-8', mode: 0o600 });
    logger.info('Config saved');
  }

  get(): AppConfig {
    return this.config;
  }

  update(partial: Partial<AppConfig>): void {
    const safe = stripProto(partial);
    Object.assign(this.config, safe);
  }

  // Model CRUD
  addModel(model: ModelConfig): void {
    this.config.models.push(stripProto(model));
  }

  updateModel(id: string, updates: Partial<ModelConfig>): void {
    const idx = this.config.models.findIndex((m) => m.id === id);
    if (idx >= 0) Object.assign(this.config.models[idx], stripProto(updates));
  }

  removeModel(id: string): void {
    this.config.models = this.config.models.filter((m) => m.id !== id);
  }

  // ScheduledTask CRUD
  addTask(task: ScheduledTask): void {
    this.config.scheduledTasks.push(stripProto(task));
  }

  updateTask(id: string, updates: Partial<ScheduledTask>): void {
    const idx = this.config.scheduledTasks.findIndex((t) => t.id === id);
    if (idx >= 0) Object.assign(this.config.scheduledTasks[idx], stripProto(updates));
  }

  removeTask(id: string): void {
    this.config.scheduledTasks = this.config.scheduledTasks.filter((t) => t.id !== id);
  }

  // MCP Server CRUD
  addMcpServer(server: McpServerConfig): void {
    this.config.mcpServers.push(server);
  }

  removeMcpServer(id: string): void {
    this.config.mcpServers = this.config.mcpServers.filter((s) => s.id !== id);
  }

  private async initFromEnv(): Promise<void> {
    // Auto-create models from env vars
    if (process.env.OPENAI_API_KEY) {
      this.config.models.push({
        id: 'openai-default',
        name: 'OpenAI Default',
        provider: 'openai',
        model: process.env.OPENAI_MODEL || 'gpt-4o',
        apiKey: process.env.OPENAI_API_KEY,
        baseUrl: process.env.OPENAI_BASE_URL,
        systemPrompt: process.env.SYSTEM_PROMPT,
      });
    }
    if (process.env.ANTHROPIC_API_KEY) {
      this.config.models.push({
        id: 'anthropic-default',
        name: 'Anthropic Default',
        provider: 'anthropic',
        model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
        apiKey: process.env.ANTHROPIC_API_KEY,
        baseUrl: process.env.ANTHROPIC_BASE_URL,
        systemPrompt: process.env.SYSTEM_PROMPT,
      });
    }
  }
}
