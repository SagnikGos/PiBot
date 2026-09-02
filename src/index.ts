#!/usr/bin/env node

// ─── PπBot CLI Entry Point ──────────────────────────────────────
// Parses command-line arguments via Commander.js, loads environment
// variables, and launches the interactive REPL.

import { Command } from 'commander';
import dotenv from 'dotenv';
import { resolve } from 'path';
import { startRepl } from './repl.js';
import {
  getProviderRegistry,
  resolveApiKey,
  DEFAULT_MODELS,
} from './providers/provider-registry.js';

// Load .env from the project root (where pibot is invoked)
dotenv.config();

const program = new Command();

program
  .name('pibot')
  .description('PπBot — AI coding agent for the terminal')
  .version('0.1.0')
  .option(
    '--provider <name>',
    'LLM provider (gemini, anthropic, openai)',
    process.env['PIBOT_DEFAULT_PROVIDER'] ?? 'gemini',
  )
  .option(
    '-m, --model <model>',
    'Model name (e.g., gemini-2.5-flash, claude-sonnet-4-20250514, gpt-4o)',
  )
  .option(
    '-p, --path <path>',
    'Project root directory',
    '.',
  )
  .option(
    '--max-iterations <n>',
    'Max agent loop iterations',
    '25',
  )
  .option(
    '--list-providers',
    'List available providers and exit',
  )
  .action(async (options) => {
    const providerName: string = options.provider;
    const projectRoot = resolve(options.path);
    const maxIterations = parseInt(options.maxIterations, 10);

    // ── List providers mode ─────────────────────────────────
    if (options.listProviders) {
      const registry = await getProviderRegistry();
      console.log('\nAvailable providers:');
      for (const name of registry.listProviders()) {
        const defaultModel = DEFAULT_MODELS[name] ?? 'unknown';
        const hasKey = resolveApiKey(name) ? '✓ key set' : '✗ no key';
        console.log(`  ${name.padEnd(12)} default: ${defaultModel.padEnd(30)} ${hasKey}`);
      }
      console.log('\nSet API keys in .env or as environment variables.');
      process.exit(0);
    }

    // ── Resolve model (use default for provider if not specified)
    const model: string = options.model ?? process.env['PIBOT_DEFAULT_MODEL'] ?? DEFAULT_MODELS[providerName] ?? 'gemini-2.5-flash';

    // ── Validate API key ────────────────────────────────────
    const apiKey = resolveApiKey(providerName);
    if (!apiKey) {
      console.error(
        `\n❌ No API key found for provider "${providerName}".`,
      );
      console.error(
        `   Set ${providerName.toUpperCase()}_API_KEY in your .env file or environment.\n`,
      );
      process.exit(1);
    }

    // ── Launch the REPL ─────────────────────────────────────
    await startRepl({
      provider: providerName,
      model,
      apiKey,
      projectRoot,
      maxIterations,
      maxTokens: 8192,
    });
  });

// Use parseAsync for async action handlers
await program.parseAsync(process.argv);
