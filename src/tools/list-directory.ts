// ─── list_directory Tool ────────────────────────────────────────
// Lists the contents of a directory with tree-style formatting.
// Shows file sizes, skips common ignore patterns, and supports
// recursive listing with depth control.

import { readdir, stat } from 'fs/promises';
import { join } from 'path';
import type { ToolOutput } from '../types/tools.js';
import { BaseTool } from './_base-tool.js';

// Directories to always skip
const DEFAULT_IGNORE = new Set([
  'node_modules',
  '.git',
  'dist',
  '.next',
  '__pycache__',
  '.venv',
  'venv',
  '.cache',
  'coverage',
  '.turbo',
]);

const MAX_ENTRIES = 200;

export default class ListDirectoryTool extends BaseTool {
  readonly definition = {
    name: 'list_directory',
    description:
      'List the contents of a directory, showing files and subdirectories with sizes. ' +
      'Use this to explore the project structure and find files.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description:
            'Directory path to list, relative to the project root. Use "." for the project root.',
        },
        recursive: {
          type: 'boolean',
          description:
            'If true, list contents recursively. Defaults to false.',
        },
        max_depth: {
          type: 'number',
          description:
            'Maximum depth for recursive listing. Defaults to 3.',
        },
      },
      required: ['path'],
    },
  };

  protected async run(input: Record<string, unknown>): Promise<ToolOutput> {
    const dirPath = input.path as string;
    const recursive = (input.recursive as boolean) ?? false;
    const maxDepth = (input.max_depth as number) ?? 3;

    const entries: string[] = [];
    let truncated = false;

    await this.walkDir(dirPath, '', 0, recursive ? maxDepth : 0, entries, () => {
      truncated = entries.length >= MAX_ENTRIES;
      return truncated;
    });

    if (entries.length === 0) {
      return this.ok(`Directory "${dirPath}" is empty.`);
    }

    let result = entries.join('\n');
    if (truncated) {
      result += `\n\n... (truncated at ${MAX_ENTRIES} entries. Use a more specific path.)`;
    }

    return this.ok(result, { entryCount: entries.length, truncated });
  }

  private async walkDir(
    basePath: string,
    prefix: string,
    depth: number,
    maxDepth: number,
    output: string[],
    shouldStop: () => boolean,
  ): Promise<void> {
    if (shouldStop()) return;

    let dirEntries;
    try {
      dirEntries = await readdir(basePath, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw Object.assign(
          new Error(`Directory not found: "${basePath}"`),
          { toolErrorCode: 'FILE_NOT_FOUND' },
        );
      }
      throw error;
    }

    // Sort: directories first, then files, both alphabetical
    const sorted = dirEntries.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });

    for (let i = 0; i < sorted.length; i++) {
      if (shouldStop()) return;

      const entry = sorted[i];
      const isLast = i === sorted.length - 1;
      const connector = isLast ? '└── ' : '├── ';
      const childPrefix = prefix + (isLast ? '    ' : '│   ');
      const fullPath = join(basePath, entry.name);

      if (entry.isDirectory()) {
        if (DEFAULT_IGNORE.has(entry.name)) {
          output.push(`${prefix}${connector}${entry.name}/ (ignored)`);
          continue;
        }

        output.push(`${prefix}${connector}${entry.name}/`);

        if (depth < maxDepth) {
          await this.walkDir(
            fullPath,
            childPrefix,
            depth + 1,
            maxDepth,
            output,
            shouldStop,
          );
        }
      } else {
        const size = await this.formatSize(fullPath);
        output.push(`${prefix}${connector}${entry.name} ${size}`);
      }
    }
  }

  private async formatSize(filePath: string): Promise<string> {
    try {
      const stats = await stat(filePath);
      const bytes = stats.size;
      if (bytes < 1024) return `(${bytes}B)`;
      if (bytes < 1024 * 1024) return `(${(bytes / 1024).toFixed(1)}KB)`;
      return `(${(bytes / (1024 * 1024)).toFixed(1)}MB)`;
    } catch {
      return '';
    }
  }
}
