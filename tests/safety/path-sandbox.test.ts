// ─── Path Sandbox Tests ─────────────────────────────────────────
// Baseline tests for path confinement.

import { describe, it, expect } from 'vitest';
import { PathSandbox } from '../../src/safety/path-sandbox.js';

describe('PathSandbox', () => {
  const sandbox = new PathSandbox('/home/user/project');

  it('should resolve relative paths within the sandbox', () => {
    const result = sandbox.resolve('src/index.ts');
    expect(result).toContain('src');
    expect(result).toContain('index.ts');
  });

  it('should reject paths that escape the sandbox', () => {
    expect(() => sandbox.resolve('../../../etc/passwd')).toThrow();
  });

  it('should reject paths with parent traversal', () => {
    expect(() => sandbox.resolve('../../outside')).toThrow();
  });

  it('should strip leading slashes and treat as relative', () => {
    const result = sandbox.resolve('/src/index.ts');
    expect(sandbox.isSafe('/src/index.ts')).toBe(true);
  });

  it('should report safety correctly', () => {
    expect(sandbox.isSafe('src/index.ts')).toBe(true);
    expect(sandbox.isSafe('../../../etc/passwd')).toBe(false);
  });

  it('should resolve multiple paths', () => {
    const results = sandbox.resolveAll('src/a.ts', 'src/b.ts');
    expect(results).toHaveLength(2);
  });

  it('should relativize absolute paths', () => {
    const abs = sandbox.resolve('src/index.ts');
    const rel = sandbox.relativize(abs);
    expect(rel).not.toContain(sandbox.projectRoot);
  });
});
