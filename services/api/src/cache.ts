interface CacheEntry {
  expiresAt: number;
  value: unknown;
}

const MAX_ENTRIES = 500;
const entries = new Map<string, CacheEntry>();
const inFlight = new Map<string, { generation: number; request: Promise<unknown> }>();
let cacheGeneration = 0;

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
  if (existing && existing.expiresAt > Date.now()) return existing.value as T;
  if (existing) entries.delete(key);

  const generation = cacheGeneration;
  const pending = inFlight.get(key);
  if (pending?.generation === generation) return pending.request as Promise<T>;

  const request = load()
    .then(value => {
      if (cacheGeneration === generation) {
        pruneExpired();
        entries.set(key, { value, expiresAt: Date.now() + ttlMs });
      }
      return value;
    })
    .finally(() => {
      if (inFlight.get(key)?.request === request) inFlight.delete(key);
    });
  inFlight.set(key, { generation, request });
  return request;
}

export function invalidateCache(...prefixes: string[]) {
  cacheGeneration += 1;
  for (const key of entries.keys()) {
    if (prefixes.some(prefix => key.startsWith(prefix))) entries.delete(key);
  }
}
