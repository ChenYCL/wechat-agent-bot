/**
 * Adapter that exposes MCP tools through the provider-facing ToolBridge
 * interface. Providers depend only on ToolBridge, not McpClient, so unit
 * tests can swap in mocks freely.
 */
import type { ToolBridge, ToolDescriptor } from '../providers/base.js';
import type { McpClient } from './client.js';

export function createMcpToolBridge(client: McpClient): ToolBridge {
  return {
    listTools(): ToolDescriptor[] {
      return client.getAvailableTools().map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      }));
    },
    async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
      return await client.callTool(name, args);
    },
  };
}
