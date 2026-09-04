import { calculateTokenBudget, TokenBudget } from './token-budget.js';
import { buildTieredPrompt } from './prompt-builder.js';

export class ContextEngine {
  public budget: TokenBudget;
  private projectRoot: string;
  private toolNames?: string[];

  constructor(options: { projectRoot: string; toolNames?: string[]; maxTokens?: number }) {
    this.projectRoot = options.projectRoot;
    this.toolNames = options.toolNames;
    this.budget = calculateTokenBudget(options.maxTokens || 80_000);
  }

  public buildSystemPrompt(): string {
    const prompt = buildTieredPrompt({ projectRoot: this.projectRoot, toolNames: this.toolNames });
    // In a complete implementation we might compress if tokens > budget.systemPrompt
    // const tokens = estimateTokens(prompt);
    return prompt;
  }
}

