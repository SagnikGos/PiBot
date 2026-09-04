// ─── Conversation State Tests ────────────────────────────────────
// Baseline tests for the token-aware message history.

import { describe, it, expect, beforeEach } from 'vitest';
import { ConversationState } from '../../src/core/conversation-state.js';
import type { Message } from '../../src/types/messages.js';

describe('ConversationState', () => {
  let state: ConversationState;

  beforeEach(() => {
    state = new ConversationState({
      maxTokens: 1000,
      minRecentMessages: 3,
      charsPerToken: 0.25,
    });
  });

  it('should start empty', () => {
    expect(state.length).toBe(0);
    expect(state.messages).toEqual([]);
    expect(state.estimatedTokens).toBe(0);
  });

  it('should push and retrieve messages', () => {
    state.push({ role: 'user', content: 'Hello' });
    state.push({ role: 'assistant', content: 'Hi there' });

    expect(state.length).toBe(2);
    expect(state.messages[0]).toEqual({ role: 'user', content: 'Hello' });
    expect(state.messages[1]).toEqual({ role: 'assistant', content: 'Hi there' });
  });

  it('should estimate tokens based on content length', () => {
    // 100 chars * 0.25 = 25 tokens
    const longMessage = 'a'.repeat(100);
    state.push({ role: 'user', content: longMessage });
    expect(state.estimatedTokens).toBe(25);
  });

  it('should estimate tokens for structured content', () => {
    state.push({
      role: 'assistant',
      content: [
        { type: 'text', text: 'Let me help' },
        { type: 'tool_use', id: 'call_1', name: 'read_file', input: { path: 'test.ts' } },
      ],
    });
    expect(state.estimatedTokens).toBeGreaterThan(0);
  });

  it('should prune when over token budget', () => {
    // Create messages that exceed 1000 tokens (4000+ chars)
    for (let i = 0; i < 20; i++) {
      state.push({ role: 'user', content: 'x'.repeat(300) });
    }

    // Should have pruned to keep first + prune marker + recent N
    expect(state.length).toBeLessThan(20);
    // First message should be preserved (pinned head)
    expect(state.messages[0].role).toBe('user');
  });

  it('should clear all messages', () => {
    state.push({ role: 'user', content: 'Hello' });
    state.push({ role: 'assistant', content: 'Hi' });
    state.clear();
    expect(state.length).toBe(0);
  });

  it('should allow setting messages directly', () => {
    const msgs: Message[] = [
      { role: 'user', content: 'test' },
    ];
    state.messages = msgs;
    expect(state.messages).toEqual(msgs);
  });
});
