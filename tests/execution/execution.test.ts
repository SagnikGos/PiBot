import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ManagedChildProcess } from '../../src/execution/child-process.js';
import { ProcessManager } from '../../src/execution/process-manager.js';

describe('Execution Module', () => {
  let pm: ProcessManager;

  beforeEach(() => {
    pm = new ProcessManager();
  });

  afterEach(() => {
    pm.cleanup();
  });

  it('runs a simple command', async () => {
    const result = await pm.runCommand({
      command: 'echo "hello"',
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('hello');
  });

  it('handles timeouts', async () => {
    // using a command that hangs for 2s, but we timeout in 100ms
    const sleepCmd = process.platform === 'win32' ? 'ping 127.0.0.1 -n 3' : 'sleep 2';
    const result = await pm.runCommand({
      command: sleepCmd,
      timeoutMs: 100,
    });
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBeNull();
  });

  it('handles abort signals', async () => {
    const abortController = new AbortController();
    const sleepCmd = process.platform === 'win32' ? 'ping 127.0.0.1 -n 3' : 'sleep 2';
    
    setTimeout(() => {
      abortController.abort();
    }, 100);

    const result = await pm.runCommand({
      command: sleepCmd,
      abortSignal: abortController.signal
    });

    expect(result.aborted).toBe(true);
    expect(result.exitCode).toBeNull();
  });
});
