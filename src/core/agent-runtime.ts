// ─── Agent Runtime ───────────────────────────────────────────────
// The autonomous Think → Act → Observe loop.
//
// Phase 4 additions:
//   - ConversationState: token-aware history pruning
//   - Human confirmation: dangerous command patterns gated by Y/n prompt
//   - PathSandbox: injected into all file-touching tools at startup

import type { LLMProvider } from '../types/providers.js';
import type { Message, ContentBlock, LLMResponse } from '../types/messages.js';
import type { AgentConfig, AgentState } from '../types/agent.js';
import type { ToolDefinition } from '../types/tools.js';
import type { ToolRegistry } from './tool-registry.js';
import { buildSystemPrompt } from './context-builder.js';
import { ConversationState } from './conversation-state.js';
import { PathSandbox } from '../safety/path-sandbox.js';
import { findDangerousPattern, confirmDangerousCommand } from '../safety/human-confirm.js';
import ExecuteCommandTool from '../tools/execute-command.js';

// ─── Runtime Event Callbacks ────────────────────────────────────

export interface AgentRuntimeCallbacks {
  /** Called for each streamed text chunk from the LLM */
  onTextDelta: (delta: string) => void;
  /** Called when a tool is about to be executed */
  onToolStart: (name: string, input: Record<string, unknown>) => void;
  /** Called when a tool finishes */
  onToolEnd: (name: string, output: string, isError: boolean) => void;
  /** Called when the loop completes a full LLM response */
  onIterationEnd: (iteration: number, stopReason: string) => void;
  /** Called when max iterations is reached */
  onMaxIterations: (limit: number) => void;
}

// ─── AgentRuntime ───────────────────────────────────────────────

export class AgentRuntime {
  private agentState: AgentState;
  private readonly conversationState: ConversationState;
  private readonly sandbox: PathSandbox;

  constructor(
    private readonly llm: LLMProvider,
    private readonly toolRegistry: ToolRegistry,
    private readonly config: AgentConfig,
    private readonly callbacks: AgentRuntimeCallbacks,
  ) {
    this.agentState = {
      messages: [],
      iterationCount: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      status: 'idle',
    };

    this.conversationState = new ConversationState({
      maxTokens: 80_000,
      minRecentMessages: 10,
    });

    this.sandbox = new PathSandbox(config.projectRoot);

    // Wire safety into all tools at startup
    this.injectSafety();
  }

  // ─── Public API ─────────────────────────────────────────────

  /** The full conversation history (for REPL /clear etc.) */
  get messages(): Message[] {
    return this.conversationState.messages;
  }

  set messages(msgs: Message[]) {
    this.conversationState.messages = msgs;
    this.agentState.messages = msgs;
  }

  /** Cumulative token stats across the session. */
  get tokenStats(): { input: number; output: number } {
    return {
      input: this.agentState.totalInputTokens,
      output: this.agentState.totalOutputTokens,
    };
  }

  /**
   * Run the agent on a user message.
   * Drives the Think → Act → Observe loop until end_turn or max iterations.
   */
  async run(userMessage: string): Promise<void> {
    this.conversationState.push({ role: 'user', content: userMessage });
    this.agentState.status = 'thinking';

    const toolDefinitions = this.toolRegistry.getDefinitions();
    const hasTools = toolDefinitions.length > 0;

    for (let i = 0; i < this.config.maxIterations; i++) {
      this.agentState.iterationCount++;

      const systemPrompt = buildSystemPrompt({
        projectRoot: this.config.projectRoot,
        toolNames: hasTools ? this.toolRegistry.listTools() : undefined,
      });

      // ── Think: stream LLM response ─────────────────────────
      this.agentState.status = 'thinking';
      const response = await this.callLLMStreaming({
        systemPrompt,
        messages: this.conversationState.messages,
        tools: hasTools ? toolDefinitions : undefined,
      });

      this.agentState.totalInputTokens += response.usage.inputTokens;
      this.agentState.totalOutputTokens += response.usage.outputTokens;

      this.conversationState.push({ role: 'assistant', content: response.content });
      this.callbacks.onIterationEnd(i + 1, response.stopReason);

      // ── Done? ────────────────────────────────────────────────
      if (response.stopReason !== 'tool_use') {
        this.agentState.status = 'done';
        return;
      }

      // ── Act: execute tool calls ─────────────────────────────
      this.agentState.status = 'tool_calling';

      const toolUseBlocks = response.content.filter(
        (b): b is Extract<ContentBlock, { type: 'tool_use' }> =>
          b.type === 'tool_use',
      );

      const toolResults: ContentBlock[] = [];

      for (const toolCall of toolUseBlocks) {
        // ── Safety gate for execute_command ──────────────────
        if (toolCall.name === 'execute_command') {
          const command = toolCall.input.command as string | undefined;
          if (command) {
            const match = findDangerousPattern(command, this.config.dangerousCommands);
            if (match) {
              const allowed = await confirmDangerousCommand({
                command,
                matchedPattern: match,
              });
              if (!allowed) {
                this.callbacks.onToolEnd(
                  toolCall.name,
                  '[BLOCKED] Command was blocked by the user.',
                  true,
                );
                toolResults.push({
                  type: 'tool_result',
                  tool_use_id: toolCall.id,
                  content: '[BLOCKED] The user declined to run this command. Try a safer alternative.',
                  is_error: true,
                });
                continue;
              }
            }
          }
        }

        this.callbacks.onToolStart(toolCall.name, toolCall.input);

        const output = await this.toolRegistry.execute(toolCall.name, toolCall.input);

        this.callbacks.onToolEnd(toolCall.name, output.content, output.is_error);

        // ── Observe: append tool result ──────────────────────
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolCall.id,
          content: output.content,
          is_error: output.is_error,
        });
      }

      // Append tool results — ConversationState handles pruning
      this.conversationState.push({ role: 'user', content: toolResults });
    }

    // Hit the iteration cap
    this.agentState.status = 'max_iterations';
    this.callbacks.onMaxIterations(this.config.maxIterations);
  }

  // ─── Private: LLM streaming call ───────────────────────────

  private async callLLMStreaming(params: {
    systemPrompt: string;
    messages: Message[];
    tools?: ToolDefinition[];
  }): Promise<LLMResponse> {
    const stream = this.llm.chatStream(params);

    let result = await stream.next();
    while (!result.done) {
      this.callbacks.onTextDelta(result.value);
      result = await stream.next();
    }

    return result.value;
  }

  // ─── Private: Wire safety into tools ────────────────────────
  // Called once at construction. Injects sandbox + projectRoot into
  // tools that need it. Tools are discovered dynamically so we check
  // by instance type.

  private injectSafety(): void {
    for (const name of this.toolRegistry.listTools()) {
      const tool = this.toolRegistry.get(name);
      if (!tool) continue;

      // Execute command: inject project root for cwd
      if (tool instanceof ExecuteCommandTool) {
        tool.projectRoot = this.config.projectRoot;
        tool.sandbox = this.sandbox;
      }

      // File tools: inject sandbox
      if ('sandbox' in tool) {
        (tool as any).sandbox = this.sandbox;
      }
    }
  }
}
