// ─── edit_file Tool ─────────────────────────────────────────────
// Exact-string-match replacement with unified diff output.
//
// Why exact string matching?
// - Position-independent: line numbers shift during a session
// - Forces the LLM to reference actual code content
// - One occurrence = safe; zero = graceful error; many = ambiguous error
// - Same approach as Cursor, Aider, Claude Code

import { readFile, writeFile } from 'fs/promises';
import { createPatch } from 'diff';
import type { ToolOutput } from '../types/tools.js';
import { BaseTool } from './_base-tool.js';
import type { PathSandbox } from '../safety/path-sandbox.js';

export default class EditFileTool extends BaseTool {
  readonly definition = {
    name: 'edit_file',
    description:
      'Replace an exact string in a file with new content. ' +
      'The search string must match exactly once in the file. ' +
      'Returns a unified diff showing what changed. ' +
      'Always read_file first to get the exact current content.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'File path to edit, relative to the project root.',
        },
        search: {
          type: 'string',
          description:
            'Exact string to find in the file. Must match exactly once. ' +
            'Include enough surrounding context to be unambiguous.',
        },
        replace: {
          type: 'string',
          description: 'String to replace the search string with.',
        },
      },
      required: ['path', 'search', 'replace'],
    },
  };

  // Injected by AgentRuntime
  sandbox: PathSandbox | null = null;

  protected async run(input: Record<string, unknown>): Promise<ToolOutput> {
    const rawPath = input.path as string;
    const search = input.search as string;
    const replace = input.replace as string;

    // Resolve through sandbox if available
    const filePath = this.sandbox ? this.sandbox.resolve(rawPath) : rawPath;

    if (!search) {
      return this.fail(
        'VALIDATION_ERROR',
        'search string cannot be empty.',
        'Provide the exact text you want to replace.',
      );
    }

    // Read current file content
    let original: string;
    try {
      original = await readFile(filePath, 'utf-8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return this.fail(
          'FILE_NOT_FOUND',
          `File not found: "${filePath}"`,
          'Use write_file to create new files.',
        );
      }
      throw error;
    }

    // Count exact occurrences
    const occurrences = countOccurrences(original, search);

    if (occurrences === 0) {
      return this.fail(
        'EDIT_NOT_FOUND',
        `The search string was not found in "${filePath}".`,
        'Use read_file to inspect the current file content and ensure your search string matches exactly (including whitespace and indentation).',
      );
    }

    if (occurrences > 1) {
      return this.fail(
        'EDIT_AMBIGUOUS',
        `The search string appears ${occurrences} times in "${filePath}". Expected exactly 1.`,
        'Include more surrounding context in your search string to uniquely identify the target location.',
      );
    }

    // Perform the replacement
    const updated = original.replace(search, replace);

    // Write back
    await writeFile(filePath, updated, 'utf-8');

    // Generate unified diff for display
    const diff = createPatch(filePath, original, updated, 'before', 'after');

    // Format the diff nicely (remove the header lines that createPatch adds)
    const diffLines = diff.split('\n').slice(2).join('\n').trim();

    return this.ok(
      `Edited: ${filePath}\n\n${diffLines}`,
      { path: filePath, occurrencesReplaced: 1 },
    );
  }
}

// ─── Helpers ────────────────────────────────────────────────────

/**
 * Count non-overlapping occurrences of `needle` in `haystack`.
 */
function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let pos = 0;
  while ((pos = haystack.indexOf(needle, pos)) !== -1) {
    count++;
    pos += needle.length;
  }
  return count;
}
