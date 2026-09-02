// ─── Gemini LLM Provider ────────────────────────────────────────
// Translates our internal types to/from Google's Generative
// Language REST API. Uses raw fetch() via BaseProvider utilities.
//
// Endpoints:
//   POST /v1beta/models/{model}:generateContent?key={apiKey}
//   POST /v1beta/models/{model}:streamGenerateContent?key={apiKey}&alt=sse

import type {
  ContentBlock,
  LLMResponse,
  Message,
  StopReason,
  ToolUseBlock,
} from '../types/messages.js';
import type { ChatRequest, ProviderConfig } from '../types/providers.js';
import type { ToolDefinition } from '../types/tools.js';
import { BaseProvider } from './base-provider.js';

// ─── Gemini API Types (minimal, just what we need) ──────────────

interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args: Record<string, unknown> };
  functionResponse?: { name: string; response: { result: string } };
}

interface GeminiContent {
  role: string;
  parts: GeminiPart[];
}

interface GeminiCandidate {
  content?: { parts?: GeminiPart[] };
  finishReason?: string;
}

interface GeminiResponse {
  candidates?: GeminiCandidate[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  };
}

// ─── Provider Implementation ────────────────────────────────────

export class GeminiProvider extends BaseProvider {
  readonly name = 'gemini';

  constructor(config: ProviderConfig) {
    super(config, 'https://generativelanguage.googleapis.com');
  }

  // ─── Public API ─────────────────────────────────────────────

