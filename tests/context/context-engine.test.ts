import { describe, it, expect } from 'vitest';
import { calculateTokenBudget, estimateTokens } from '../../src/context/token-budget.js';
import { scanProjectContext } from '../../src/context/project-scanner.js';
import { buildTieredPrompt } from '../../src/context/prompt-builder.js';
import { ContextEngine } from '../../src/context/context-engine.js';

describe('Token Budget', () => {
  it('calculates token budget correctly', () => {
    const budget = calculateTokenBudget(100000);
    expect(budget.maxTokens).toBe(100000);
    expect(budget.systemPrompt).toBe(10000);
    expect(budget.output).toBe(30000);
    expect(budget.conversationHistory).toBe(60000);
  });

  it('estimates tokens correctly', () => {
    expect(estimateTokens('1234')).toBe(1);
    expect(estimateTokens('12345')).toBe(2);
  });
});

describe('Project Scanner', () => {
  it('scans project context without throwing', () => {
    const ctx = scanProjectContext(process.cwd());
    expect(typeof ctx.hasPackageJson).toBe('boolean');
  });
});

describe('Prompt Builder', () => {
  it('builds a tiered prompt with environment context', () => {
    const prompt = buildTieredPrompt({ projectRoot: process.cwd(), toolNames: ['test_tool'] });
    expect(prompt).toContain('You are PpBot');
    expect(prompt).toContain('Available tools: test_tool');
    expect(prompt).toContain('Tool Usage Rules');
  });
});

describe('Context Engine', () => {
  it('initializes and builds system prompt', () => {
    const engine = new ContextEngine({ projectRoot: process.cwd(), maxTokens: 50000 });
    expect(engine.budget.maxTokens).toBe(50000);
    const prompt = engine.buildSystemPrompt();
    expect(prompt).toContain('Environment');
  });
});
