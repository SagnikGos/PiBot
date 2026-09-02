// ─── Tool Error Codes ───────────────────────────────────────────
// Typed error codes that the LLM can parse and reason about.
// Each code has a corresponding human-readable suggestion to help
// the LLM self-correct on the next iteration.

export type ToolErrorCode =
  | 'FILE_NOT_FOUND'
  | 'PERMISSION_DENIED'
  | 'PATH_OUTSIDE_SANDBOX'
  | 'COMMAND_TIMEOUT'
  | 'COMMAND_FAILED'
  | 'EDIT_AMBIGUOUS'
  | 'EDIT_NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'UNKNOWN_ERROR';

export interface ToolError {
  code: ToolErrorCode;
  message: string;
  suggestion?: string;
}

// ─── Error Suggestions ──────────────────────────────────────────
// Default suggestions keyed by error code. Injected into the tool
// result so the LLM knows how to recover.

export const ERROR_SUGGESTIONS: Record<ToolErrorCode, string> = {
  FILE_NOT_FOUND:
    'The file does not exist. Use list_directory to find the correct path.',
  PERMISSION_DENIED:
    'Permission denied. Check file permissions or try a different path.',
  PATH_OUTSIDE_SANDBOX:
    'That path is outside the project directory. All paths must be relative to the project root.',
  COMMAND_TIMEOUT:
    'The command timed out. Try a more targeted command or increase the timeout.',
  COMMAND_FAILED:
    'The command exited with a non-zero code. Check stderr for details.',
  EDIT_AMBIGUOUS:
    'The search string was found multiple times. Include more surrounding context lines to make the match unique.',
  EDIT_NOT_FOUND:
    'The exact search string was not found in the file. Use read_file to verify the current file content.',
  VALIDATION_ERROR:
    'Invalid input. Check the required parameters and their types.',
  UNKNOWN_ERROR:
    'An unexpected error occurred. Try a different approach.',
};

// ─── Helper ─────────────────────────────────────────────────────
// Formats a ToolError into the string content for a ToolOutput.

export function formatToolError(error: ToolError): string {
  const suggestion = error.suggestion ?? ERROR_SUGGESTIONS[error.code] ?? '';
  return `[ERROR] ${error.code}: ${error.message}${suggestion ? `\nSuggestion: ${suggestion}` : ''}`;
}

// Creates a ToolError with auto-populated suggestion.
export function createToolError(
  code: ToolErrorCode,
  message: string,
  suggestion?: string,
): ToolError {
  return {
    code,
    message,
    suggestion: suggestion ?? ERROR_SUGGESTIONS[code],
  };
}
