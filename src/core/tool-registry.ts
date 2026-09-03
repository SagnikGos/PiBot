// ─── Tool Registry ──────────────────────────────────────────────
// Auto-discovers tool files from the tools/ directory and provides
// lookup + execution. Adding a new tool = drop a .ts file in tools/.
//
// Convention:
// - Files starting with underscore (_) are skipped (e.g. _base-tool.ts)
// - Each tool file must: export default class XxxTool extends BaseTool

import { readdir } from 'fs/promises';
import { join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname } from 'path';
import type { Tool, ToolDefinition, ToolOutput } from '../types/tools.js';

export class ToolRegistry {
  private tools = new Map<string, Tool>();

  // ─── Registration ───────────────────────────────────────────

  /** Register a single tool instance. */
  register(tool: Tool): void {
    const name = tool.definition.name;
    if (this.tools.has(name)) {
      throw new Error(`Tool "${name}" is already registered.`);
    }
    this.tools.set(name, tool);
  }

  // ─── Auto-Discovery ─────────────────────────────────────────

  /**
   * Scan a directory for tool files and register them.
   * Skips files starting with underscore.
   * Each file must default-export a class that implements Tool.
   */
  async discoverTools(toolsDir: string): Promise<void> {
    let entries: string[];
    try {
      const dirEntries = await readdir(toolsDir, { withFileTypes: true });
      entries = dirEntries
        .filter((e) => e.isFile())
        .map((e) => e.name)
        .filter((name) => {
          // Skip underscore-prefixed files, declaration files, and maps
          if (name.startsWith('_')) return false;
          if (name.endsWith('.d.ts') || name.endsWith('.map')) return false;
          return name.endsWith('.ts') || name.endsWith('.js');
        });
    } catch {
      // Directory doesn't exist — no tools to discover
      return;
    }

    for (const fileName of entries) {
      try {
        // Convert the file name to .js for import resolution (ESM)
        const importName = fileName.replace(/\.ts$/, '.js');
        const filePath = join(toolsDir, importName);

        // Dynamic import — works with both .ts (tsx) and .js (compiled)
        const importUrl = pathToFileURL(filePath).href;
        const mod = await import(importUrl);

        // Expect a default export that is a class
        const ToolClass = mod.default;
        if (typeof ToolClass !== 'function') {
          console.warn(
            `[ToolRegistry] Skipping ${fileName}: no default export class found.`,
          );
          continue;
        }

        const instance: Tool = new ToolClass();
        this.register(instance);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.warn(`[ToolRegistry] Failed to load tool ${fileName}: ${msg}`);
      }
    }
  }

  /**
   * Discover tools from the built-in tools/ directory
   * (relative to this file's location).
   */
  async discoverBuiltinTools(): Promise<void> {
    const currentFile = fileURLToPath(import.meta.url);
    const currentDir = dirname(currentFile);
    const toolsDir = join(currentDir, '..', 'tools');
    await this.discoverTools(toolsDir);
  }

  // ─── Lookup ─────────────────────────────────────────────────

  /** Get a tool by name. */
  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /** Get all registered tool definitions (for sending to the LLM). */
  getDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((t) => t.definition);
  }

  /** List all registered tool names. */
  listTools(): string[] {
    return Array.from(this.tools.keys());
  }

  /** How many tools are registered. */
  get size(): number {
    return this.tools.size;
  }

  // ─── Execution ──────────────────────────────────────────────

  /**
   * Execute a tool by name with the given input.
   * Returns a ToolOutput with is_error: true if the tool is not found.
   */
  async execute(
    name: string,
    input: Record<string, unknown>,
  ): Promise<ToolOutput> {
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
