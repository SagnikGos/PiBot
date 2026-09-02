// ─── search_codebase Tool ───────────────────────────────────────
// Recursive grep-style search across files. Case-insensitive string
// matching with surrounding context lines. Skips binary files and
// common ignore patterns.

import { readdir, readFile, stat } from 'fs/promises';
import { join, extname } from 'path';
import type { ToolOutput } from '../types/tools.js';
import { BaseTool } from './_base-tool.js';

// Directories to skip during search
const IGNORE_DIRS = new Set([
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
  '.output',
]);

// File extensions to skip (likely binary)
const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg',
  '.woff', '.woff2', '.ttf', '.eot',
  '.mp3', '.mp4', '.avi', '.mov',
  '.zip', '.tar', '.gz', '.bz2',
  '.pdf', '.doc', '.docx',
  '.exe', '.dll', '.so', '.dylib',
  '.pyc', '.pyo', '.class',
  '.lock',
]);

const DEFAULT_MAX_RESULTS = 20;
const CONTEXT_LINES = 2; // Lines of context above and below each match
const MAX_FILE_SIZE = 512 * 1024; // Skip files larger than 512KB

export default class SearchCodebaseTool extends BaseTool {
  readonly definition = {
    name: 'search_codebase',
    description:
      'Search for a text pattern across files in the codebase. ' +
      'Returns matching file paths with line numbers and surrounding context. ' +
      'Case-insensitive. Use this to find where something is defined or used.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Text string to search for (case-insensitive).',
        },
        path: {
          type: 'string',
          description:
            'Directory to search in, relative to project root. Defaults to "." (project root).',
        },
        file_pattern: {
          type: 'string',
          description:
            'File extension filter (e.g., ".ts", ".py"). Omit to search all text files.',
        },
        max_results: {
          type: 'number',
          description: `Maximum number of matches to return. Defaults to ${DEFAULT_MAX_RESULTS}.`,
        },
      },
      required: ['query'],
    },
  };

  protected async run(input: Record<string, unknown>): Promise<ToolOutput> {
    const query = input.query as string;
    const searchPath = (input.path as string) ?? '.';
    const filePattern = input.file_pattern as string | undefined;
    const maxResults = (input.max_results as number) ?? DEFAULT_MAX_RESULTS;

    if (!query.trim()) {
      return this.fail('VALIDATION_ERROR', 'Search query cannot be empty.');
    }

    const matches: SearchMatch[] = [];
    let filesSearched = 0;
    let truncated = false;

    await this.searchDir(
      searchPath,
      query.toLowerCase(),
      filePattern,
      matches,
      maxResults,
      { filesSearched: 0 },
      () => {
        truncated = matches.length >= maxResults;
        return truncated;
      },
    );

    if (matches.length === 0) {
      return this.ok(
        `No matches found for "${query}" in ${searchPath}.`,
        { matchCount: 0, filesSearched },
      );
    }

    // Format results
    const formatted = matches.map((m) => {
      const header = `${m.filePath}:${m.lineNumber}`;
      const contextLines = m.context
        .map((cl) => {
          const marker = cl.isMatch ? '>' : ' ';
          return `${marker} ${String(cl.lineNumber).padStart(4)}: ${cl.text}`;
        })
        .join('\n');
      return `${header}\n${contextLines}`;
    });

    let result = formatted.join('\n\n');
    if (truncated) {
      result += `\n\n... (showing ${matches.length} of potentially more matches. Refine your query or path.)`;
    }

    return this.ok(result, {
      matchCount: matches.length,
      truncated,
    });
  }

  private async searchDir(
    dirPath: string,
    queryLower: string,
    filePattern: string | undefined,
    matches: SearchMatch[],
    maxResults: number,
    counter: { filesSearched: number },
    shouldStop: () => boolean,
  ): Promise<void> {
    if (shouldStop()) return;

    let entries;
    try {
      entries = await readdir(dirPath, { withFileTypes: true });
    } catch {
      return; // Skip unreadable directories
    }

    // Sort for deterministic output
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (shouldStop()) return;

      const fullPath = join(dirPath, entry.name);

      if (entry.isDirectory()) {
        if (IGNORE_DIRS.has(entry.name)) continue;
        await this.searchDir(
          fullPath,
          queryLower,
          filePattern,
          matches,
          maxResults,
          counter,
          shouldStop,
        );
      } else if (entry.isFile()) {
        // Filter by extension
        const ext = extname(entry.name).toLowerCase();
        if (BINARY_EXTENSIONS.has(ext)) continue;
        if (filePattern && ext !== filePattern.toLowerCase()) continue;

        // Skip large files
        try {
          const stats = await stat(fullPath);
          if (stats.size > MAX_FILE_SIZE) continue;
        } catch {
          continue;
        }

        await this.searchFile(
          fullPath,
          queryLower,
          matches,
          maxResults,
          shouldStop,
        );
        counter.filesSearched++;
      }
    }
  }

  private async searchFile(
    filePath: string,
    queryLower: string,
    matches: SearchMatch[],
    maxResults: number,
    shouldStop: () => boolean,
  ): Promise<void> {
    let content: string;
    try {
      content = await readFile(filePath, 'utf-8');
    } catch {
      return; // Skip unreadable files
    }

    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      if (shouldStop()) return;

      if (lines[i].toLowerCase().includes(queryLower)) {
        // Build context window
        const contextStart = Math.max(0, i - CONTEXT_LINES);
        const contextEnd = Math.min(lines.length - 1, i + CONTEXT_LINES);

        const context: ContextLine[] = [];
        for (let j = contextStart; j <= contextEnd; j++) {
          context.push({
            lineNumber: j + 1,
            text: lines[j],
            isMatch: j === i,
          });
        }

        matches.push({
          filePath,
          lineNumber: i + 1,
          context,
        });

        if (matches.length >= maxResults) return;
      }
    }
  }
}

// ─── Internal Types ─────────────────────────────────────────────

interface ContextLine {
  lineNumber: number;
  text: string;
  isMatch: boolean;
}

interface SearchMatch {
  filePath: string;
  lineNumber: number;
  context: ContextLine[];
}
