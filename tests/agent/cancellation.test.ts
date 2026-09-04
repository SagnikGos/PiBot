// ─── Cancellation Tests ─────────────────────────────────────────
// Tests for the cancellation utilities.

import { describe, it, expect } from 'vitest';
import {
  createLinkedAbortController,
  isCancellationError,
  isAbortError,
  wrapAbortError,
} from '../../src/agent/cancellation.js';
import { CancellationError } from '../../src/types/domain-types.js';

describe('createLinkedAbortController', () => {
  it('should create a standalone controller when no parent signal', () => {
    const controller = createLinkedAbortController();
    expect(controller.signal.aborted).toBe(false);
  });

  it('should abort child when parent aborts', () => {
    const parent = new AbortController();
    const child = createLinkedAbortController(parent.signal);

    expect(child.signal.aborted).toBe(false);
    parent.abort(new Error('parent abort'));
    expect(child.signal.aborted).toBe(true);
  });

  it('should allow independent child abort without affecting parent', () => {
    const parent = new AbortController();
    const child = createLinkedAbortController(parent.signal);

    child.abort(new Error('child abort'));
    expect(child.signal.aborted).toBe(true);
    expect(parent.signal.aborted).toBe(false);
  });

  it('should pre-abort if parent is already aborted', () => {
    const parent = new AbortController();
    parent.abort(new Error('already done'));

    const child = createLinkedAbortController(parent.signal);
    expect(child.signal.aborted).toBe(true);
  });
});

describe('isCancellationError', () => {
  it('should return true for CancellationError', () => {
    expect(isCancellationError(new CancellationError())).toBe(true);
  });

  it('should return false for regular errors', () => {
    expect(isCancellationError(new Error('nope'))).toBe(false);
  });
});

describe('wrapAbortError', () => {
  it('should return existing CancellationError unchanged', () => {
    const err = new CancellationError('test');
    expect(wrapAbortError(err)).toBe(err);
  });

  it('should wrap a regular error into CancellationError', () => {
    const err = new Error('aborted');
    const wrapped = wrapAbortError(err);
    expect(wrapped).toBeInstanceOf(CancellationError);
    expect(wrapped.message).toBe('aborted');
  });
});
