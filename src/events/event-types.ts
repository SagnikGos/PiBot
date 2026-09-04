// ─── Agent Event Types ──────────────────────────────────────────
// Discriminated union of all events emitted by the agent runtime.
// Every runtime interaction flows through these events, making
// the REPL (or any future UI) a pure renderer of runtime state.
//
// Phase 1: Extract Agent Runtime

import type { ToolOutput } from '../types/tools.js';
import type { AgentError } from '../types/domain-types.js';

// ─── Token Usage ────────────────────────────────────────────────

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

// ─── Event Discriminated Union ──────────────────────────────────

export type AgentEvent =
  // Session lifecycle
  | { type: 'session.started'; sessionId: string }
  | { type: 'session.resumed'; sessionId: string }

  // Turn lifecycle
  | { type: 'turn.started'; turnIndex: number }
  | { type: 'turn.completed'; turnIndex: number; stopReason: string }

  // Model events
  | { type: 'model.started'; provider: string; model: string }
  | { type: 'model.delta'; text: string }
  | { type: 'model.completed'; usage: Usage }

  // Tool events
  | { type: 'tool.started'; toolCallId: string; name: string; input: Record<string, unknown> }
  | { type: 'tool.stdout'; toolCallId: string; chunk: string }
  | { type: 'tool.completed'; toolCallId: string; name: string; result: ToolOutput }

  // Approval events
  | { type: 'approval.requested'; approvalId: string; command: string; matchedPattern: string }
  | { type: 'approval.resolved'; approvalId: string; approved: boolean }

  // Context events
  | { type: 'context.compressed'; beforeTokens: number; afterTokens: number }
  | { type: 'context.overflow'; estimatedTokens: number; maxTokens: number }

  // Error events
  | { type: 'agent.error'; error: AgentError }

  // Agent lifecycle
  | { type: 'agent.max_iterations'; limit: number }
  | { type: 'agent.cancelled' };
