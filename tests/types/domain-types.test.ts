// ─── Domain Types Tests ─────────────────────────────────────────
// Baseline tests for the error hierarchy and helpers.

import { describe, it, expect } from 'vitest';
import {
  AgentError,
  ProviderError,
  ToolExecutionError,
  CancellationError,
  throwIfAborted,
} from '../../src/types/domain-types.js';

describe('AgentError', () => {
  it('should create an error with code and message', () => {
    const err = new AgentError('UNKNOWN_ERROR', 'something went wrong');
    expect(err.code).toBe('UNKNOWN_ERROR');
    expect(err.message).toBe('something went wrong');
    expect(err.retryable).toBe(false);
    expect(err.userVisible).toBe(true);
    expect(err.name).toBe('AgentError');
  });

  it('should support retryable flag', () => {
    const err = new AgentError('PROVIDER_RATE_LIMIT', 'rate limited', {
      retryable: true,
    });
    expect(err.retryable).toBe(true);
  });

  it('should support cause chaining', () => {
    const cause = new Error('original');
    const err = new AgentError('UNKNOWN_ERROR', 'wrapped', { cause });
    expect(err.cause).toBe(cause);
  });
});

describe('ProviderError', () => {
  it('should be an instance of AgentError', () => {
    const err = new ProviderError('PROVIDER_AUTH', 'unauthorized');
    expect(err).toBeInstanceOf(AgentError);
    expect(err.name).toBe('ProviderError');
    expect(err.code).toBe('PROVIDER_AUTH');
    expect(err.userVisible).toBe(true);
  });
});

describe('ToolExecutionError', () => {
  it('should include tool name', () => {
    const err = new ToolExecutionError(
      'read_file',
      'TOOL_EXECUTION_FAILED',
      'file not found',
    );
    expect(err).toBeInstanceOf(AgentError);
    expect(err.name).toBe('ToolExecutionError');
    expect(err.toolName).toBe('read_file');
    expect(err.userVisible).toBe(false); // Tool errors go to the model, not the user
  });
});

describe('CancellationError', () => {
  it('should create with default message', () => {
    const err = new CancellationError();
    expect(err.code).toBe('AGENT_CANCELLED');
    expect(err.message).toBe('Operation was cancelled');
    expect(err.retryable).toBe(false);
  });

  it('should create with custom message', () => {
    const err = new CancellationError('User pressed Ctrl+C');
    expect(err.message).toBe('User pressed Ctrl+C');
  });
});

describe('throwIfAborted', () => {
  it('should not throw for undefined signal', () => {
    expect(() => throwIfAborted(undefined)).not.toThrow();
  });

  it('should not throw for non-aborted signal', () => {
    const controller = new AbortController();
    expect(() => throwIfAborted(controller.signal)).not.toThrow();
  });

  it('should throw CancellationError for aborted signal', () => {
    const controller = new AbortController();
    controller.abort(new Error('test'));
    expect(() => throwIfAborted(controller.signal)).toThrow(CancellationError);
  });
});
