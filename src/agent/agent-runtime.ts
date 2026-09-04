// ─── Agent Runtime ──────────────────────────────────────────────
// Thin orchestrator that composes the conversation loop, event bus,
// and subsystems. This replaces the monolithic AgentRuntime with a
// facade that delegates all real work to explicit subsystems.
//
// Phase 1: Extract Agent Runtime

import type { LLMProvider } from '../types/providers.js';
import type { Message } from '../types/messages.js';
import type { AgentConfig } from '../types/agent.js';
import type { ToolRegistry } from '../core/tool-registry.js';
import { EventBus } from '../events/event-bus.js';
import { ConversationLoop, type RunInput } from './conversation-loop.js';
import type { RunResult } from './turn-result.js';

// ─── AgentRuntime ───────────────────────────────────────────────

export class AgentRuntime {
  /** The event bus — subscribe here to observe runtime events. */
  readonly eventBus: EventBus;

  /** The conversation loop — owns iteration, model calls, tools. */
  private readonly loop: ConversationLoop;

  constructor(
    llm: LLMProvider,
    toolRegistry: ToolRegistry,
    config: AgentConfig,
  ) {
    this.eventBus = new EventBus();

    this.loop = new ConversationLoop({
      llm,
      toolRegistry,
      eventBus: this.eventBus,
      projectRoot: config.projectRoot,
      providerName: config.provider,
      modelName: config.model,
      maxIterations: config.maxIterations,
      dangerousCommands: config.dangerousCommands,
    });
  }

  // ─── Public API ─────────────────────────────────────────────

  /**
   * Run the agent on a user message.
   * This is the single entry point for all interfaces (REPL, API, etc.).
   */
  async run(input: RunInput): Promise<RunResult> {
    return this.loop.run(input);
  }

  /** Access conversation history (for REPL /clear, etc.). */
  get messages(): Message[] {
    return this.loop.messages;
  }

  set messages(msgs: Message[]) {
    this.loop.messages = msgs;
  }

  /** Cumulative token stats across the session. */
  get tokenStats(): { input: number; output: number } {
    return this.loop.tokenStats;
  }
}