  async chat(params: ChatRequest): Promise<LLMResponse> {
    const url = `${this.baseUrl}/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;
    const body = this.buildRequestBody(params);
    const data = await this.postJSON<GeminiResponse>(url, {}, body);
    return this.mapResponse(data);
  }

  async *chatStream(
    params: ChatRequest,
  ): AsyncGenerator<string, LLMResponse> {
    const url = `${this.baseUrl}/v1beta/models/${this.model}:streamGenerateContent?key=${this.apiKey}&alt=sse`;
    const body = this.buildRequestBody(params);

    let fullText = '';
    const functionCallParts: any[] = [];
    let finishReason = '';
    let promptTokenCount = 0;
    let candidatesTokenCount = 0;

    for await (const chunk of this.streamSSE(url, {}, body)) {
      const data = chunk as GeminiResponse;
      const candidate = data.candidates?.[0];

      if (candidate?.content?.parts) {
        for (const part of candidate.content.parts) {
          if (part.text !== undefined) {
            fullText += part.text;
            yield part.text;
          } else if (part.functionCall) {
            functionCallParts.push(part);
          }
        }
      }

      if (candidate?.finishReason) {
        finishReason = candidate.finishReason;
      }

      if (data.usageMetadata) {
        promptTokenCount = data.usageMetadata.promptTokenCount ?? promptTokenCount;
        candidatesTokenCount = data.usageMetadata.candidatesTokenCount ?? candidatesTokenCount;
      }
    }

    // ── Assemble final response ──────────────────────────────
    const content: ContentBlock[] = [];

    if (fullText) {
      content.push({ type: 'text', text: fullText });
    }

    let hasToolUse = false;
    for (let i = 0; i < functionCallParts.length; i++) {
      hasToolUse = true;
      const part = functionCallParts[i];
      content.push({
        type: 'tool_use',
        id: `call_${Date.now()}_${i}`,
        name: part.functionCall.name,
        input: part.functionCall.args ?? {},
        metadata: part,
      });
    }

    let stopReason: StopReason = 'end_turn';
    if (hasToolUse) {
      stopReason = 'tool_use';
    } else if (finishReason === 'MAX_TOKENS') {
      stopReason = 'max_tokens';
    }

    return {
      content,
      stopReason,
      usage: {
        inputTokens: promptTokenCount,
        outputTokens: candidatesTokenCount,
      },
    };
  }

  // ─── Request Body Builder ───────────────────────────────────

  private buildRequestBody(params: ChatRequest): Record<string, unknown> {
    const body: Record<string, unknown> = {
      contents: this.mapMessages(params.messages),
      generationConfig: {
        maxOutputTokens: this.maxTokens,
      },
    };

    // System prompt → systemInstruction
    if (params.systemPrompt) {
      body.systemInstruction = {
        parts: [{ text: params.systemPrompt }],
      };
    }

    // Tool definitions → functionDeclarations
    const tools = this.mapToolDefinitions(params.tools);
    if (tools) {
      body.tools = tools;
      body.toolConfig = {
        functionCallingConfig: { mode: 'AUTO' },
      };
    }

    return body;
  }

  // ─── Type Mapping: Our Messages → Gemini Contents ───────────

  private mapMessages(messages: Message[]): GeminiContent[] {
    const contents: GeminiContent[] = [];

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      const role = msg.role === 'assistant' ? 'model' : 'user';
      const parts: GeminiPart[] = [];

      if (typeof msg.content === 'string') {
        parts.push({ text: msg.content });
      } else {
        for (const block of msg.content) {
          if (block.type === 'text') {
            parts.push({ text: block.text });
          } else if (block.type === 'tool_use') {
            parts.push({
              ...(block.metadata || {}),
              functionCall: {
                ...(block.metadata?.functionCall || {}),
                name: block.name,
                args: block.input,
              },
            });
          } else if (block.type === 'tool_result') {
            // Gemini needs the function name for tool results.
            // Look backwards through messages to find the matching tool_use.
            const functionName = this.findToolName(messages, i, block.tool_use_id);
            parts.push({
              functionResponse: {
                name: functionName,
                response: {
                  result: block.content,
                },
              },
            });
          }
        }
      }

      if (parts.length > 0) {
        contents.push({ role, parts });
      }
    }

    return contents;
  }

  /**
   * Find the tool name by walking backwards through messages to find
   * the tool_use block with the matching ID.
   */
  private findToolName(
    messages: Message[],
    currentIndex: number,
    toolUseId: string,
  ): string {
    for (let j = currentIndex - 1; j >= 0; j--) {
      const prevMsg = messages[j];
      if (prevMsg.role === 'assistant' && Array.isArray(prevMsg.content)) {
        const found = prevMsg.content.find(
          (b): b is ToolUseBlock =>
            b.type === 'tool_use' && b.id === toolUseId,
        );
        if (found) return found.name;
      }
    }
    return 'unknown_function';
  }

  // ─── Type Mapping: Our ToolDefinitions → Gemini Tools ───────

  private mapToolDefinitions(
    tools?: ToolDefinition[],
  ): Array<{ functionDeclarations: unknown[] }> | undefined {
    if (!tools || tools.length === 0) return undefined;

    return [
      {
        functionDeclarations: tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.input_schema,
        })),
      },
    ];
  }

  // ─── Response Mapping: Gemini → Our LLMResponse ─────────────

  private mapResponse(data: GeminiResponse): LLMResponse {
    const candidate = data.candidates?.[0];
    const parts = candidate?.content?.parts ?? [];

    const content: ContentBlock[] = [];
    let hasToolUse = false;

    parts.forEach((part, index) => {
      if (part.text !== undefined) {
        content.push({ type: 'text', text: part.text });
      } else if (part.functionCall) {
        hasToolUse = true;
        content.push({
          type: 'tool_use',
          id: `call_${Date.now()}_${index}`,
          name: part.functionCall.name,
          input: part.functionCall.args ?? {},
          metadata: part,
        });
      }
    });

    let stopReason: StopReason = 'end_turn';
    if (hasToolUse) {
      stopReason = 'tool_use';
    } else if (candidate?.finishReason === 'MAX_TOKENS') {
      stopReason = 'max_tokens';
    }

    return {
      content,
      stopReason,
      usage: {
        inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
      },
    };
  }
}
