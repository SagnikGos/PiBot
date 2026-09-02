// ─── Content Block Types (Discriminated Union) ──────────────────
// Provider-agnostic internal representation of message content.
// Every LLM provider maps to/from these shapes at the boundary.

export interface TextBlock {
  type: 'text';
  text: string;
}

export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
  metadata?: any;
}

export interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error: boolean;
}

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

// ─── Message ────────────────────────────────────────────────────
// A single turn in the conversation. `content` is a string for
// simple user messages, or ContentBlock[] for structured responses.

export interface Message {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
}

// ─── LLM Response ───────────────────────────────────────────────
// What we get back from any provider after normalisation.

export type StopReason = 'end_turn' | 'tool_use' | 'max_tokens';

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface LLMResponse {
  content: ContentBlock[];
  stopReason: StopReason;
  usage: TokenUsage;
}
