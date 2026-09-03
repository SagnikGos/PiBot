// ─── write_file Tool ────────────────────────────────────────────
// Creates a new file with the given content.
// Deliberately FAILS if the file already exists — forcing the LLM
// to use edit_file for modifications, which is safer.

import { writeFile, mkdir, access } from 'fs/promises';
import { dirname } from 'path';
import type { ToolOutput } from '../types/tools.js';
import { BaseTool } from './_base-tool.js';
import type { PathSandbox } from '../safety/path-sandbox.js';

export default class WriteFileTool extends BaseTool {
  readonly definition = {
    name: 'write_file',
    description:
      'Create a new file or completely overwrite an existing file with the given content. ' +
      'By default, fails if the file already exists unless overwrite is set to true. ' +
      'Automatically creates any intermediate directories.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'File path to create, relative to the project root.',
        },
        content: {
          type: 'string',
          description: 'Full content to write to the file.',
        },
        overwrite: {
          type: 'boolean',
          description: 'Set to true to completely overwrite an existing file. Use carefully.',
        },
      },
      required: ['path', 'content'],
    },
  };

  // Injected by AgentRuntime
  sandbox: PathSandbox | null = null;

  protected async run(input: Record<string, unknown>): Promise<ToolOutput> {
    const rawPath = input.path as string;
    const content = input.content as string;

    // Resolve through sandbox if available
    const filePath = this.sandbox ? this.sandbox.resolve(rawPath) : rawPath;

    const overwrite = (input.overwrite as boolean) ?? false;

    // Guard: refuse to overwrite existing files unless overwrite is true
    if (!overwrite) {
      try {
        await access(filePath);
        // If we get here, the file exists
        return this.fail(
          'VALIDATION_ERROR',
          `File already exists: "${filePath}". Use edit_file to modify it, or set overwrite: true to replace it completely.`,
          'Read the file first with read_file, then use edit_file to make targeted changes. Only use overwrite: true if replacing the entire file.',
        );
      } catch {
        // ENOENT means the file doesn't exist — that's what we want
      }
    }

    // Create parent directories if needed
    const dir = dirname(filePath);
    await mkdir(dir, { recursive: true });

    // Write the file
    await writeFile(filePath, content, 'utf-8');

    const lineCount = content.split('\n').length;
    const byteCount = Buffer.byteLength(content, 'utf-8');

    return this.ok(
      `Created: ${filePath} (${lineCount} lines, ${byteCount} bytes)`,
      { path: filePath, lineCount, byteCount },
    );
  }
}
