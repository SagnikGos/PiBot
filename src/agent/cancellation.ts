// ─── Cancellation ───────────────────────────────────────────────
// Wraps AbortController with helpers for the agent runtime.
// Provides cooperative cancellation for LLM calls, tool execution,
// and the entire conversation loop.
//
// Phase 1: Extract Agent Runtime

import { CancellationError, throwIfAborted } from '../types/domain-types.js';

export { throwIfAborted };

/**
 * Create a linked AbortController that aborts when the parent signal
 * is aborted or when its own abort() is called — whichever comes first.
 *
 * This is useful for creating per-turn cancellation that can be
 * triggered either by the user (parent signal) or by the runtime
 * (e.g., max iterations, timeout).
 */
export function createLinkedAbortController(
  parentSignal?: AbortSignal,
): AbortController {
  const controller = new AbortController();

  if (parentSignal?.aborted) {
    controller.abort(parentSignal.reason);
    return controller;
  }

  if (parentSignal) {
    const onAbort = () => {
      controller.abort(parentSignal.reason);
    };
    parentSignal.addEventListener('abort', onAbort, { once: true });

    // Clean up when our controller is aborted independently
    controller.signal.addEventListener(
      'abort',
      () => {
        parentSignal.removeEventListener('abort', onAbort);
      },
      { once: true },
    );
  }

  return controller;
}

/**
 * Check if an error is a cancellation error.
 */
export function isCancellationError(error: unknown): error is CancellationError {
  return error instanceof CancellationError;
}

/**
 * Check if an error is an AbortError (from AbortSignal).
 */
export function isAbortError(error: unknown): boolean {
  return (
    error instanceof DOMException && error.name === 'AbortError'
  ) || (
    error instanceof Error && error.name === 'AbortError'
  );
}

/**
 * Wrap an AbortError into a CancellationError.
 */
export function wrapAbortError(error: unknown): CancellationError {
  if (error instanceof CancellationError) return error;
  const message = error instanceof Error ? error.message : 'Operation was cancelled';
  return new CancellationError(message);
}
