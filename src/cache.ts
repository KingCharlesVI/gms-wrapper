/**
 * Minimal async cache interface, so you can plug in Redis, AsyncStorage,
 * Cloudflare KV etc. Values are the raw JSON-parsed response bodies.
 */
export interface GmsCache {
  get(key: string): Promise<unknown | undefined> | unknown | undefined;
  set(key: string, value: unknown, ttlSeconds: number): Promise<void> | void;
}

/** Simple in-memory TTL cache with an optional max entry count (oldest evicted first). */
export class MemoryCache implements GmsCache {
  private readonly store = new Map<string, { value: unknown; expires: number }>();

  constructor(private readonly maxEntries = 500) {}

  get(key: string): unknown | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() >= entry.expires) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: unknown, ttlSeconds: number): void {
    if (ttlSeconds <= 0) return;
    this.store.delete(key);
    this.store.set(key, { value, expires: Date.now() + ttlSeconds * 1000 });
    while (this.store.size > this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest === undefined) break;
      this.store.delete(oldest);
    }
  }

  clear(): void {
    this.store.clear();
  }
}
