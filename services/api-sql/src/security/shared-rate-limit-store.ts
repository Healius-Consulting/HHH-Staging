import { createHash } from 'node:crypto';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import type { ClientRateLimitInfo, Options, Store } from 'express-rate-limit';
import { app } from '../bootstrap/firebase.js';
import { config } from '../bootstrap/config.js';

const COLLECTION = 'opsRateLimits';

type HitState = { totalHits: number; resetTime: Date };

class MemoryHitStore {
  private readonly hits = new Map<string, HitState>();

  constructor(private windowMs: number) {}

  setWindow(windowMs: number) {
    this.windowMs = windowMs;
  }

  increment(key: string): HitState {
    const now = Date.now();
    const current = this.hits.get(key);
    if (!current || current.resetTime.getTime() <= now) {
      const next = { totalHits: 1, resetTime: new Date(now + this.windowMs) };
      this.hits.set(key, next);
      return { ...next };
    }
    current.totalHits += 1;
    return { totalHits: current.totalHits, resetTime: current.resetTime };
  }

  decrement(key: string) {
    const current = this.hits.get(key);
    if (!current) return;
    current.totalHits = Math.max(0, current.totalHits - 1);
  }

  resetKey(key: string) {
    this.hits.delete(key);
  }
}

export class SharedRateLimitStore implements Store {
  prefix: string;
  windowMs = 60_000;
  private readonly memory = new MemoryHitStore(this.windowMs);
  private firestore: Firestore | null = null;

  constructor(prefix: string) {
    this.prefix = prefix;
  }

  init(options: Options): void {
    this.windowMs = options.windowMs;
    this.memory.setWindow(options.windowMs);
    if (config.NODE_ENV === 'production') {
      this.firestore = getFirestore(app);
    }
  }

  private docId(key: string) {
    return createHash('sha256').update(`${this.prefix}:${key}`).digest('hex');
  }

  async increment(key: string): Promise<ClientRateLimitInfo> {
    if (!this.firestore) return this.memory.increment(key);

    const ref = this.firestore.collection(COLLECTION).doc(this.docId(key));
    const now = Date.now();
    const windowMs = this.windowMs;

    try {
      return await this.firestore.runTransaction(async transaction => {
        const snapshot = await transaction.get(ref);
        let totalHits = 1;
        let resetTime = new Date(now + windowMs);
        const storedReset = snapshot.exists ? Number(snapshot.get('resetAtMs')) : 0;
        if (snapshot.exists && storedReset > now) {
          totalHits = Number(snapshot.get('hits') ?? 0) + 1;
          resetTime = new Date(storedReset);
        }
        transaction.set(ref, {
          hits: totalHits,
          resetAtMs: resetTime.getTime(),
        });
        return { totalHits, resetTime };
      });
    } catch {
      return { totalHits: Number.MAX_SAFE_INTEGER, resetTime: new Date(now + windowMs) };
    }
  }

  async decrement(key: string): Promise<void> {
    if (!this.firestore) {
      this.memory.decrement(key);
      return;
    }
    const ref = this.firestore.collection(COLLECTION).doc(this.docId(key));
    try {
      await this.firestore.runTransaction(async transaction => {
        const snapshot = await transaction.get(ref);
        if (!snapshot.exists) return;
        const hits = Math.max(0, Number(snapshot.get('hits') ?? 0) - 1);
        transaction.update(ref, { hits });
      });
    } catch {
      // Leave the shared counter unchanged if the store is unavailable.
    }
  }

  async resetKey(key: string): Promise<void> {
    if (!this.firestore) {
      this.memory.resetKey(key);
      return;
    }
    await this.firestore.collection(COLLECTION).doc(this.docId(key)).delete().catch(() => undefined);
  }
}
