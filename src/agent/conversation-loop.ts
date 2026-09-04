// ─── Conversation Loop ──────────────────────────────────────────
// The Think → Act → Observe iteration machine, extracted from the
// monolithic AgentRuntime. Coordinates model calls, tool execution,
// and context management for a single run() invocation.
//
// Phase 1: Extract Agent Runtime

import type { LLMProvider, ChatRequest } from '../types/providers.js';
import type { Message, ContentBlock, LLMResponse } from '../types/messages.js';
import type { ToolOutput } from '../types/tools.js';
import type { ToolRegistry } from '../core/tool-registry.js';
import type { EventBus } from '../events/event-bus.js';
import type { RunResult } from './turn-result.js';
import { ConversationState } from '../core/conversation-state.js';
import { buildSystemPrompt } from '../core/context-builder.js';
import { PathSandbox } from '../safety/path-sandbox.js';
import { findDangerousPattern, confirmDangerousCommand } from '../safety/human-confirm.js';
import { throwIfAborted } from './cancellation.js';
import { CancellationError } from '../types/domain-types.js';
import ExecuteCommandTool from '../tools/execute-command.js';

// ─── Configuration ──────────────────────────────────────────────

export interface ConversationLoopConfig {
  /** LLM provider instance. */
  llm: LLMProvider;
  /** Tool registry with discovered tools. */
  toolRegistry: ToolRegistry;
  /** Event bus for runtime events. */
  eventBus: EventBus;
  /** Absolute path to the project root. */
  projectRoot: string;
  /** Provider name (for events). */
  providerName: string;
  /** Model name (for events). */
  modelName: string;
  /** Max iterations per run. */
  maxIterations: number;
  /** Dangerous command regex patterns. */
  dangerousCommands: string[];
}

export interface RunInput {
  /** The user's message. */
  message: string;
  /** Abort signal for cooperative cancellation. */
  signal?: AbortSignal;
}

// ─── ConversationLoop ───────────────────────────────────────────

export class ConversationLoop {
  private readonly config: ConversationLoopConfig;
  private readonly conversationState: ConversationState;
  private readonly sandbox: PathSandbox;

  private totalInputTokens = 0;
  private totalOutputTokens = 0;

  constructor(config: ConversationLoopConfig) {
    this.config = config;

    this.conversationState = new ConversationState({
      maxTokens: 80_000,
      minRecentMessages: 10,
    });

    this.sandbox = new PathSandbox(config.projectRoot);
    this.injectSafety();
  }

  // ─── Public API ─────────────────────────────────────────────

  /** Access the conversation history (for REPL /clear etc.) */
  get messages(): Message[] {
    return this.conversationState.messages;
  }

  set messages(msgs: Message[]) {
    this.conversationState.messages = msgs;
  }

  /** Cumulative token stats across the session. */
  get tokenStats(): { input: number; output: number } {
    return {
      input: this.totalInputTokens,
      output: this.totalOutputTokens,
    };
  }

  /**
   * Run the Think → Act → Observe loop for a user message.
   */
  async run(input: RunInput): Promise<RunResult> {
    const { message, signal } = input;
    const { toolRegistry, eventBus, maxIterations } = this.config;

    // Check for cancellation before starting
    throwIfAborted(signal);

    // Append user message
    this.conversationState.push({ role: 'user', content: message });

    const toolDefinitions = toolRegistry.getDefinitions();
    const hasTools = toolDefinitions.length > 0;
    let iterations = 0;

    for (let i = 0; i < maxIterations; i++) {
      iterations = i + 1;

      // Check for cancellation at the start of each iteration
      throwIfAborted(signal);

      eventBus.emit({ type: 'turn.started', turnIndex: i });

      // ── Build context ──────────────────────────────────────
      const systemPrompt = buildSystemPrompt({
        projectRoot: this.config.projectRoot,
        toolNames: hasTools ? toolRegistry.listTools() : undefined,
      });

      // ── Think: call LLM with streaming ─────────────────────
      eventBus.emit({
        type: 'model.started',
        provider: this.config.providerName,
        model: this.config.modelName,
      });

      let response: LLMResponse;
      try {
        response = await this.callLLMStreaming(
          {
            systemPrompt,
            messages: this.conversationState.messages,
            tools: hasTools ? toolDefinitions : undefined,
            signal,
          },
          eventBus,
          signal,
        );
      } catch (error) {
        if (
          error instanceof CancellationError ||
          (error instanceof DOMException && error.name === 'AbortError')
        ) {
          eventBus.emit({ type: 'agent.cancelled' });
          return {
            status: 'cancelled',
            totalUsage: { inputTokens: this.totalInputTokens, outputTokens: this.totalOutputTokens },
            iterations,
          };
        }
        throw error;
      }

      // Update token counts
      this.totalInputTokens += response.usage.inputTokens;
      this.totalOutputTokens += response.usage.outputTokens;

      eventBus.emit({ type: 'model.completed', usage: response.usage });

      // Append assistant response
      this.conversationState.push({ role: 'assistant', content: response.content });

      eventBus.emit({ type: 'turn.completed', turnIndex: i, stopReason: response.stopReason });

      // ── Done? ──────────────────────────────────────────────
      if (response.stopReason !== 'tool_use') {
        return {
          status: 'completed',
          totalUsage: { inputTokens: this.totalInputTokens, outputTokens: this.totalOutputTokens },
          iterations,
        };
      }

      // ── Act: execute tool calls ────────────────────────────
      const toolUseBlocks = response.content.filter(
        (b): b is Extract<ContentBlock, { type: 'tool_use' }> =>
          b.type === 'tool_use',
      );

      const toolResults = await this.executeToolCalls(toolUseBlocks, eventBus, signal);

      // ── Observe: append results ────────────────────────────
      this.conversationState.push({ role: 'user', content: toolResults });
    }

    // Hit the iteration cap
    eventBus.emit({ type: 'agent.max_iterations', limit: maxIterations });
    return {
      status: 'max_iterations',
      totalUsage: { inputTokens: this.totalInputTokens, outputTokens: this.totalOutputTokens },
      iterations,
    };
  }

