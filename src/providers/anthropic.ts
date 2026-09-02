// ─── Anthropic LLM Provider ─────────────────────────────────────
// Translates our internal types to/from Anthropic's Messages API.
// Uses raw fetch() via BaseProvider utilities.
//
// Endpoint: POST https://api.anthropic.com/v1/messages
// Auth: x-api-key header + anthropic-version header

import type {
  ContentBlock,
  LLMResponse,
  Message,
  StopReason,
  TextBlock,
} from '../types/messages.js';
import type { ChatRequest, ProviderConfig } from '../types/providers.js';

import { BaseProvider } from './base-provider.js';

// ─── Provider Implementation ────────────────────────────────────

export class AnthropicProvider extends BaseProvider {
  readonly name = 'anthropic';

  constructor(config: ProviderConfig) {
    super(config, 'https://api.anthropic.com');
  }

  // ─── Auth Headers ───────────────────────────────────────────

  private get authHeaders(): Record<string, string> {
    return {
      'x-api-key': this.apiKey,
      'anthropic-version': '2023-06-01',
    };
  }

  // ─── Public API ─────────────────────────────────────────────

  async chat(params: ChatRequest): Promise<LLMResponse> {
    const url = `${this.baseUrl}/v1/messages`;
    const body = this.buildRequestBody(params);
    const data = await this.postJSON<AnthropicResponse>(
      url,
      this.authHeaders,
      body,
    );

    return {
      content: data.content as ContentBlock[],
      stopReason: this.mapStopReason(data.stop_reason),
      usage: {
        inputTokens: data.usage?.input_tokens ?? 0,
        outputTokens: data.usage?.output_tokens ?? 0,
      },
    };
  }

  async *chatStream(
    params: ChatRequest,
  ): AsyncGenerator<string, LLMResponse> {
    const url = `${this.baseUrl}/v1/messages`;
    const body = { ...this.buildRequestBody(params), stream: true };

    // Track accumulated state across SSE events
    const blocks: ContentBlock[] = [];
    let stopReason: StopReason = 'end_turn';
    let inputTokens = 0;
    let outputTokens = 0;
    let toolInputBuffer = '';

    for await (const event of this.streamSSE(url, this.authHeaders, body)) {
      const data = event as AnthropicStreamEvent;

      switch (data.type) {
        case 'message_start':
          if (data.message?.usage) {
            inputTokens = data.message.usage.input_tokens ?? 0;
          }
          break;

        case 'content_block_start':
          if (data.content_block?.type === 'text') {
            blocks.push({ type: 'text', text: '' });
          } else if (data.content_block?.type === 'tool_use') {
            blocks.push({
              type: 'tool_use',
              id: data.content_block.id ?? '',
              name: data.content_block.name ?? '',
              input: {},
            });
            toolInputBuffer = '';
          }
          break;

        case 'content_block_delta':
          if (data.delta?.type === 'text_delta' && data.delta.text) {
            // Append to the current text block and yield the delta
            const currentBlock = blocks[blocks.length - 1];
            if (currentBlock && currentBlock.type === 'text') {
              (currentBlock as TextBlock).text += data.delta.text;
            }
            yield data.delta.text;
          } else if (
            data.delta?.type === 'input_json_delta' &&
            data.delta.partial_json
          ) {
            toolInputBuffer += data.delta.partial_json;
          }
          break;

        case 'content_block_stop': {
          // Parse accumulated tool input JSON
          const lastBlock = blocks[blocks.length - 1];
          if (lastBlock && lastBlock.type === 'tool_use' && toolInputBuffer) {
            try {
              lastBlock.input = JSON.parse(toolInputBuffer);
            } catch {
              lastBlock.input = {};
            }
            toolInputBuffer = '';
          }
          break;
        }

        case 'message_delta':
          if (data.delta?.stop_reason) {
            stopReason = this.mapStopReason(data.delta.stop_reason);
          }
          if (data.usage) {
            outputTokens = data.usage.output_tokens ?? outputTokens;
          }
          break;

        case 'error':
          throw new Error(
            `Anthropic stream error: ${JSON.stringify(data.error)}`,
          );
      }
    }

    return {
      content: blocks,
      stopReason,
      usage: { inputTokens, outputTokens },
    };
  }

  // ─── Request Body Builder ───────────────────────────────────

  private buildRequestBody(
    params: ChatRequest,
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: this.maxTokens,
      messages: this.mapMessages(params.messages),
    };

    if (params.systemPrompt) {
      body.system = params.systemPrompt;
    }

    if (params.tools && params.tools.length > 0) {
      body.tools = params.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema,
      }));
    }

    return body;
  }

  // ─── Message Mapping ────────────────────────────────────────
  // Anthropic's format is very close to ours. The main difference
  // is that Anthropic uses the same field names but at the API level.

  private mapMessages(messages: Message[]): unknown[] {
    return messages.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));
  }

  // ─── Stop Reason Mapping ────────────────────────────────────

  private mapStopReason(reason: string): StopReason {
    switch (reason) {
      case 'end_turn':
        return 'end_turn';
      case 'tool_use':
        return 'tool_use';
      case 'max_tokens':
        return 'max_tokens';
      default:
        return 'end_turn';
    }
  }
}

// ─── Anthropic API Response Types ───────────────────────────────

interface AnthropicResponse {
  content: unknown[];
  stop_reason: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}

interface AnthropicStreamEvent {
  type: string;
  message?: { usage?: { input_tokens?: number } };
  content_block?: {
    type: string;
    id?: string;
    name?: string;
    text?: string;
  };
  delta?: {
    type?: string;
    text?: string;
    partial_json?: string;
    stop_reason?: string;
  };
  usage?: { output_tokens?: number };
  error?: unknown;
}
