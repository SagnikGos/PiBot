// ─── Domain Types ───────────────────────────────────────────────
// Stable boundary types that define the public contract between
// PπBot subsystems. These types are the foundation for the
// Hermes-class architecture evolution.
//
// Phase 0: Baseline & Contracts

// ─── Agent Input ────────────────────────────────────────────────
// What an interface layer passes to the AgentRuntime.

export interface AgentInput {
  /** Resume an existing session, or start a new one if omitted. */
  sessionId?: string;
  /** The user's message. */
  message: string;
  /** Absolute path to the project working directory. */
  cwd: string;
  /** Abort signal for cooperative cancellation. */
  signal?: AbortSignal;
}

// ─── Agent Result ───────────────────────────────────────────────
// What the AgentRuntime returns to the interface layer.

export type AgentStatus =
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'max_iterations';

export interface AgentResult {
  /** The session ID (created or resumed). */
  sessionId: string;
  /** How the run ended. */
  status: AgentStatus;
  /** The final text response, if any. */
  message?: string;
  /** Token usage for this run. */
  usage?: { inputTokens: number; outputTokens: number };
}

// ─── Agent Error Hierarchy ──────────────────────────────────────
// Normalized error classes with machine-readable codes.
// All lower-level errors should be wrapped into these before being
// returned to the model or interface layer.

export type AgentErrorCode =
  // Provider errors
  | 'PROVIDER_AUTH'
  | 'PROVIDER_RATE_LIMIT'
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_INVALID_REQUEST'
  | 'PROVIDER_CONTEXT_OVERFLOW'
  // Tool errors
  | 'TOOL_NOT_FOUND'
  | 'TOOL_INVALID_ARGUMENTS'
  | 'TOOL_TIMEOUT'
  | 'TOOL_CANCELLED'
  | 'TOOL_EXECUTION_FAILED'
  // Policy errors
  | 'POLICY_DENIED'
  | 'APPROVAL_DENIED'
  | 'SANDBOX_VIOLATION'
  // Execution errors
  | 'EXECUTION_FAILED'
  | 'PROCESS_NOT_FOUND'
  // Context errors
  | 'CONTEXT_COMPRESSION_FAILED'
  // Session errors
  | 'SESSION_NOT_FOUND'
  // Agent errors
  | 'AGENT_CANCELLED'
  | 'AGENT_MAX_ITERATIONS'
  // Generic
  | 'UNKNOWN_ERROR';

export class AgentError extends Error {
  readonly code: AgentErrorCode;
  readonly retryable: boolean;
  readonly userVisible: boolean;

  constructor(
    code: AgentErrorCode,
    message: string,
    options?: {
      retryable?: boolean;
      userVisible?: boolean;
      cause?: unknown;
    },
  ) {
    super(message, { cause: options?.cause });
    this.name = 'AgentError';
    this.code = code;
    this.retryable = options?.retryable ?? false;
    this.userVisible = options?.userVisible ?? true;
  }
}

// ─── Provider Errors ────────────────────────────────────────────

export class ProviderError extends AgentError {
  constructor(
    code: Extract<
      AgentErrorCode,
      | 'PROVIDER_AUTH'
      | 'PROVIDER_RATE_LIMIT'
      | 'PROVIDER_TIMEOUT'
      | 'PROVIDER_UNAVAILABLE'
      | 'PROVIDER_INVALID_REQUEST'
      | 'PROVIDER_CONTEXT_OVERFLOW'
    >,
    message: string,
    options?: { retryable?: boolean; cause?: unknown },
  ) {
    super(code, message, { ...options, userVisible: true });
    this.name = 'ProviderError';
  }
}

// ─── Tool Errors ────────────────────────────────────────────────

export class ToolExecutionError extends AgentError {
  readonly toolName: string;

  constructor(
    toolName: string,
    code: Extract<
      AgentErrorCode,
      | 'TOOL_NOT_FOUND'
      | 'TOOL_INVALID_ARGUMENTS'
      | 'TOOL_TIMEOUT'
      | 'TOOL_CANCELLED'
      | 'TOOL_EXECUTION_FAILED'
    >,
    message: string,
    options?: { retryable?: boolean; cause?: unknown },
  ) {
    super(code, message, { ...options, userVisible: false });
    this.name = 'ToolExecutionError';
    this.toolName = toolName;
  }
}

// ─── Cancellation ───────────────────────────────────────────────

export class CancellationError extends AgentError {
  constructor(message = 'Operation was cancelled') {
    super('AGENT_CANCELLED', message, {
      retryable: false,
      userVisible: true,
    });
    this.name = 'CancellationError';
  }
}

// ─── Helpers ────────────────────────────────────────────────────

/** Check if an AbortSignal has been aborted and throw if so. */
export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new CancellationError(
      signal.reason?.message ?? 'Operation was cancelled',
    );
  }
}
