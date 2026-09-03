// ─── Conversation State ──────────────────────────────────────────
// Manages the message history with token-aware pruning.
// When the accumulated history grows too large, old messages are
// trimmed from the middle — keeping the first user message (task
// context) and the most recent N messages (working memory).
//
// Strategy: "sliding window with pinned head"
//   - Pin: first user message (gives context about the task)
//   - Window: last N messages (most recent reasoning + tool results)
//   - Prune: everything in between when token budget exceeded

import type { Message } from '../types/messages.js';

export interface ConversationStateOptions {
  /** Max tokens before pruning kicks in. Default: 80,000. */
  maxTokens?: number;
  /** How many recent messages to always keep. Default: 10. */
  minRecentMessages?: number;
  /** Rough token estimate per character. Default: 0.25 (4 chars/token). */
  charsPerToken?: number;
}

const DEFAULTS = {
  maxTokens: 80_000,
  minRecentMessages: 10,
  charsPerToken: 0.25,
};

export class ConversationState {
  private _messages: Message[] = [];
  private readonly maxTokens: number;
  private readonly minRecentMessages: number;
  private readonly charsPerToken: number;

  constructor(opts: ConversationStateOptions = {}) {
    this.maxTokens = opts.maxTokens ?? DEFAULTS.maxTokens;
    this.minRecentMessages = opts.minRecentMessages ?? DEFAULTS.minRecentMessages;
    this.charsPerToken = opts.charsPerToken ?? DEFAULTS.charsPerToken;
  }

  // ─── Public API ─────────────────────────────────────────────

  get messages(): Message[] {
    return this._messages;
  }

  set messages(msgs: Message[]) {
    this._messages = msgs;
  }

  /** Append a message and prune if needed. */
  push(message: Message): void {
    this._messages.push(message);
    this.pruneIfNeeded();
  }

  /** Append multiple messages at once. */
  pushAll(messages: Message[]): void {
    this._messages.push(...messages);
    this.pruneIfNeeded();
  }

  /** Clear all history. */
  clear(): void {
    this._messages = [];
  }

  /** Estimated token count for all current messages. */
  get estimatedTokens(): number {
    return this.estimateTokens(this._messages);
  }

  /** How many messages are in history. */
  get length(): number {
    return this._messages.length;
  }

  // ─── Pruning ────────────────────────────────────────────────

  private pruneIfNeeded(): void {
    if (this.estimatedTokens <= this.maxTokens) return;
    if (this._messages.length <= this.minRecentMessages + 1) return;

    this._messages = this.prune(this._messages);
  }

  private prune(messages: Message[]): Message[] {
    if (messages.length <= this.minRecentMessages + 1) {
      return messages;
    }

    // Keep first message (task context) + recent tail
    const head = messages.slice(0, 1);
    const tail = messages.slice(-this.minRecentMessages);

    // If head and tail would overlap, just return all
    if (messages.length <= this.minRecentMessages + 1) {
      return messages;
    }

    // Insert a summary marker so the LLM knows history was pruned
    const pruneMarker: Message = {
      role: 'user',
      content:
        '[Note: Earlier conversation history was pruned to stay within context limits. ' +
        'The most recent messages and original task context are preserved.]',
    };

    const pruned = [...head, pruneMarker, ...tail];

    // Recurse if still over budget (edge case: very long individual messages)
    if (this.estimateTokens(pruned) > this.maxTokens && tail.length > 2) {
      const shorterTail = messages.slice(-(this.minRecentMessages - 2));
      return [...head, pruneMarker, ...shorterTail];
    }

    return pruned;
  }

  // ─── Token Estimation ────────────────────────────────────────
  // Rough estimate: count all characters in message content,
  // multiply by charsPerToken. Not exact, but good enough for budgeting.

  private estimateTokens(messages: Message[]): number {
    let chars = 0;
    for (const msg of messages) {
      if (typeof msg.content === 'string') {
        chars += msg.content.length;
      } else {
        for (const block of msg.content) {
          if (block.type === 'text') {
            chars += block.text.length;
          } else if (block.type === 'tool_use') {
            chars += block.name.length + JSON.stringify(block.input).length;
          } else if (block.type === 'tool_result') {
            chars += block.content.length;
          }
        }
      }
    }
    return Math.ceil(chars * this.charsPerToken);
  }
}
