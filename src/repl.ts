// ─── PπBot Interactive REPL ─────────────────────────────────────
// Terminal loop using @clack/prompts. Subscribes to AgentRuntime
// events instead of using direct callbacks — making the REPL a
// pure renderer of runtime state.
//
// Phase 1 refactor: REPL consumes EventBus events.

import * as p from '@clack/prompts';
import {
  getProviderRegistry,
  resolveApiKey,
  DEFAULT_MODELS,
} from './providers/provider-registry.js';
import type { LLMProvider } from './types/providers.js';
import { ToolRuntime } from './tools/tool-runtime.js';
import { AgentRuntime } from './agent/agent-runtime.js';
import type { AgentConfig } from './types/agent.js';
import type { AgentEvent } from './events/event-types.js';
import { getDatabase } from './storage/db.js';
import { SessionRepository } from './storage/session-repo.js';
import { join } from 'path';

// ─── REPL Options ───────────────────────────────────────────────

export interface ReplOptions {
  provider: string;
  model: string;
  apiKey: string;
  resumeSessionId?: string;
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
  llm: LLMProvider;
  runtime: AgentRuntime;
  toolRuntime: ToolRuntime;
  sessionRepo: SessionRepository;
  options: ReplOptions;
  unsubscribe: () => void;
  activeSessionId?: string;
}

function buildAgentConfig(options: ReplOptions): AgentConfig {
  return {
    provider: options.provider,
    model: options.model,
    maxIterations: options.maxIterations,
    maxTokens: options.maxTokens,
    projectRoot: options.projectRoot,
    dangerousCommands: [
      'rm\\s', 'sudo\\b', 'npm\\s+publish',
      'git\\s+push', 'git\\s+reset', 'chmod\\b',
      'curl\\b.*\\|\\s*sh', 'format\\b',
      'del\\s', 'rmdir\\s',
    ],
  };
}

// ─── Event-Driven REPL Renderer ─────────────────────────────────
// Instead of callback-based rendering, the REPL subscribes to the
// EventBus and renders events as they arrive.

function createEventRenderer(): {
  handler: (event: AgentEvent) => void;
  reset: () => void;
} {
  let spinner: ReturnType<typeof p.spinner> | null = null;
  let spinnerActive = false;
  let hadText = false;

  const stopSpinner = (message = '') => {
    if (spinnerActive && spinner) {
      spinner.stop(message);
      spinnerActive = false;
      spinner = null;
    }
  };

  const handler = (event: AgentEvent) => {
    switch (event.type) {
      case 'model.delta':
        stopSpinner();
        process.stdout.write(event.text);
        hadText = true;
        break;

      case 'tool.started': {
        stopSpinner();
        if (hadText) {
          process.stdout.write('\n');
          hadText = false;
        }
        const inputPreview = JSON.stringify(event.input);
        const truncated = inputPreview.length > 80
          ? inputPreview.slice(0, 77) + '...'
          : inputPreview;
        p.log.info(`🔧 ${event.name}(${truncated})`);
        spinner = p.spinner();
        spinner.start(`Running ${event.name}...`);
        spinnerActive = true;
        break;
      }

      case 'tool.completed': {
        const isError = event.result.is_error;
        stopSpinner(isError ? `❌ ${event.name} failed` : `✅ ${event.name} done`);
        const preview = event.result.content.length > 300
          ? event.result.content.slice(0, 297) + '...'
          : event.result.content;
        p.log.message(preview);
        // Start thinking spinner for next LLM call
        spinner = p.spinner();
        spinner.start('Thinking (follow-up)...');
        spinnerActive = true;
        break;
      }

      case 'turn.completed':
        if (hadText) {
          process.stdout.write('\n');
          hadText = false;
        }
        break;

      case 'agent.max_iterations':
        stopSpinner();
        p.log.warn(`Reached max iterations (${event.limit}). The agent stopped.`);
        break;

      case 'agent.cancelled':
        stopSpinner();
        p.log.warn('Operation cancelled.');
        break;

      case 'agent.error':
        stopSpinner();
        p.log.error(`Error: ${event.error.message}`);
        break;
    }
  };

  const reset = () => {
    stopSpinner();
    hadText = false;
  };

  return { handler, reset };
}

