/**
 * Core type definitions for the WeChat Agent Bot.
 * Compatible with weixin-agent-sdk's Agent interface.
 */

export type MediaType = 'image' | 'audio' | 'video' | 'file';

export interface ChatMedia {
  type: MediaType;
  url?: string;
  filePath?: string;
  mimeType?: string;
  filename?: string;
}

export interface ChatRequest {
  conversationId: string;
  text?: string;
  media?: ChatMedia;
}

export interface ChatResponse {
  text?: string;
  media?: {
    type: 'image' | 'video' | 'file';
    url: string;
    fileName?: string;
  };
}

export interface Agent {
  chat(request: ChatRequest): Promise<ChatResponse>;
  clearSession?(conversationId: string): Promise<void>;
}

export interface BotOptions {
  account?: string;
  apiBaseUrl?: string;
  onLog?: (msg: string) => void;
  signal?: AbortSignal;
}

export interface ModelConfig {
  id: string;
  name: string;
  provider: string;
  model: string;
  apiKey: string;
  baseUrl?: string;
  systemPrompt?: string;
  maxHistory?: number;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  extra?: Record<string, unknown>;
}

export interface ScheduledTask {
  id: string;
  name: string;
  cron: string;
  enabled: boolean;
  type: string;
  config: Record<string, unknown>;
  targetConversations?: string[];
}

export interface AppConfig {
  server: {
    port: number;
    host: string;
  };
  defaultProvider: string;
  models: ModelConfig[];
  scheduledTasks: ScheduledTask[];
  skills: string[];
  mcpServers: McpServerConfig[];
}

export interface McpServerConfig {
  id: string;
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled: boolean;
}
