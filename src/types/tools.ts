// ─── Tool Input Schema ──────────────────────────────────────────
// JSON Schema subset used to describe what a tool accepts.
// Kept simple — no nested objects, no $ref, no oneOf.
// Sufficient for all our tools and easy to validate at runtime.

export interface ToolPropertySchema {
  type: string;
  description: string;
  enum?: string[];
  default?: unknown;
}

export interface ToolInputSchema {
  type: 'object';
  properties: Record<string, ToolPropertySchema>;
  required: string[];
}

// ─── Tool Definition ────────────────────────────────────────────
// Sent to the LLM so it knows what tools are available.

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: ToolInputSchema;
}

// ─── Tool Output ────────────────────────────────────────────────
// Standardised result returned by every tool execution.

export interface ToolOutput {
  content: string;
  is_error: boolean;
  metadata?: Record<string, unknown>;
}

// ─── Tool Interface ─────────────────────────────────────────────
// The contract every tool must implement.

export interface Tool {
  readonly definition: ToolDefinition;
  execute(input: Record<string, unknown>): Promise<ToolOutput>;
}
