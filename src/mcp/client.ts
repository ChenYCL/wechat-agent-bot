/**
 * MCP (Model Context Protocol) client - connects to MCP servers
 * and makes their tools available to the agent.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { McpServerConfig } from '../core/types.js';
import { logger } from '../utils/logger.js';

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  serverName: string;
}

export class McpClient {
  private clients = new Map<string, Client>();
  private tools = new Map<string, { client: Client; serverName: string }>();

  async connect(config: McpServerConfig): Promise<McpTool[]> {
    if (!config.enabled) return [];

    // Security: validate MCP command — only allow known safe commands
    const ALLOWED_COMMANDS = new Set(['npx', 'node', 'python3', 'python', 'uvx', 'deno']);
    const baseCmd = config.command.split('/').pop() ?? config.command;
    if (!ALLOWED_COMMANDS.has(baseCmd)) {
      throw new Error(`MCP command "${config.command}" is not in the allowed list: ${[...ALLOWED_COMMANDS].join(', ')}`);
    }
    if (config.command.includes('..') || config.command.includes(';') || config.command.includes('|')) {
      throw new Error('MCP command contains disallowed characters');
    }

    logger.info(`Connecting to MCP server: ${config.name}`);

    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: config.env as Record<string, string>,
    });

    const client = new Client({
      name: 'wechat-agent-bot',
      version: '0.1.0',
    });

    await client.connect(transport);
    this.clients.set(config.id, client);

    const { tools } = await client.listTools();
    const result: McpTool[] = [];

    for (const tool of tools) {
      this.tools.set(tool.name, { client, serverName: config.name });
      result.push({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema as Record<string, unknown>,
        serverName: config.name,
      });
    }

    logger.info(`Connected to ${config.name}, ${tools.length} tools available`);
    return result;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const entry = this.tools.get(name);
    if (!entry) throw new Error(`MCP tool not found: ${name}`);

    const result = await entry.client.callTool({ name, arguments: args });
    return result;
  }

  getAvailableTools(): McpTool[] {
    const result: McpTool[] = [];
    for (const [name, entry] of this.tools) {
      result.push({ name, serverName: entry.serverName });
    }
    return result;
  }

  async disconnectAll(): Promise<void> {
    for (const [id, client] of this.clients) {
      try {
        await client.close();
      } catch {
        // ignore disconnect errors
      }
      this.clients.delete(id);
    }
    this.tools.clear();
  }
}
