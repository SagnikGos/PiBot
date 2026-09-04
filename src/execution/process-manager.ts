import { ManagedChildProcess, CommandOptions, CommandResult } from './child-process.js';
import { randomUUID } from 'crypto';

export class ProcessManager {
  private processes = new Map<string, ManagedChildProcess>();

  constructor() {
    // Cleanup on exit
    process.on('exit', () => this.cleanup());
    process.on('SIGINT', () => this.cleanup());
    process.on('SIGTERM', () => this.cleanup());
  }

  async runCommand(options: CommandOptions): Promise<CommandResult> {
    const id = randomUUID();
    const child = new ManagedChildProcess(id, options);
    this.processes.set(id, child);
    
    try {
      return await child.run();
    } finally {
      this.processes.delete(id);
    }
  }

  cleanup(): void {
    for (const child of this.processes.values()) {
      child.kill();
    }
    this.processes.clear();
  }

  getRunningProcesses(): ManagedChildProcess[] {
    return Array.from(this.processes.values());
  }
}

// Global default process manager
export const defaultProcessManager = new ProcessManager();
