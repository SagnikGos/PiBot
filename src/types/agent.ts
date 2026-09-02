import type { Message } from './messages.js';

// ─── Agent Config ───────────────────────────────────────────────
// Top-level configuration for the agent, assembled from CLI args,
// .env defaults, and hardcoded fallbacks.

export interface AgentConfig {
  provider: string;             // 'gemini' | 'anthropic' | 'openai'
  model: string;                // e.g., 'gemini-2.5-flash'
  maxIterations: number;        // Hard cap on think→act→observe cycles
  maxTokens: number;            // Per-response token limit
  projectRoot: string;          // Resolved absolute path to working dir
  dangerousCommands: string[];  // Regex patterns requiring human confirmation
}

// ─── Agent State ────────────────────────────────────────────────
// Mutable state tracked across the agent's lifetime within a session.

export type AgentStatus =
  | 'idle'
  | 'thinking'
  | 'tool_calling'
  | 'done'
  | 'error'
  | 'max_iterations';

export interface AgentState {
  messages: Message[];
  iterationCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  status: AgentStatus;
}

// ─── Defaults ───────────────────────────────────────────────────

export const DEFAULT_AGENT_CONFIG: Omit<AgentConfig, 'projectRoot'> = {
  provider: 'gemini',
  model: 'gemini-2.5-flash',
  maxIterations: 25,
  maxTokens: 8192,
  dangerousCommands: [
    'rm\\s',
    'sudo\\b',
    'npm\\s+publish',
    'git\\s+push',
    'git\\s+reset',
    'chmod\\b',
    'curl\\b.*\\|\\s*sh',
    'format\\b',
    'del\\s',           // Windows equivalent of rm
    'rmdir\\s',         // Windows directory removal
  ],
};
