import type { ToolOutput } from '../types/tools.js';
import { BaseTool } from './_base-tool.js';
import type { PathSandbox } from '../safety/path-sandbox.js';
import { defaultProcessManager } from '../execution/process-manager.js';

const DEFAULT_TIMEOUT_MS = 30_000;  // 30 seconds
const MAX_TIMEOUT_MS = 120_000;     // 2 minutes hard cap
const MAX_OUTPUT_BYTES = 50_000;    // 50KB output cap

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

    let cwd: string;
    if (workingDir) {
      cwd = this.sandbox ? this.sandbox.resolve(workingDir) : `${this.projectRoot}/${workingDir}`;
    } else {
      cwd = this.projectRoot;
    }

    const result = await defaultProcessManager.runCommand({
      command,
      cwd,
      timeoutMs,
      maxBufferBytes: MAX_OUTPUT_BYTES / 2, // 25KB each for stdout and stderr
    });

    const lines: string[] = [];

    lines.push(`$ ${command}`);
    lines.push(`Exit code: ${result.exitCode}${result.timedOut ? ' (TIMED OUT)' : ''}${result.aborted ? ' (ABORTED)' : ''}`);

    if (result.stdout.trim()) {
      lines.push('--- stdout ---');
      lines.push(result.stdout);
    }

    if (result.stderr.trim()) {
      lines.push('--- stderr ---');
      lines.push(result.stderr);
    }

    if (!result.stdout.trim() && !result.stderr.trim()) {
      lines.push('(no output)');
    }

    const output = lines.join('\n');
    const isError = result.exitCode !== 0 || result.timedOut || result.aborted;

    if (result.timedOut) {
      return this.fail(
        'COMMAND_TIMEOUT',
        `Command timed out after ${timeoutSecs}s: ${command}`,
        `Try increasing the timeout or breaking the command into smaller steps.\n\n${output}`
      );
    }

    return {
      content: output,
      is_error: isError,
      metadata: { exitCode: result.exitCode, timedOut: result.timedOut, aborted: result.aborted },
    };
  }
}
