import type { Message, LLMResponse, ContentBlock } from './messages.js';
import type { ToolDefinition } from './tools.js';

// ─── Provider Config ────────────────────────────────────────────
// Passed to a provider factory to create an LLMProvider instance.

export interface ProviderConfig {
  apiKey: string;
  model: string;
  maxTokens: number;
  baseUrl?: string; // Override for proxies, local models, etc.
}

// ─── Chat Request ───────────────────────────────────────────────
// Provider-agnostic request shape. Each provider maps this to
// its own REST API format.

export interface ChatRequest {
  systemPrompt: string;
  messages: Message[];
  tools?: ToolDefinition[];
  /** Abort signal for cooperative cancellation of in-flight requests. */
  signal?: AbortSignal;
}

// ─── LLM Provider Interface ────────────────────────────────────
// The contract every LLM provider must implement.
// Providers are thin HTTP translation layers over fetch().

export interface LLMProvider {
  readonly name: string;

  /** Send a chat request and get a complete response. */
  chat(params: ChatRequest): Promise<LLMResponse>;

  /**
   * Send a chat request and stream the response.
   * Yields text deltas as they arrive.
   * The return value of the generator is the final assembled LLMResponse.
   */
  chatStream(params: ChatRequest): AsyncGenerator<string, LLMResponse>;
}

// ─── Provider Factory ───────────────────────────────────────────
// Function signature for creating a provider instance.

export type ProviderFactory = (config: ProviderConfig) => LLMProvider;

// ─── Re-exports for convenience ─────────────────────────────────
export type { Message, LLMResponse, ContentBlock, ToolDefinition };
