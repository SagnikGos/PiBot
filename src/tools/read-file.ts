// ─── read_file Tool ─────────────────────────────────────────────
// Reads a file and returns its contents with line numbers.
// Supports optional line range extraction and enforces a max
// read size to avoid flooding the LLM context.

import { readFile, stat } from 'fs/promises';
import type { ToolOutput } from '../types/tools.js';
import { BaseTool } from './_base-tool.js';

const MAX_FILE_SIZE = 100 * 1024; // 100KB

export default class ReadFileTool extends BaseTool {
  readonly definition = {
    name: 'read_file',
    description:
      'Read the contents of a file with line numbers. ' +
      'Optionally specify a line range to read only part of the file. ' +
      'Use this to inspect code before making edits.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'File path relative to the project root.',
        },
        start_line: {
          type: 'number',
          description:
            'First line to read (1-indexed, inclusive). Omit to start from the beginning.',
        },
        end_line: {
          type: 'number',
          description:
            'Last line to read (1-indexed, inclusive). Omit to read to the end.',
        },
      },
      required: ['path'],
    },
  };

  protected async run(input: Record<string, unknown>): Promise<ToolOutput> {
    const filePath = input.path as string;
    const startLine = input.start_line as number | undefined;
    const endLine = input.end_line as number | undefined;

    // Check file exists and size
    let fileStats;
    try {
      fileStats = await stat(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return this.fail('FILE_NOT_FOUND', `File not found: "${filePath}"`);
      }
      throw error;
    }

    if (!fileStats.isFile()) {
      return this.fail(
        'VALIDATION_ERROR',
        `"${filePath}" is not a file. Use list_directory to browse directories.`,
      );
    }

    if (fileStats.size > MAX_FILE_SIZE) {
      return this.fail(
        'VALIDATION_ERROR',
        `File is too large (${(fileStats.size / 1024).toFixed(1)}KB). ` +
          `Max allowed: ${MAX_FILE_SIZE / 1024}KB. Use start_line/end_line to read a portion.`,
      );
    }

    // Read file
    const content = await readFile(filePath, 'utf-8');
    const allLines = content.split('\n');
    const totalLines = allLines.length;

    // Apply line range
    const start = Math.max(1, startLine ?? 1);
    const end = Math.min(totalLines, endLine ?? totalLines);

    if (start > totalLines) {
      return this.fail(
        'VALIDATION_ERROR',
        `start_line ${start} exceeds total lines (${totalLines}).`,
      );
    }

    const selectedLines = allLines.slice(start - 1, end);

    // Format with line numbers
    const numbered = selectedLines
      .map((line, i) => `${String(start + i).padStart(4)}: ${line}`)
      .join('\n');

    // Build header
    const rangeInfo =
      startLine || endLine
        ? ` (lines ${start}-${end} of ${totalLines})`
        : ` (${totalLines} lines)`;

    const header = `File: ${filePath}${rangeInfo}\n${'─'.repeat(60)}`;

    return this.ok(`${header}\n${numbered}`, {
      totalLines,
      displayedLines: selectedLines.length,
      fileSizeBytes: fileStats.size,
    });
  }
}
