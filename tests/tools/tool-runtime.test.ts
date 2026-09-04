import { describe, it, expect } from 'vitest';
import { ToolRuntime } from '../../src/tools/tool-runtime.js';
import { Toolset } from '../../src/tools/toolset.js';
import { BaseTool } from '../../src/tools/_base-tool.js';

class MockTool extends BaseTool {
  definition = {
    name: 'mock_tool',
    description: 'A mock tool',
    input_schema: { type: 'object' as const, properties: {} }
  };
  protected async run() {
    return { content: 'mock result', is_error: false };
  }
}

describe('ToolRuntime and Toolset', () => {
  it('registers tools directly', () => {
    const runtime = new ToolRuntime();
    runtime.registerTool(new MockTool());
    expect(runtime.get('mock_tool')).toBeDefined();
    expect(runtime.size).toBe(1);
  });

  it('registers tools via toolset', () => {
    const runtime = new ToolRuntime();
    const set = new Toolset({
      name: 'mock_set',
      tools: [new MockTool()]
    });
    runtime.registerToolset(set);
    expect(runtime.get('mock_tool')).toBeDefined();
    expect(runtime.size).toBe(1);
  });
});
