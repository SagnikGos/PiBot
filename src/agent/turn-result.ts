// ─── Turn Result ────────────────────────────────────────────────
// Represents the outcome of a single conversation turn.
// Used by ConversationLoop and TurnRunner.
//
// Phase 1: Extract Agent Runtime

import type { ContentBlock, StopReason, TokenUsage } from '../types/messages.js';

export interface TurnResult {
  /** The content blocks from the LLM response. */
  content: ContentBlock[];
  /** Why the LLM stopped generating. */
  stopReason: StopReason;
  /** Token usage for this turn. */
  usage: TokenUsage;
  /** The iteration number (1-based). */
  iteration: number;
}

export interface RunResult {
  /** How the entire run ended. */
  status: 'completed' | 'cancelled' | 'max_iterations';
  /** Total token usage across all turns. */
  totalUsage: TokenUsage;
  /** Number of iterations performed. */
  iterations: number;
}
