interface CacheEntry {
  expiresAt: number;
  value: unknown;
}

const MAX_ENTRIES = 500;
const entries = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<unknown>>();

function touch(key: string, entry: CacheEntry) {
  // Re-insert so Map iteration order approximates LRU-by-access.
  entries.delete(key);
  entries.set(key, entry);
}

function pruneExpired() {
  const now = Date.now();
  for (const [key, entry] of entries) {
    if (entry.expiresAt <= now) entries.delete(key);
  }
  while (entries.size >= MAX_ENTRIES) {
    const oldestKey = entries.keys().next().value as string | undefined;
    if (!oldestKey) break;
    entries.delete(oldestKey);
  }
}

export async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const existing = entries.get(key);
  if (existing && existing.expiresAt > Date.now()) {
    touch(key, existing);
    return existing.value as T;
  }
  if (existing) entries.delete(key);

  const pending = inFlight.get(key);
  if (pending) return pending as Promise<T>;

  const request = load()
    .then(value => {
      pruneExpired();
      entries.set(key, { value, expiresAt: Date.now() + ttlMs });
      return value;
    })
    .finally(() => {
      if (inFlight.get(key) === request) inFlight.delete(key);
    });
  inFlight.set(key, request);
  return request;
}

/** Drop matching keys only — do not invalidate unrelated in-flight cache writes. */
export function invalidateCache(...prefixes: string[]) {
  if (!prefixes.length) {
    entries.clear();
    return;
  }
  for (const key of [...entries.keys()]) {
    if (prefixes.some(prefix => key.startsWith(prefix))) entries.delete(key);
  }
  for (const key of [...inFlight.keys()]) {
    if (prefixes.some(prefix => key.startsWith(prefix))) inFlight.delete(key);
  }
}
