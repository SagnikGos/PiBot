// ─── PπBot Interactive REPL ─────────────────────────────────────
// Terminal loop using @clack/prompts. Handles user input, streams
// LLM responses, dispatches slash commands, and runs the mini
// tool-call loop (Phase 2). In Phase 3, this delegates to AgentRuntime.

import * as p from '@clack/prompts';
import {
  getProviderRegistry,
  resolveApiKey,
  DEFAULT_MODELS,
} from './providers/provider-registry.js';
import type { LLMProvider } from './types/providers.js';
import type { Message, ContentBlock, LLMResponse } from './types/messages.js';
import { ToolRegistry } from './core/tool-registry.js';
import { buildSystemPrompt } from './core/context-builder.js';

// ─── REPL Options ───────────────────────────────────────────────

export interface ReplOptions {
  provider: string;
  model: string;
  apiKey: string;
  projectRoot: string;
  maxIterations: number;
  maxTokens: number;
}

// ─── Slash Commands ─────────────────────────────────────────────

interface SlashCommand {
  name: string;
  description: string;
  handler: (args: string, state: ReplState) => Promise<boolean>;
}

interface ReplState {
  provider: string;
  model: string;
  messages: Message[];
  llm: LLMProvider;
  toolRegistry: ToolRegistry;
  options: ReplOptions;
}

function createSlashCommands(): SlashCommand[] {
  return [
    {
      name: '/help',
      description: 'Show available commands',
      handler: async () => {
        const commands = createSlashCommands();
        const lines = commands.map(
          (c) => `  ${c.name.padEnd(20)} ${c.description}`,
        );
        p.note(lines.join('\n'), 'Available Commands');
        return true;
      },
    },
    {
      name: '/clear',
      description: 'Clear conversation history',
      handler: async (_args, state) => {
        state.messages = [];
        p.log.success('Conversation history cleared.');
        return true;
      },
    },
    {
      name: '/model',
      description: 'Switch model (e.g., /model gemini-2.5-pro)',
      handler: async (args, state) => {
        const newModel = args.trim();
        if (!newModel) {
          p.log.warn(`Current model: ${state.model}`);
          p.log.info('Usage: /model <model-name>');
          return true;
        }
        state.model = newModel;

        const registry = await getProviderRegistry();
        const apiKey = resolveApiKey(state.provider) ?? state.options.apiKey;
        state.llm = registry.create(state.provider, {
          apiKey,
          model: newModel,
          maxTokens: state.options.maxTokens,
        });

        p.log.success(`Switched to model: ${newModel}`);
        return true;
      },
    },
    {
      name: '/provider',
      description: 'Switch provider (e.g., /provider anthropic)',
      handler: async (args, state) => {
        const newProvider = args.trim().toLowerCase();
        if (!newProvider) {
          p.log.warn(`Current provider: ${state.provider}`);
          p.log.info('Usage: /provider <name>');
          return true;
        }

        const registry = await getProviderRegistry();
        if (!registry.has(newProvider)) {
          p.log.error(
            `Unknown provider "${newProvider}". Available: ${registry.listProviders().join(', ')}`,
          );
          return true;
        }

        const apiKey = resolveApiKey(newProvider);
        if (!apiKey) {
          p.log.error(
            `No API key set for "${newProvider}". Set ${newProvider.toUpperCase()}_API_KEY in .env`,
          );
          return true;
        }

        const newModel = DEFAULT_MODELS[newProvider] ?? state.model;
        state.provider = newProvider;
        state.model = newModel;
        state.llm = registry.create(newProvider, {
          apiKey,
          model: newModel,
          maxTokens: state.options.maxTokens,
        });

        p.log.success(`Switched to ${newProvider} / ${newModel}`);
        return true;
      },
    },
    {
      name: '/tools',
      description: 'List registered tools',
      handler: async (_args, state) => {
        const tools = state.toolRegistry.listTools();
        if (tools.length === 0) {
          p.log.warn('No tools registered.');
        } else {
          p.note(tools.map((t) => `  • ${t}`).join('\n'), `Tools (${tools.length})`);
        }
        return true;
      },
    },
    {
      name: '/exit',
      description: 'Exit the REPL',
      handler: async () => false,
    },
  ];
}

// ─── Main REPL Loop ─────────────────────────────────────────────