  // ─── Private: LLM streaming call ───────────────────────────

  private async callLLMStreaming(
    params: ChatRequest,
    eventBus: EventBus,
    signal?: AbortSignal,
  ): Promise<LLMResponse> {
    throwIfAborted(signal);

    const stream = this.config.llm.chatStream(params);

    let result = await stream.next();
    while (!result.done) {
      throwIfAborted(signal);
      eventBus.emit({ type: 'model.delta', text: result.value });
      result = await stream.next();
    }

    return result.value;
  }

  // ─── Private: Execute tool calls ───────────────────────────

  private async executeToolCalls(
    toolCalls: Extract<ContentBlock, { type: 'tool_use' }>[],
    eventBus: EventBus,
    signal?: AbortSignal,
  ): Promise<ContentBlock[]> {
    const results: ContentBlock[] = [];

    for (const toolCall of toolCalls) {
      throwIfAborted(signal);

      // ── Safety gate for execute_command ──────────────────
      if (toolCall.name === 'execute_command') {
        const command = toolCall.input.command as string | undefined;
        if (command) {
          const match = findDangerousPattern(command, this.config.dangerousCommands);
          if (match) {
            // Emit approval request event
            const approvalId = `approval_${Date.now()}`;
            eventBus.emit({
              type: 'approval.requested',
              approvalId,
              command,
              matchedPattern: match,
            });

            const allowed = await confirmDangerousCommand({
              command,
              matchedPattern: match,
            });

            eventBus.emit({
              type: 'approval.resolved',
              approvalId,
              approved: allowed,
            });

            if (!allowed) {
              const result: ToolOutput = {
                content: '[BLOCKED] The user declined to run this command. Try a safer alternative.',
                is_error: true,
              };
              eventBus.emit({
                type: 'tool.completed',
                toolCallId: toolCall.id,
                name: toolCall.name,
                result,
              });
              results.push({
                type: 'tool_result',
                tool_use_id: toolCall.id,
                content: result.content,
                is_error: true,
              });
              continue;
            }
          }
        }
      }

      // ── Execute tool ─────────────────────────────────────
      eventBus.emit({
        type: 'tool.started',
        toolCallId: toolCall.id,
        name: toolCall.name,
        input: toolCall.input,
      });

      const output = await this.config.toolRegistry.execute(toolCall.name, toolCall.input);

      eventBus.emit({
        type: 'tool.completed',
        toolCallId: toolCall.id,
        name: toolCall.name,
        result: output,
      });

      results.push({
        type: 'tool_result',
        tool_use_id: toolCall.id,
        content: output.content,
        is_error: output.is_error,
      });
    }

    return results;
  }

  // ─── Private: Wire safety into tools ───────────────────────

  private injectSafety(): void {
    for (const name of this.config.toolRegistry.listTools()) {
      const tool = this.config.toolRegistry.get(name);
      if (!tool) continue;

      if (tool instanceof ExecuteCommandTool) {
        tool.projectRoot = this.config.projectRoot;
        tool.sandbox = this.sandbox;
      }

      if ('sandbox' in tool) {
        (tool as any).sandbox = this.sandbox;
      }
    }
  }
}
