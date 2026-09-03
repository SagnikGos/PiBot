// ─── Human Confirmation ──────────────────────────────────────────
// Prompts the user with a Y/n confirm before running commands that
// match dangerous patterns (rm, sudo, git push, etc.).
// Uses @clack/prompts so it integrates seamlessly with the REPL UI.

import * as p from '@clack/prompts';

export interface ConfirmOptions {
  /** The command about to be executed */
  command: string;
  /** The pattern that triggered the confirmation */
  matchedPattern: string;
}

/**
 * Check if a command matches any dangerous pattern.
 * Returns the first matching pattern string, or null if safe.
 */
export function findDangerousPattern(
  command: string,
  patterns: string[],
): string | null {
  for (const pattern of patterns) {
    const regex = new RegExp(pattern, 'i');
    if (regex.test(command)) {
      return pattern;
    }
  }
  return null;
}

/**
 * Prompt the user to confirm a potentially dangerous command.
 * Returns true if the user confirms, false if they cancel.
 * If the terminal is non-interactive (e.g. piped), defaults to DENY.
 */
export async function confirmDangerousCommand(
  opts: ConfirmOptions,
): Promise<boolean> {
  // Non-interactive terminal → deny by default (safety first)
  if (!process.stdin.isTTY) {
    console.warn(
      `[BLOCKED] Non-interactive session: refusing to run potentially dangerous command: ${opts.command}`,
    );
    return false;
  }

  p.log.warn(
    `⚠️  The agent wants to run a potentially dangerous command:\n\n` +
    `   ${opts.command}\n\n` +
    `   Matched pattern: "${opts.matchedPattern}"`,
  );

  const confirmed = await p.confirm({
    message: 'Allow this command to run?',
    initialValue: false, // Default to NO — user must opt in
  });

  // p.isCancel handles Ctrl+C
  if (p.isCancel(confirmed) || confirmed === false) {
    p.log.info('Command blocked by user.');
    return false;
  }

  return true;
}
