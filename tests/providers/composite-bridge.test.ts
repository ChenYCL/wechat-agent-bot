import { describe, it, expect } from 'vitest';
import { composeToolBridges } from '../../src/providers/composite-bridge.js';
import type { ToolBridge } from '../../src/providers/base.js';

function mkBridge(name: string, response: string): ToolBridge {
  return {
    listTools: () => [{ name }],
    callTool: async (n) => ({ from: n === name ? response : 'unknown' }),
  };
}

describe('composeToolBridges', () => {
  it('merges listTools and dedupes by name (first wins)', () => {
    const a = mkBridge('foo', 'A');
    const b = mkBridge('foo', 'B');
    const c = mkBridge('bar', 'C');
    const merged = composeToolBridges(a, b, c);
    const names = merged.listTools().map((t) => t.name);
    expect(names).toEqual(['foo', 'bar']);
  });

  it('routes callTool to the first bridge that advertises the name', async () => {
    const a = mkBridge('alpha', 'A');
    const b = mkBridge('beta', 'B');
    const merged = composeToolBridges(a, b);
    expect(await merged.callTool('alpha', {})).toEqual({ from: 'A' });
    expect(await merged.callTool('beta', {})).toEqual({ from: 'B' });
  });

  it('throws for unknown tool names', async () => {
    const merged = composeToolBridges(mkBridge('x', 'X'));
    await expect(merged.callTool('y', {})).rejects.toThrow('Tool not found');
  });
});
