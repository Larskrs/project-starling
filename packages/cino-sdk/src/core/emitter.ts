export type Listener<T> = (payload: T) => void;

export interface Emitter<Events extends Record<string, unknown>> {
  /** Returns a function that removes the listener. */
  on<K extends keyof Events>(event: K, listener: Listener<Events[K]>): () => void;
  once<K extends keyof Events>(event: K, listener: Listener<Events[K]>): () => void;
  off<K extends keyof Events>(event: K, listener: Listener<Events[K]>): void;
}

/**
 * Runs in any runtime. A listener that throws cannot break the caller mid-update:
 * its error is rethrown on a microtask, after every listener has run.
 */
export function createEmitter<Events extends Record<string, unknown>>() {
  const listeners = new Map<keyof Events, Set<Listener<never>>>();

  const emitter = {
    on<K extends keyof Events>(event: K, listener: Listener<Events[K]>): () => void {
      let set = listeners.get(event);
      if (!set) listeners.set(event, set = new Set());
      set.add(listener as Listener<never>);
      return () => emitter.off(event, listener);
    },

    once<K extends keyof Events>(event: K, listener: Listener<Events[K]>): () => void {
      const off = emitter.on(event, (payload) => { off(); listener(payload); });
      return off;
    },

    off<K extends keyof Events>(event: K, listener: Listener<Events[K]>): void {
      listeners.get(event)?.delete(listener as Listener<never>);
    },

    emit<K extends keyof Events>(event: K, payload: Events[K]): void {
      for (const listener of [...(listeners.get(event) ?? [])]) {
        try {
          (listener as Listener<Events[K]>)(payload);
        } catch (err) {
          queueMicrotask(() => { throw err; });
        }
      }
    },

    clear(): void {
      listeners.clear();
    },
  };

  return emitter;
}
