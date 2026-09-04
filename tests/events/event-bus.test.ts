// ─── Event Bus Tests ────────────────────────────────────────────
// Tests for the typed event system.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventBus } from '../../src/events/event-bus.js';
import type { AgentEvent } from '../../src/events/event-types.js';

describe('EventBus', () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus();
  });

  it('should call handlers when events are emitted', () => {
    const handler = vi.fn();
    bus.on(handler);

    const event: AgentEvent = { type: 'turn.started', turnIndex: 0 };
    bus.emit(event);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(event);
  });

  it('should support unsubscribing', () => {
    const handler = vi.fn();
    const unsub = bus.on(handler);

    bus.emit({ type: 'turn.started', turnIndex: 0 });
    expect(handler).toHaveBeenCalledOnce();

    unsub();
    bus.emit({ type: 'turn.started', turnIndex: 1 });
    expect(handler).toHaveBeenCalledOnce(); // Still 1, not called again
  });

  it('should support type-filtered handlers', () => {
    const handler = vi.fn();
    bus.onTypes('model.delta', handler);

    bus.emit({ type: 'turn.started', turnIndex: 0 });
    expect(handler).not.toHaveBeenCalled();

    bus.emit({ type: 'model.delta', text: 'hello' });
    expect(handler).toHaveBeenCalledOnce();
  });

  it('should support multiple type filters', () => {
    const handler = vi.fn();
    bus.onTypes(['model.delta', 'tool.started'], handler);

    bus.emit({ type: 'turn.started', turnIndex: 0 });
    expect(handler).not.toHaveBeenCalled();

    bus.emit({ type: 'model.delta', text: 'hello' });
    expect(handler).toHaveBeenCalledOnce();

    bus.emit({ type: 'tool.started', toolCallId: '1', name: 'test', input: {} });
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('should not crash if a handler throws', () => {
    bus.on(() => {
      throw new Error('Handler error');
    });

    const handler2 = vi.fn();
    bus.on(handler2);

    // Should not throw
    bus.emit({ type: 'turn.started', turnIndex: 0 });

    // Second handler should still be called
    expect(handler2).toHaveBeenCalledOnce();
  });

  it('should clear all handlers', () => {
    const handler = vi.fn();
    bus.on(handler);

    bus.clear();
    bus.emit({ type: 'turn.started', turnIndex: 0 });

    expect(handler).not.toHaveBeenCalled();
  });

  it('should resolve waitFor when matching event arrives', async () => {
    const promise = bus.waitFor('turn.completed');

    // Emit in a microtask
    setTimeout(() => {
      bus.emit({ type: 'turn.completed', turnIndex: 0, stopReason: 'end_turn' });
    }, 10);

    const event = await promise;
    expect(event.type).toBe('turn.completed');
    expect(event.turnIndex).toBe(0);
  });

  it('should reject waitFor on abort', async () => {
    const controller = new AbortController();
    const promise = bus.waitFor('turn.completed', controller.signal);

    setTimeout(() => controller.abort(new Error('cancelled')), 10);

    await expect(promise).rejects.toThrow('cancelled');
  });
});
