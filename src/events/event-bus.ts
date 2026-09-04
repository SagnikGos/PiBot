// ─── Event Bus ──────────────────────────────────────────────────
// Typed event emitter that decouples the agent runtime from UI.
// Any interface (REPL, HTTP API, WebSocket, gateway) can subscribe
// to events without the runtime knowing which UI is rendering them.
//
// Phase 1: Extract Agent Runtime

import type { AgentEvent } from './event-types.js';

export type EventHandler = (event: AgentEvent) => void;
export type EventFilter = AgentEvent['type'] | AgentEvent['type'][];

export class EventBus {
  private handlers = new Set<EventHandler>();
  private filteredHandlers = new Map<EventHandler, Set<AgentEvent['type']>>();

  /**
   * Subscribe to all events.
   * Returns an unsubscribe function.
   */
  on(handler: EventHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  /**
   * Subscribe to specific event types only.
   * Returns an unsubscribe function.
   */
  onTypes(types: EventFilter, handler: EventHandler): () => void {
    const typeSet = new Set(Array.isArray(types) ? types : [types]);
    this.filteredHandlers.set(handler, typeSet);
    return () => {
      this.filteredHandlers.delete(handler);
    };
  }

  /**
   * Emit an event to all subscribers.
   */
  emit(event: AgentEvent): void {
    // Broadcast to unfiltered handlers
    for (const handler of this.handlers) {
      try {
        handler(event);
      } catch {
        // Don't let a handler crash the runtime
      }
    }

    // Broadcast to filtered handlers
    for (const [handler, types] of this.filteredHandlers) {
      if (types.has(event.type)) {
        try {
          handler(event);
        } catch {
          // Don't let a handler crash the runtime
        }
      }
    }
  }

  /**
   * Remove all handlers.
   */
  clear(): void {
    this.handlers.clear();
    this.filteredHandlers.clear();
  }

  /**
   * Wait for a specific event type. Useful for approval flows.
   * Resolves with the matching event, or rejects on abort.
   */
  waitFor<T extends AgentEvent['type']>(
    type: T,
    signal?: AbortSignal,
  ): Promise<Extract<AgentEvent, { type: T }>> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(signal.reason);
        return;
      }

      const unsub = this.onTypes(type, (event) => {
        unsub();
        cleanup();
        resolve(event as Extract<AgentEvent, { type: T }>);
      });

      const onAbort = () => {
        unsub();
        reject(signal?.reason ?? new Error('Aborted'));
      };

      const cleanup = () => {
        signal?.removeEventListener('abort', onAbort);
      };

      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }
}
