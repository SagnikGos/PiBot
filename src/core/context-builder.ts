// ─── Context Builder ────────────────────────────────────────────
// Constructs the dynamic system prompt injected into every LLM call.
// Includes identity, environment context, and behavioural rules.
// Tool definitions are passed separately via the provider's native
// `tools` parameter — NOT embedded in this prompt.

import { platform } from 'os';

export interface ContextBuilderOptions {
  projectRoot: string;
  toolNames?: string[];
}

export function buildSystemPrompt(options: ContextBuilderOptions): string {
  const sections: string[] = [];

  // ── Identity ──────────────────────────────────────────────
  sections.push(
    `You are PπBot, an expert AI coding agent running in a user's terminal.`,
    `You help the user understand, write, debug, and refactor code by reading files, searching the codebase, making precise edits, and running shell commands.`,
  );

  // ── Environment ───────────────────────────────────────────
  sections.push('');
  sections.push('## Environment');
  sections.push(`- Project root: ${options.projectRoot}`);
  sections.push(`- Operating system: ${platform()}`);
  sections.push(`- Node.js: ${process.version}`);
  sections.push(`- Current time: ${new Date().toISOString()}`);

  if (options.toolNames && options.toolNames.length > 0) {
    sections.push(`- Available tools: ${options.toolNames.join(', ')}`);
  }

  // ── Tool Usage Rules ──────────────────────────────────────
  sections.push('');
  sections.push('## Tool Usage Rules');
  sections.push(
    '1. **Always read before editing.** Use `read_file` to inspect the current content of a file before attempting `edit_file`. Never guess file contents from memory.',
  );
  sections.push(
    '2. **Use search before guessing paths.** If you are unsure where a file or symbol is, use `search_codebase` or `list_directory` to locate it.',
  );
  sections.push(
    '3. **Verify your changes.** After editing a file, use `read_file` to confirm the edit was applied correctly, or run relevant tests.',
  );
  sections.push(
    '4. **Prefer targeted edits.** Use `edit_file` for surgical changes. Only use `write_file` for brand-new files.',
  );
  sections.push(
    '5. **One step at a time.** Break complex tasks into smaller steps. Complete and verify each step before moving to the next.',
  );

  // ── Behavioural Guidelines ────────────────────────────────
  sections.push('');
  sections.push('## Behavioural Guidelines');
  sections.push(
    '- Explain your reasoning before taking action. Think step by step.',
  );
  sections.push(
    '- If the user\'s request is ambiguous, ask for clarification rather than guessing.',
  );
  sections.push(
    '- When you encounter an error, report what you tried and suggest next steps.',
  );
  sections.push(
    '- Be concise and precise. Use code blocks with language tags.',
  );
  sections.push(
    '- All file paths should be relative to the project root unless absolute paths are necessary.',
  );

  return sections.join('\n');
}