export async function startRepl(options: ReplOptions): Promise<void> {
  // ── Initialise provider ─────────────────────────────────────
  const providerRegistry = await getProviderRegistry();
  const llm = providerRegistry.create(options.provider, {
    apiKey: options.apiKey,
    model: options.model,
    maxTokens: options.maxTokens,
  });

  // ── Discover tools ──────────────────────────────────────────
  const toolRegistry = new ToolRegistry();
  await toolRegistry.discoverBuiltinTools();

  // ── State ───────────────────────────────────────────────────
  const state: ReplState = {
    provider: options.provider,
    model: options.model,
    messages: [],
    llm,
    toolRegistry,
    options,
  };

  const slashCommands = createSlashCommands();

  // ── Welcome ─────────────────────────────────────────────────
  p.intro('🤖 PπBot v0.1.0');
  p.log.info(`Provider: ${state.provider} │ Model: ${state.model}`);
  p.log.info(`Project:  ${options.projectRoot}`);
  p.log.info(`Tools:    ${toolRegistry.listTools().join(', ') || 'none'}`);
  p.log.step('Type /help for commands, /exit or Ctrl+C to quit.\n');

  // ── Loop ────────────────────────────────────────────────────
  while (true) {
    const input = await p.text({
      message: '›',
      placeholder: 'Ask me anything...',
    });

    // Handle Ctrl+C
    if (p.isCancel(input)) {
      p.cancel('Session cancelled.');
      process.exit(0);
    }

    const trimmed = input.trim();
    if (!trimmed) continue;

    // ── Slash commands ──────────────────────────────────────
    if (trimmed.startsWith('/')) {
      const spaceIdx = trimmed.indexOf(' ');
      const cmdName = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
      const cmdArgs = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1);

      const cmd = slashCommands.find((c) => c.name === cmdName.toLowerCase());
      if (cmd) {
        const shouldContinue = await cmd.handler(cmdArgs, state);
        if (!shouldContinue) break;
        continue;
      } else {
        p.log.warn(`Unknown command: ${cmdName}. Type /help for options.`);
        continue;
      }
    }

    // ── Send to LLM (with tool-call loop) ───────────────────
    state.messages.push({ role: 'user', content: trimmed });

    try {
      await runToolLoop(state, options);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      p.log.error(`Error: ${message}`);
      // Remove the failed user message so conversation stays clean
      state.messages.pop();
    }
  }

  p.outro('Goodbye! 👋');
}

// ─── Tool-Call Loop ─────────────────────────────────────────────
// Sends the conversation to the LLM. If the LLM responds with
// tool_use, executes the tools, appends results, and loops back.
// Continues until the LLM responds with end_turn or max_tokens,
// or we hit the iteration limit.

async function runToolLoop(
  state: ReplState,
  options: ReplOptions,
): Promise<void> {
  const maxIterations = options.maxIterations;
  const toolDefinitions = state.toolRegistry.getDefinitions();
  const hasTools = toolDefinitions.length > 0;

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const s = p.spinner();
    s.start(iteration === 0 ? 'Thinking...' : 'Thinking (follow-up)...');

    const systemPrompt = buildSystemPrompt({
      projectRoot: options.projectRoot,
      toolNames: hasTools ? state.toolRegistry.listTools() : undefined,
    });

    // ── Call LLM with streaming ───────────────────────────────
    const stream = state.llm.chatStream({
      systemPrompt,
      messages: state.messages,
      tools: hasTools ? toolDefinitions : undefined,
    });

    let fullText = '';
    let firstChunk = true;

    // Consume stream — yield text deltas to terminal
    let result = await stream.next();
    while (!result.done) {
      if (firstChunk) {
        s.stop('');
        firstChunk = false;
      }
      const delta = result.value;
      process.stdout.write(delta);
      fullText += delta;
      result = await stream.next();
    }

    const response: LLMResponse = result.value;

    // If spinner never stopped (no text streamed), stop it now
    if (firstChunk) {
      s.stop('');
      // Extract any text from the non-streamed response
      for (const block of response.content) {
        if (block.type === 'text' && block.text) {
          fullText += block.text;
          process.stdout.write(block.text);
        }
      }
    }

    if (fullText) {
      process.stdout.write('\n');
    }

    // ── Append assistant response to history ──────────────────
    state.messages.push({ role: 'assistant', content: response.content });

    // ── Check if we're done (no tool calls) ───────────────────
    if (response.stopReason !== 'tool_use') {
      if (fullText) process.stdout.write('\n');
      p.log.step(
        `tokens: ${response.usage.inputTokens} in / ${response.usage.outputTokens} out` +
          (iteration > 0 ? ` │ steps: ${iteration + 1}` : ''),
      );
      return;
    }

    // ── Execute tool calls ────────────────────────────────────
    const toolUseBlocks = response.content.filter(
      (b): b is Extract<ContentBlock, { type: 'tool_use' }> =>
        b.type === 'tool_use',
    );

    const toolResults: ContentBlock[] = [];

    for (const toolCall of toolUseBlocks) {
      // Show what tool is being called
      const inputPreview = JSON.stringify(toolCall.input);
      const truncatedInput =
        inputPreview.length > 80
          ? inputPreview.slice(0, 77) + '...'
          : inputPreview;

      p.log.info(`🔧 ${toolCall.name}(${truncatedInput})`);

      const toolSpinner = p.spinner();
      toolSpinner.start(`Running ${toolCall.name}...`);

      // Execute the tool
      const toolOutput = await state.toolRegistry.execute(
        toolCall.name,
        toolCall.input,
      );

      if (toolOutput.is_error) {
        toolSpinner.stop(`❌ ${toolCall.name} failed`);
        // Show error content (truncated)
        const errorPreview =
          toolOutput.content.length > 200
            ? toolOutput.content.slice(0, 197) + '...'
            : toolOutput.content;
        p.log.warn(errorPreview);
      } else {
        toolSpinner.stop(`✅ ${toolCall.name} done`);
        // Show result preview (truncated for long outputs)
        const resultPreview =
          toolOutput.content.length > 300
            ? toolOutput.content.slice(0, 297) + '...'
            : toolOutput.content;
        p.log.message(resultPreview);
      }

      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolCall.id,
        content: toolOutput.content,
        is_error: toolOutput.is_error,
      });
    }

    // ── Append tool results to history ────────────────────────
    state.messages.push({ role: 'user', content: toolResults });

    // Loop back → LLM sees the tool results and continues
  }

  // If we exhausted iterations
  p.log.warn(
    `Reached maximum iterations (${maxIterations}). The agent stopped.`,
  );
}
