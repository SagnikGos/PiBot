import { spawn, ChildProcess as NodeChildProcess } from 'child_process';

export interface CommandOptions {
  command: string;
  cwd?: string;
  timeoutMs?: number;
  maxBufferBytes?: number;
  abortSignal?: AbortSignal;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  aborted: boolean;
}

export class ManagedChildProcess {
  private process?: NodeChildProcess;
  private stdoutBuf = Buffer.alloc(0);
  private stderrBuf = Buffer.alloc(0);
  
  public readonly id: string;
  private readonly options: CommandOptions;
  private isDone = false;

  constructor(id: string, options: CommandOptions) {
    this.id = id;
    this.options = options;
  }

  async run(): Promise<CommandResult> {
    const { command, cwd, timeoutMs, maxBufferBytes = 50000, abortSignal } = this.options;
    
    return new Promise((resolve) => {
      let timedOut = false;
      let aborted = false;
      let timeoutTimer: NodeJS.Timeout | undefined;

      const finish = (exitCode: number | null) => {
        if (this.isDone) return;
        this.isDone = true;
        if (timeoutTimer) clearTimeout(timeoutTimer);
        if (abortSignal) abortSignal.removeEventListener('abort', onAbort);
        
        resolve({
          stdout: this.maybeTruncate(this.stdoutBuf, maxBufferBytes),
          stderr: this.maybeTruncate(this.stderrBuf, maxBufferBytes),
          exitCode,
          timedOut,
          aborted
        });
      };

      const onAbort = () => {
        if (this.isDone) return;
        aborted = true;
        this.kill();
        finish(null);
      };

      if (abortSignal) {
        if (abortSignal.aborted) {
          aborted = true;
          return finish(null);
        }
        abortSignal.addEventListener('abort', onAbort);
      }

      this.process = spawn(command, {
        cwd: cwd || process.cwd(),
        shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
      });

      if (timeoutMs) {
        timeoutTimer = setTimeout(() => {
          if (this.isDone) return;
          timedOut = true;
          this.kill();
          // We wait for the close event, or finish immediately
          // finish will be called by close event normally.
        }, timeoutMs);
      }

      this.process.stdout?.on('data', (chunk: Buffer) => {
        if (this.stdoutBuf.length < maxBufferBytes + 1024) {
          this.stdoutBuf = Buffer.concat([this.stdoutBuf, chunk]);
        }
      });

      this.process.stderr?.on('data', (chunk: Buffer) => {
        if (this.stderrBuf.length < maxBufferBytes + 1024) {
          this.stderrBuf = Buffer.concat([this.stderrBuf, chunk]);
        }
      });

      this.process.on('error', (err) => {
        const msg = Buffer.from(`\n[Process Error] ${err.message}`, 'utf-8');
        this.stderrBuf = Buffer.concat([this.stderrBuf, msg]);
        finish(null);
      });

      this.process.on('close', (code) => {
        finish(code);
      });
    });
  }

  kill(): void {
    if (this.process && !this.isDone) {
      try {
        this.process.kill('SIGKILL');
      } catch (e) {
        // Ignore kill errors
      }
    }
  }

  private maybeTruncate(buf: Buffer, maxBytes: number): string {
    if (buf.length <= maxBytes) {
      return buf.toString('utf-8');
    }
    const truncated = buf.slice(0, maxBytes).toString('utf-8');
    return truncated + `\n... (output truncated at ${maxBytes} bytes)`;
  }
}
