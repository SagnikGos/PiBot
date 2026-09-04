export interface TokenBudget {
  maxTokens: number;
  systemPrompt: number;
  output: number;
  conversationHistory: number;
}

export function calculateTokenBudget(maxTokens: number): TokenBudget {
  return {
    maxTokens,
    systemPrompt: Math.floor(maxTokens * 0.1),
    output: Math.floor(maxTokens * 0.3),
    conversationHistory: Math.floor(maxTokens * 0.6)
  };
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