function createRuntime(
  llm: LLMProvider,
  toolRuntime: ToolRuntime,
  options: ReplOptions,
  sessionRepo: SessionRepository
): { runtime: AgentRuntime; unsubscribe: () => void } {
  const runtime = new AgentRuntime(llm, toolRuntime, buildAgentConfig(options), sessionRepo);
  const renderer = createEventRenderer();
  const unsubscribe = runtime.eventBus.on(renderer.handler);
  return { runtime, unsubscribe };
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
        state.runtime.messages = [];
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

        // Unsubscribe old event handler and create new runtime
        state.unsubscribe();
        const { runtime, unsubscribe } = createRuntime(state.llm, state.toolRuntime, {
          ...state.options,
          model: newModel,
        }, state.sessionRepo);
        state.runtime = runtime;
        state.unsubscribe = unsubscribe;

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

        // Unsubscribe old event handler and create new runtime
        state.unsubscribe();
        const { runtime, unsubscribe } = createRuntime(state.llm, state.toolRuntime, {
          ...state.options,
          provider: newProvider,
          model: newModel,
        }, state.sessionRepo);
        state.runtime = runtime;
        state.unsubscribe = unsubscribe;

        p.log.success(`Switched to ${newProvider} / ${newModel}`);
        return true;
      },
    },
    {
      name: '/tools',
      description: 'List registered tools',
      handler: async (_args, state) => {
        const tools = state.toolRuntime.listTools();
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
  const toolRuntime = new ToolRuntime();
  await toolRuntime.discoverBuiltinTools();

  // ── Initialize DB ───────────────────────────────────────────
  const dbDir = join(process.env.APPDATA || process.env.HOME || '.', '.pibot');
  const dbPath = join(dbDir, 'sessions.db');
  const db = getDatabase({ dbPath });
  const sessionRepo = new SessionRepository(db);

  // ── Create AgentRuntime (with EventBus subscription) ────────
  const { runtime, unsubscribe } = createRuntime(llm, toolRuntime, options, sessionRepo);

  // ── State ───────────────────────────────────────────────────
  const state: ReplState = {
    provider: options.provider,
    model: options.model,
    llm,
    runtime,
    toolRuntime,
    sessionRepo,
    options,
    unsubscribe,
    activeSessionId: options.resumeSessionId,
  };

  const slashCommands = createSlashCommands();

  // ── Welcome ─────────────────────────────────────────────────
  p.intro('🤖 PπBot v0.1.0');
  p.log.info(`Provider: ${state.provider} │ Model: ${state.model}`);
  p.log.info(`Project:  ${options.projectRoot}`);
  p.log.info(`Tools:    ${toolRuntime.listTools().join(', ') || 'none'}`);
  p.log.step('Type /help for commands, /exit or Ctrl+C to quit.\n');

  // ── Loop ────────────────────────────────────────────────────
  while (true) {
    const input = await p.text({
      message: '›',
      placeholder: 'Ask me anything...',
    });

    if (p.isCancel(input)) {
      p.cancel('Session cancelled.');
      state.unsubscribe();
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

    // ── Kick off the agent ──────────────────────────────────
    const s = p.spinner();
    s.start('Thinking...');

    // Create an AbortController for Ctrl+C cancellation
    const abortController = new AbortController();

    // Set up Ctrl+C handler for this run
    const onSigint = () => {
      abortController.abort(new Error('User cancelled'));
    };
    process.once('SIGINT', onSigint);

    try {
      // Stop initial spinner once first text/tool event arrives
      let spinnerStopped = false;
      const stopInitialSpinner = () => {
        if (!spinnerStopped) {
          s.stop('');
          spinnerStopped = true;
        }
      };

      // Subscribe to first event to stop the initial spinner
      const unsub = state.runtime.eventBus.onTypes(
        ['model.delta', 'tool.started', 'agent.error'],
        () => {
          stopInitialSpinner();
          unsub();
        },
      );

      const result = await state.runtime.run({
        message: trimmed,
        signal: abortController.signal,
        sessionId: state.activeSessionId,
      });

      if (result.sessionId) {
        state.activeSessionId = result.sessionId;
      }

      stopInitialSpinner();

      // Token stats
      const stats = state.runtime.tokenStats;
      p.log.step(`tokens: ${stats.input} in / ${stats.output} out`);

      if (result.status === 'cancelled') {
        p.log.warn('Run cancelled by user.');
      }
    } catch (error) {
      s.stop('Error');
      const message = error instanceof Error ? error.message : String(error);
      p.log.error(`Error: ${message}`);
      // Remove the failed user message to keep conversation clean
      const msgs = state.runtime.messages;
      if (msgs.length > 0 && msgs[msgs.length - 1].role === 'user') {
        state.runtime.messages = msgs.slice(0, -1);
      }
    } finally {
      process.removeListener('SIGINT', onSigint);
    }
  }

  state.unsubscribe();
  p.outro('Goodbye! 👋');
}
