import { readdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import type { Tool, ToolDefinition, ToolOutput } from '../types/tools.js';
import { Toolset } from './toolset.js';

export class ToolRuntime {
  private tools = new Map<string, Tool>();
  private toolsets = new Map<string, Toolset>();

  // ─── Registration ───────────────────────────────────────────

  /** Register a single tool instance. */
  registerTool(tool: Tool): void {
    const name = tool.definition.name;
    if (this.tools.has(name)) {
      throw new Error(`Tool "${name}" is already registered.`);
    }
    this.tools.set(name, tool);
  }

  /** Register a toolset. Tools within are also registered globally. */
  registerToolset(toolset: Toolset): void {
    if (this.toolsets.has(toolset.name)) {
      throw new Error(`Toolset "${toolset.name}" is already registered.`);
    }
    this.toolsets.set(toolset.name, toolset);
    
    for (const tool of toolset.getAllTools()) {
      try {
        this.registerTool(tool);
      } catch (err) {
        throw new Error(`Failed to register toolset "${toolset.name}": ${(err as Error).message}`);
      }
    }
  }

  // ─── Auto-Discovery ─────────────────────────────────────────

  async discoverTools(toolsDir: string): Promise<void> {
    let entries: string[];
    try {
      const dirEntries = await readdir(toolsDir, { withFileTypes: true });
      entries = dirEntries
        .filter((e) => e.isFile())
        .map((e) => e.name)
        .filter((name) => {
          if (name.startsWith('_')) return false;
          if (name.endsWith('.d.ts') || name.endsWith('.map')) return false;
          // Skip infrastructure files
          if (name.includes('tool-runtime') || name.includes('toolset')) return false;
          return name.endsWith('.ts') || name.endsWith('.js');
        });
    } catch {
      return;
    }

    for (const fileName of entries) {
      try {
        const importName = fileName.replace(/\.ts$/, '.js');
        const filePath = join(toolsDir, importName);
        const importUrl = pathToFileURL(filePath).href;
        const mod = await import(importUrl);

        const ToolClass = mod.default;
        if (typeof ToolClass !== 'function') {
          console.warn(`[ToolRuntime] Skipping ${fileName}: no default export class found.`);
          continue;
        }

        const instance: Tool = new ToolClass();
        this.registerTool(instance);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.warn(`[ToolRuntime] Failed to load tool ${fileName}: ${msg}`);
      }
    }
  }

  async discoverBuiltinTools(): Promise<void> {
    const currentFile = fileURLToPath(import.meta.url);
    const currentDir = dirname(currentFile);
    const toolsDir = currentDir;
    await this.discoverTools(toolsDir);
  }

  // ─── Lookup ─────────────────────────────────────────────────

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  getDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((t) => t.definition);
  }

  listTools(): string[] {
    return Array.from(this.tools.keys());
  }

  get size(): number {
    return this.tools.size;
  }

  // ─── Execution ──────────────────────────────────────────────

  async execute(name: string, input: Record<string, unknown>): Promise<ToolOutput> {
    const tool = this.tools.get(name);

    if (!tool) {
      return {
        content: `[ERROR] UNKNOWN_TOOL: No tool named "${name}" is registered. Available tools: ${this.listTools().join(', ')}`,
        is_error: true,
      };
    }

    return tool.execute(input);
  }
}

