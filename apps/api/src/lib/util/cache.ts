/**
 * Minimal in-memory TTL cache with a size cap (FIFO eviction).
 * Single-process only — for cross-instance deployments swap for a shared store.
 */
export class TtlCache<K, V> {
  #map = new Map<K, { value: V; expiresAt: number }>();

  constructor(
    private ttlMs: number,
    private maxSize = 1000,
  ) {}

  get(key: K): V | undefined {
    const entry = this.#map.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.#map.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: K, value: V): void {
    if (this.#map.size >= this.maxSize && !this.#map.has(key)) {
      const oldest = this.#map.keys().next().value;
      if (oldest !== undefined) this.#map.delete(oldest);
    }
    this.#map.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  delete(key: K): void {
    this.#map.delete(key);
  }

  clear(): void {
    this.#map.clear();
  }
}
