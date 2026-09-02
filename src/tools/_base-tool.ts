// ─── Base Tool ──────────────────────────────────────────────────
// Abstract base class for all tools. Provides:
// - Automatic input validation against the tool's JSON schema
// - Error wrapping (thrown errors → structured ToolOutput)
// - Path sandbox integration (for tools that touch the filesystem)
//
// Files starting with underscore (_) are skipped by auto-discovery.
// This convention keeps the base class in the tools/ directory
// alongside its implementations without being registered as a tool.

import type { Tool, ToolDefinition, ToolOutput } from '../types/tools.js';
import { createToolError, formatToolError } from '../types/errors.js';

export abstract class BaseTool implements Tool {
  abstract readonly definition: ToolDefinition;

  /**
   * Subclasses implement this with their actual logic.
   * Errors thrown here are automatically caught and formatted.
   */
  protected abstract run(input: Record<string, unknown>): Promise<ToolOutput>;

  /**
   * Public entry point. Validates input, runs the tool, and
   * catches any errors into a structured ToolOutput.
   */
  async execute(input: Record<string, unknown>): Promise<ToolOutput> {
    try {
      this.validate(input);
      return await this.run(input);
    } catch (error) {
      return this.handleError(error);
    }
  }

  // ─── Input Validation ───────────────────────────────────────

  /**
   * Lightweight runtime validation against the tool's input_schema.
   * Checks required fields and basic type matching.
   * No external validation library needed.
   */
  protected validate(input: Record<string, unknown>): void {
    const schema = this.definition.input_schema;

    // Check required fields
    for (const field of schema.required) {
      if (input[field] === undefined || input[field] === null) {
        throw Object.assign(
          new Error(`Missing required parameter: "${field}"`),
          { toolErrorCode: 'VALIDATION_ERROR' as const },
        );
      }
    }

    // Check types and enums for provided fields
    for (const [key, value] of Object.entries(input)) {
      const propSchema = schema.properties[key];
      if (!propSchema) continue; // Allow extra fields (forward compat)

      // Type check
      if (propSchema.type === 'string' && typeof value !== 'string') {
        throw Object.assign(
          new Error(`Parameter "${key}" must be a string, got ${typeof value}`),
          { toolErrorCode: 'VALIDATION_ERROR' as const },
        );
      }
      if (propSchema.type === 'number' && typeof value !== 'number') {
        throw Object.assign(
          new Error(`Parameter "${key}" must be a number, got ${typeof value}`),
          { toolErrorCode: 'VALIDATION_ERROR' as const },
        );
      }
      if (propSchema.type === 'boolean' && typeof value !== 'boolean') {
        throw Object.assign(
          new Error(`Parameter "${key}" must be a boolean, got ${typeof value}`),
          { toolErrorCode: 'VALIDATION_ERROR' as const },
        );
      }

      // Enum check
      if (propSchema.enum && !propSchema.enum.includes(value as string)) {
        throw Object.assign(
          new Error(
            `Parameter "${key}" must be one of: ${propSchema.enum.join(', ')}. Got: "${value}"`,
          ),
          { toolErrorCode: 'VALIDATION_ERROR' as const },
        );
      }
    }
  }

  // ─── Error Handling ─────────────────────────────────────────

  /**
   * Convert any thrown error into a structured ToolOutput with
   * is_error: true and an LLM-readable error message.
   */
  protected handleError(error: unknown): ToolOutput {
    if (error instanceof Error) {
      // Check for our custom error code annotation
      const code =
        (error as { toolErrorCode?: string }).toolErrorCode ?? 'UNKNOWN_ERROR';
      const toolError = createToolError(
        code as Parameters<typeof createToolError>[0],
        error.message,
      );
      return {
        content: formatToolError(toolError),
        is_error: true,
      };
    }

    const toolError = createToolError('UNKNOWN_ERROR', String(error));
    return {
      content: formatToolError(toolError),
      is_error: true,
    };
  }

  // ─── Helpers for subclasses ─────────────────────────────────

  /** Create a successful ToolOutput. */
  protected ok(content: string, metadata?: Record<string, unknown>): ToolOutput {
    return { content, is_error: false, metadata };
  }

  /** Create a failed ToolOutput with a typed error code. */
  protected fail(
    code: Parameters<typeof createToolError>[0],
    message: string,
    suggestion?: string,
  ): ToolOutput {
    const toolError = createToolError(code, message, suggestion);
    return {
      content: formatToolError(toolError),
      is_error: true,
    };
  }
}
