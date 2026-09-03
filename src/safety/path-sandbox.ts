// ─── Path Sandbox ────────────────────────────────────────────────
// Resolves and validates file paths against the project root.
// Any path that resolves outside the root is rejected with a
// PATH_OUTSIDE_SANDBOX error — preventing directory traversal attacks
// and accidental edits to files outside the project.
//
// Usage:
//   const sandbox = new PathSandbox('/home/user/myproject');
//   const safe = sandbox.resolve('../../../etc/passwd'); // throws
//   const safe = sandbox.resolve('src/index.ts');        // returns absolute path

import { resolve, relative } from 'path';
import { createToolError, formatToolError } from '../types/errors.js';

export class PathSandbox {
  private readonly root: string;

  constructor(projectRoot: string) {
    // Normalize the root to an absolute path
    this.root = resolve(projectRoot);
  }

  get projectRoot(): string {
    return this.root;
  }

  /**
   * Resolve a user-provided path against the project root.
   * Throws a PATH_OUTSIDE_SANDBOX error if the resolved path
   * escapes the project directory.
   *
   * @param inputPath - Relative or absolute path from tool input
   * @returns Absolute safe path
   */
  resolve(inputPath: string): string {
    // Treat all paths as relative to the project root
    // (even if they look absolute, e.g. "/src/index.ts" → "<root>/src/index.ts")
    const stripped = inputPath.startsWith('/')
      ? inputPath.slice(1)
      : inputPath;

    const abs = resolve(this.root, stripped);

    // Check that the resolved path starts with the project root
    const rel = relative(this.root, abs);

    // rel starts with '..' → outside the root
    if (rel.startsWith('..') || resolve(abs) === resolve(this.root, '..')) {
      const err = createToolError(
        'PATH_OUTSIDE_SANDBOX',
        `Path "${inputPath}" resolves to "${abs}" which is outside the project root "${this.root}".`,
      );
      throw Object.assign(new Error(formatToolError(err)), {
        toolErrorCode: 'PATH_OUTSIDE_SANDBOX' as const,
      });
    }

    return abs;
  }

  /**
   * Resolve multiple paths at once. All must be within the sandbox.
   */
  resolveAll(...paths: string[]): string[] {
    return paths.map((p) => this.resolve(p));
  }

  /**
   * Returns the path relative to the project root (for display).
   */
  relativize(absPath: string): string {
    return relative(this.root, absPath);
  }

  /**
   * Check if a path is safe without throwing.
   */
  isSafe(inputPath: string): boolean {
    try {
      this.resolve(inputPath);
      return true;
    } catch {
      return false;
    }
  }
}
