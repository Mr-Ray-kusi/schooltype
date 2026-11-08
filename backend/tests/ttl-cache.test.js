import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cacheGet, cacheSet, cacheStats, cacheInvalidate } from '../ttlCache.js';

test('the API cache evicts old entries instead of growing without a cap', () => {
  cacheInvalidate();
  const total = cacheStats().max + 40;
  for (let i = 0; i < total; i += 1) {
    cacheSet(`k${i}`, { i }, 60_000);
  }
  const stats = cacheStats();
  assert.equal(stats.entries, stats.max);
  assert.equal(cacheGet('k0'), null);
  assert.deepEqual(cacheGet(`k${total - 1}`), { i: total - 1 });
});
