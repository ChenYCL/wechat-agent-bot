/**
 * Merge multiple ToolBridge implementations into one.
 *
 * `listTools()` concatenates the children. `callTool()` routes by tool
 * name: the first child that advertises a tool with that name owns the
 * call. Later registrations of the same name are shadowed (we log).
 */
import type { ToolBridge, ToolContext, ToolDescriptor } from './base.js';
import { logger } from '../utils/logger.js';

export function composeToolBridges(...bridges: ToolBridge[]): ToolBridge {
  return {
    listTools(): ToolDescriptor[] {
      const seen = new Set<string>();
      const out: ToolDescriptor[] = [];
      for (const b of bridges) {
        for (const t of b.listTools()) {
          if (seen.has(t.name)) {
            logger.warn(`[composite-bridge] Tool name collision: ${t.name} (shadowing later definition)`);
            continue;
          }
          seen.add(t.name);
          out.push(t);
        }
      }
      return out;
    },
    async callTool(name: string, args: Record<string, unknown>, ctx?: ToolContext): Promise<unknown> {
      for (const b of bridges) {
        const tools = b.listTools();
        if (tools.some((t) => t.name === name)) {
          return b.callTool(name, args, ctx);
        }
      }
      throw new Error(`Tool not found in any bridge: ${name}`);
    },
  };
}
