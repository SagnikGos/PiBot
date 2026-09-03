// ─── PπBot Interactive REPL ─────────────────────────────────────
// Terminal loop using @clack/prompts. Handles user input, streams
// LLM responses, and delegates the agent loop to AgentRuntime.

import * as p from '@clack/prompts';
import {
  getProviderRegistry,
  resolveApiKey,
  DEFAULT_MODELS,
} from './providers/provider-registry.js';
import type { LLMProvider } from './types/providers.js';
import { ToolRegistry } from './core/tool-registry.js';
import { AgentRuntime } from './core/agent-runtime.js';
import type { AgentConfig } from './types/agent.js';

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
  llm: LLMProvider;
  runtime: AgentRuntime;
  toolRegistry: ToolRegistry;
  options: ReplOptions;
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

function createRuntime(
  llm: LLMProvider,
  toolRegistry: ToolRegistry,
  options: ReplOptions,
): AgentRuntime {
  let spinner: ReturnType<typeof p.spinner> | null = null;
  let spinnerActive = false;
  let hadText = false;

  return new AgentRuntime(llm, toolRegistry, buildAgentConfig(options), {
    onTextDelta: (delta) => {
      if (spinnerActive && spinner) {
        spinner.stop('');
        spinnerActive = false;
      }
      process.stdout.write(delta);
      hadText = true;
    },

    onToolStart: (name, input) => {
      if (spinnerActive && spinner) {
        spinner.stop('');
        spinnerActive = false;
      }
      if (hadText) {
        process.stdout.write('\n');
        hadText = false;
      }
      const inputPreview = JSON.stringify(input);
      const truncated = inputPreview.length > 80
        ? inputPreview.slice(0, 77) + '...'
        : inputPreview;
      p.log.info(`🔧 ${name}(${truncated})`);
      spinner = p.spinner();
      spinner.start(`Running ${name}...`);
      spinnerActive = true;
    },

    onToolEnd: (name, output, isError) => {
      if (spinner) {
        spinner.stop(isError ? `❌ ${name} failed` : `✅ ${name} done`);
        spinnerActive = false;
        spinner = null;
      }
      const preview = output.length > 300
        ? output.slice(0, 297) + '...'
        : output;
      p.log.message(preview);
      // Start thinking spinner for next LLM call
      spinner = p.spinner();
      spinner.start('Thinking (follow-up)...');
      spinnerActive = true;
    },

    onIterationEnd: (_iteration, _stopReason) => {
      if (hadText) {
        process.stdout.write('\n');
        hadText = false;
      }
    },

    onMaxIterations: (limit) => {
      if (spinnerActive && spinner) {
        spinner.stop('');
        spinnerActive = false;
      }
      p.log.warn(`Reached max iterations (${limit}). The agent stopped.`);
    },
  });
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
        state.runtime = createRuntime(state.llm, state.toolRegistry, {
          ...state.options,
          model: newModel,
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
        state.runtime = createRuntime(state.llm, state.toolRegistry, {
          ...state.options,
          provider: newProvider,
          model: newModel,
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

  // ── Create AgentRuntime ─────────────────────────────────────
  const runtime = createRuntime(llm, toolRegistry, options);

  // ── State ───────────────────────────────────────────────────
  const state: ReplState = {
    provider: options.provider,
    model: options.model,
    llm,
    runtime,
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

    // ── Kick off the agent ──────────────────────────────────
    const s = p.spinner();
    s.start('Thinking...');

    try {
      // Stop the "Thinking..." spinner once first text arrives
      // The runtime callbacks handle the rest of the UI
      let spinnerStopped = false;

      // Patch: stop the initial spinner on first text/tool event
      // We do this by intercepting — the runtime's callbacks already handle it.
      // The spinner started above is stopped by the first callback.
      // Trick: wrap the runtime so it stops our spinner first.
      const wrappedRuntime = {
        run: async (msg: string) => {
          const stopInitialSpinner = () => {
            if (!spinnerStopped) {
              s.stop('');
              spinnerStopped = true;
            }
          };
          // We need to hook into the first onTextDelta / onToolStart
          // The AgentRuntime calls its own callbacks — we can't easily intercept.
          // Solution: stop the spinner in a microtask race.
          const runPromise = state.runtime.run(msg);
          // Stop spinner after a short delay if callbacks haven't already
          setTimeout(stopInitialSpinner, 100);
          await runPromise;
          stopInitialSpinner();
        },
      };

      await wrappedRuntime.run(trimmed);

      // Token stats
      const stats = state.runtime.tokenStats;
      p.log.step(`tokens: ${stats.input} in / ${stats.output} out`);
    } catch (error) {
      s.stop('Error');
      const message = error instanceof Error ? error.message : String(error);
      p.log.error(`Error: ${message}`);
      // Remove the failed user message to keep conversation clean
      const msgs = state.runtime.messages;
      if (msgs.length > 0 && msgs[msgs.length - 1].role === 'user') {
        state.runtime.messages = msgs.slice(0, -1);
      }
    }
  }

  p.outro('Goodbye! 👋');
}
