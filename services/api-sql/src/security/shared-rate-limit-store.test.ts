import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SharedRateLimitStore } from './shared-rate-limit-store.js';

describe('SharedRateLimitStore', () => {
  it('counts hits in process during tests', async () => {
    const store = new SharedRateLimitStore('test');
    store.init({ windowMs: 60_000 } as never);
    const first = await store.increment('client-a');
    const second = await store.increment('client-a');
    assert.equal(first.totalHits, 1);
    assert.equal(second.totalHits, 2);
    const other = await store.increment('client-b');
    assert.equal(other.totalHits, 1);
  });
});
