// ─── OpenAI LLM Provider ────────────────────────────────────────
// Translates our internal types to/from OpenAI's Chat Completions API.
// Uses raw fetch() via BaseProvider utilities.
//
// Endpoint: POST https://api.openai.com/v1/chat/completions
// Auth: Authorization: Bearer {apiKey}

import type {
  ContentBlock,
  LLMResponse,
  Message,
  StopReason,
} from '../types/messages.js';
import type { ChatRequest, ProviderConfig } from '../types/providers.js';
import type { ToolDefinition } from '../types/tools.js';
import { BaseProvider } from './base-provider.js';

// ─── OpenAI API Types ───────────────────────────────────────────

interface OpenAIMessage {
  role: string;
  content?: string | null;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

// ─── Provider Implementation ────────────────────────────────────

export class OpenAIProvider extends BaseProvider {
  readonly name = 'openai';

  constructor(config: ProviderConfig) {
    super(config, 'https://api.openai.com');
  }

  // ─── Auth Headers ───────────────────────────────────────────

  private get authHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
    };
  }

  // ─── Public API ─────────────────────────────────────────────

  async chat(params: ChatRequest): Promise<LLMResponse> {
    const url = `${this.baseUrl}/v1/chat/completions`;
    const body = this.buildRequestBody(params);

    const data = await this.postJSON<OpenAIChatResponse>(
      url,
      this.authHeaders,
      body,
    );

    const choice = data.choices[0];
    const content: ContentBlock[] = [];

    if (choice.message.content) {
      content.push({ type: 'text', text: choice.message.content });
    }

    if (choice.message.tool_calls) {
      for (const tc of choice.message.tool_calls) {
        content.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.function.name,
          input: JSON.parse(tc.function.arguments || '{}'),
        });
      }
    }

    return {
      content: content.length > 0 ? content : [{ type: 'text', text: '' }],
      stopReason: this.mapStopReason(choice.finish_reason),
      usage: {
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
      },
    };
  }

  async *chatStream(
    params: ChatRequest,
  ): AsyncGenerator<string, LLMResponse> {
    const url = `${this.baseUrl}/v1/chat/completions`;
    const body = {
      ...this.buildRequestBody(params),
      stream: true,
      stream_options: { include_usage: true },
    };

    let fullText = '';
    const toolCallsMap = new Map<
      number,
      { id: string; name: string; arguments: string }
    >();
    let stopReason: StopReason = 'end_turn';
    let inputTokens = 0;
    let outputTokens = 0;

    for await (const chunk of this.streamSSE(url, this.authHeaders, body)) {
      const data = chunk as OpenAIStreamChunk;

      // Usage-only chunk (sent at the end with stream_options)
      if (data.usage) {
        inputTokens = data.usage.prompt_tokens ?? inputTokens;
        outputTokens = data.usage.completion_tokens ?? outputTokens;
      }

      const choice = data.choices?.[0];
      if (!choice) continue;

      const delta = choice.delta;

      // Stream text content
      if (delta?.content) {
        fullText += delta.content;
        yield delta.content;
      }

      // Accumulate tool call chunks
      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          const index = tc.index;
          if (!toolCallsMap.has(index)) {
            toolCallsMap.set(index, { id: '', name: '', arguments: '' });
          }
          const call = toolCallsMap.get(index)!;
          if (tc.id) call.id = tc.id;
          if (tc.function?.name) call.name = tc.function.name;
          if (tc.function?.arguments) call.arguments += tc.function.arguments;
        }
      }

      // Capture finish reason
      if (choice.finish_reason) {
        stopReason = this.mapStopReason(choice.finish_reason);
      }
    }

    // ── Assemble final response ──────────────────────────────
    const content: ContentBlock[] = [];

    if (fullText) {
      content.push({ type: 'text', text: fullText });
    }

    for (const call of toolCallsMap.values()) {
      if (call.id && call.name) {
        content.push({
          type: 'tool_use',
          id: call.id,
          name: call.name,
          input: JSON.parse(call.arguments || '{}'),
        });
      }
    }

    return {
      content: content.length > 0 ? content : [{ type: 'text', text: '' }],
      stopReason,
      usage: { inputTokens, outputTokens },
    };
  }

  // ─── Request Body Builder ───────────────────────────────────

  private buildRequestBody(params: ChatRequest): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: this.maxTokens,
      messages: this.mapMessages(params.messages, params.systemPrompt),
    };

    const tools = this.mapToolDefinitions(params.tools);
    if (tools) {
      body.tools = tools;
      body.tool_choice = 'auto';
    }

    return body;
  }

  // ─── Message Mapping: Our types → OpenAI format ─────────────
  // Key differences from our format:
  // - System prompt is a message, not a separate field
  // - tool_result → { role: 'tool', tool_call_id, content }
  // - tool_use → { role: 'assistant', tool_calls: [...] }

  private mapMessages(
    messages: Message[],
    systemPrompt?: string,
  ): OpenAIMessage[] {
    const result: OpenAIMessage[] = [];

    if (systemPrompt) {
      result.push({ role: 'system', content: systemPrompt });
    }

    for (const msg of messages) {
      if (msg.role === 'user') {
        if (typeof msg.content === 'string') {
          result.push({ role: 'user', content: msg.content });
        } else {
          // Handle mixed content blocks (text + tool_results)
          let textContent = '';

          for (const block of msg.content) {
            if (block.type === 'text') {
              textContent += block.text;
            } else if (block.type === 'tool_result') {
              // Each tool_result becomes a separate { role: 'tool' } message
              result.push({
                role: 'tool',
                tool_call_id: block.tool_use_id,
                content: block.content,
              });
            }
          }

          if (textContent) {
            result.push({ role: 'user', content: textContent });
          }
        }
      } else if (msg.role === 'assistant') {
        if (typeof msg.content === 'string') {
          result.push({ role: 'assistant', content: msg.content });
        } else {
          const toolCalls: OpenAIMessage['tool_calls'] = [];
          let textContent = '';

          for (const block of msg.content) {
            if (block.type === 'text') {
              textContent += block.text;
            } else if (block.type === 'tool_use') {
              toolCalls.push({
                id: block.id,
                type: 'function',
                function: {
                  name: block.name,
                  arguments: JSON.stringify(block.input),
                },
              });
            }
          }

          const assistantMsg: OpenAIMessage = {
            role: 'assistant',
            content: textContent || null,
          };

          if (toolCalls.length > 0) {
            assistantMsg.tool_calls = toolCalls;
          }

          result.push(assistantMsg);
        }
      }
    }

    return result;
  }

  // ─── Tool Definition Mapping ────────────────────────────────

  private mapToolDefinitions(
    tools?: ToolDefinition[],
  ): Array<{ type: string; function: unknown }> | undefined {
    if (!tools || tools.length === 0) return undefined;

    return tools.map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      },
    }));
  }

  // ─── Stop Reason Mapping ────────────────────────────────────

  private mapStopReason(reason: string | null): StopReason {
    switch (reason) {
      case 'stop':
        return 'end_turn';
      case 'tool_calls':
        return 'tool_use';
      case 'length':
        return 'max_tokens';
      default:
        return 'end_turn';
    }
  }
}

// ─── OpenAI Response Types ──────────────────────────────────────

interface OpenAIChatResponse {
  choices: Array<{
    message: {
      content?: string | null;
      tool_calls?: Array<{
        id: string;
        function: { name: string; arguments: string };
      }>;
    };
    finish_reason: string;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

interface OpenAIStreamChunk {
  choices?: Array<{
    delta?: {
      content?: string;
      tool_calls?: Array<{
        index: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}
