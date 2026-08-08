import assert from 'node:assert/strict';
import test from 'node:test';
import { cached, invalidateCache } from './cache.js';

test('prefix invalidation keeps unrelated cache entries', async () => {
  invalidateCache();
  await cached('orders:a', 60_000, async () => 'order-a');
  await cached('catalog:b', 60_000, async () => 'catalog-b');
  invalidateCache('orders:');
  assert.equal(await cached('orders:a', 60_000, async () => 'order-a-reloaded'), 'order-a-reloaded');
  assert.equal(await cached('catalog:b', 60_000, async () => 'should-not-run'), 'catalog-b');
});

test('cache hit returns stored value without reloading', async () => {
  invalidateCache();
  let loads = 0;
  const first = await cached('hit-key', 60_000, async () => {
    loads += 1;
    return 'value';
  });
  const second = await cached('hit-key', 60_000, async () => {
    loads += 1;
    return 'other';
  });
  assert.equal(first, 'value');
  assert.equal(second, 'value');
  assert.equal(loads, 1);
});
