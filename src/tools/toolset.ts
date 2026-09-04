import type { Tool, ToolDefinition } from '../types/tools.js';

export interface ToolsetOptions {
  name: string;
  description?: string;
  tools: Tool[];
}

export class Toolset {
  public readonly name: string;
  public readonly description?: string;
  private tools = new Map<string, Tool>();

  constructor(options: ToolsetOptions) {
    this.name = options.name;
    this.description = options.description;
    
    for (const tool of options.tools) {
      this.addTool(tool);
    }
  }

  addTool(tool: Tool): void {
    const name = tool.definition.name;
    if (this.tools.has(name)) {
      throw new Error(`Tool "${name}" is already in toolset "${this.name}".`);
    }
    this.tools.set(name, tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  getAllTools(): Tool[] {
    return Array.from(this.tools.values());
  }

  getDefinitions(): ToolDefinition[] {
    return this.getAllTools().map((t) => t.definition);
  }
}

