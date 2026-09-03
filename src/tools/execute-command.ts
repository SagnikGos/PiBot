// ─── execute_command Tool ────────────────────────────────────────
// Runs a shell command in the project root with timeout enforcement.
// Captures stdout + stderr and returns them as readable text.
//
// Safety: patterns matching dangerousCommands in AgentConfig will be
// blocked at the AgentRuntime level (Phase 4). The tool itself is
// intentionally simple — safety is the runtime's responsibility.

import { exec } from 'child_process';
import { promisify } from 'util';
import type { ToolOutput } from '../types/tools.js';
import { BaseTool } from './_base-tool.js';
import type { PathSandbox } from '../safety/path-sandbox.js';

const execAsync = promisify(exec);

const DEFAULT_TIMEOUT_MS = 30_000;  // 30 seconds
const MAX_TIMEOUT_MS = 120_000;     // 2 minutes hard cap
const MAX_OUTPUT_BYTES = 50_000;    // 50KB output cap (prevent flooding context)

export default class ExecuteCommandTool extends BaseTool {
  readonly definition = {
    name: 'execute_command',
    description:
      'Run a shell command in the project root directory. ' +
      'Captures stdout and stderr. ' +
      'Use this to run tests, build scripts, linters, or inspect runtime behavior.',
    input_schema: {
      type: 'object' as const,
      properties: {
        command: {
          type: 'string',
          description:
            'The shell command to run (e.g., "npm test", "npx tsc --noEmit").',
        },
        timeout: {
          type: 'number',
          description: `Timeout in seconds. Defaults to ${DEFAULT_TIMEOUT_MS / 1000}s, max ${MAX_TIMEOUT_MS / 1000}s.`,
        },
        working_dir: {
          type: 'string',
          description:
            'Subdirectory to run the command in, relative to project root. Defaults to project root.',
        },
      },
      required: ['command'],
    },
  };

  // Injected by AgentRuntime
  projectRoot: string = process.cwd();
  sandbox: PathSandbox | null = null;

  protected async run(input: Record<string, unknown>): Promise<ToolOutput> {
    const command = input.command as string;
    const timeoutSecs = (input.timeout as number) ?? (DEFAULT_TIMEOUT_MS / 1000);
    const workingDir = input.working_dir as string | undefined;

    if (!command.trim()) {
      return this.fail('VALIDATION_ERROR', 'command cannot be empty.');
    }

    const timeoutMs = Math.min(timeoutSecs * 1000, MAX_TIMEOUT_MS);

    // Resolve working directory through sandbox if available
    let cwd: string;
    if (workingDir) {
      cwd = this.sandbox ? this.sandbox.resolve(workingDir) : `${this.projectRoot}/${workingDir}`;
    } else {
      cwd = this.projectRoot;
    }

    let stdout = '';
    let stderr = '';
    let exitCode = 0;
    let timedOut = false;

    try {
      const result = await execAsync(command, {
        cwd,
        timeout: timeoutMs,
        maxBuffer: MAX_OUTPUT_BYTES,
        shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
      });
      stdout = result.stdout;
      stderr = result.stderr;
    } catch (error: any) {
      if (error.killed || error.signal === 'SIGTERM') {
        timedOut = true;
      }
      stdout = error.stdout ?? '';
      stderr = error.stderr ?? '';
      exitCode = error.code ?? 1;
    }

    // Format the output
    const lines: string[] = [];

    lines.push(`$ ${command}`);
    lines.push(`Exit code: ${exitCode}${timedOut ? ' (TIMED OUT)' : ''}`);

    if (stdout.trim()) {
      const truncated = maybeTruncate(stdout, MAX_OUTPUT_BYTES / 2);
      lines.push('--- stdout ---');
      lines.push(truncated);
    }

    if (stderr.trim()) {
      const truncated = maybeTruncate(stderr, MAX_OUTPUT_BYTES / 2);
      lines.push('--- stderr ---');
      lines.push(truncated);
    }

    if (!stdout.trim() && !stderr.trim()) {
      lines.push('(no output)');
    }

    const output = lines.join('\n');
    const isError = exitCode !== 0 || timedOut;

    if (timedOut) {
      return this.fail(
        'COMMAND_TIMEOUT',
        `Command timed out after ${timeoutSecs}s: ${command}`,
        `Try increasing the timeout or breaking the command into smaller steps.`,
      );
    }

    return {
      content: output,
      is_error: isError,
      metadata: { exitCode, timedOut },
    };
  }
}

// ─── Helpers ────────────────────────────────────────────────────

function maybeTruncate(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, 'utf-8') <= maxBytes) return text;
  const truncated = Buffer.from(text, 'utf-8').slice(0, maxBytes).toString('utf-8');
  return truncated + `\n... (output truncated at ${maxBytes} bytes)`;
}
