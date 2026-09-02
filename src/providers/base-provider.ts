import type {
  LLMProvider,
  ChatRequest,
  ProviderConfig,
} from '../types/providers.js';
import type { LLMResponse, ContentBlock } from '../types/messages.js';

// ─── Base Provider ──────────────────────────────────────────────
// Abstract base class with shared HTTP and SSE utilities.
// Each concrete provider (Gemini, Anthropic, OpenAI) extends this
// and implements the request/response mapping logic.

export abstract class BaseProvider implements LLMProvider {
  abstract readonly name: string;

  protected readonly apiKey: string;
  protected readonly model: string;
  protected readonly maxTokens: number;
  protected readonly baseUrl: string;

  constructor(config: ProviderConfig, defaultBaseUrl: string) {
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.maxTokens = config.maxTokens;
    this.baseUrl = config.baseUrl ?? defaultBaseUrl;
  }

  abstract chat(params: ChatRequest): Promise<LLMResponse>;
  abstract chatStream(params: ChatRequest): AsyncGenerator<string, LLMResponse>;

  // ─── Shared HTTP Utilities ──────────────────────────────────

  /**
   * POST JSON to an endpoint and return the parsed response.
   * Throws on non-2xx status with the error body.
   */
  protected async postJSON<T>(
    url: string,
    headers: Record<string, string>,
    body: unknown,
  ): Promise<T> {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `${this.name} API error (${response.status}): ${errorBody}`,
      );
    }

    return response.json() as Promise<T>;
  }

  /**
   * Stream SSE (Server-Sent Events) from an endpoint.
   * Yields parsed JSON data objects for each `data:` line.
   * Handles the `[DONE]` sentinel used by OpenAI-style streams.
   */
  protected async *streamSSE(
    url: string,
    headers: Record<string, string>,
    body: unknown,
  ): AsyncGenerator<unknown> {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `${this.name} API error (${response.status}): ${errorBody}`,
      );
    }

    if (!response.body) {
      throw new Error(`${this.name}: No response body for streaming request`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process complete SSE lines
        const lines = buffer.split('\n');
        // Keep the last potentially incomplete line in the buffer
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();

          // Skip empty lines and comments
          if (!trimmed || trimmed.startsWith(':')) continue;

          // Extract data from "data: {...}" lines
          if (trimmed.startsWith('data:')) {
            const data = trimmed.slice(5).trim();

            // OpenAI-style stream terminator
            if (data === '[DONE]') return;

            try {
              yield JSON.parse(data);
            } catch {
              // Non-JSON data line — skip
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  // ─── Helpers ────────────────────────────────────────────────

  /** Extract all text from ContentBlock array. */
  protected extractText(content: ContentBlock[]): string {
    return content
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map((b) => b.text)
      .join('');
  }
}
