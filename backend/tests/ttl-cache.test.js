import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cacheGet, cacheSet, cacheStats, cacheInvalidate } from '../ttlCache.js';

test('the API cache evicts old entries instead of growing without a cap', () => {
  cacheInvalidate();
  for (let i = 0; i < 120; i += 1) {
    cacheSet(`k${i}`, { i }, 60_000);
  }
  const stats = cacheStats();
  assert.equal(stats.entries <= stats.max, true);
  assert.equal(cacheGet('k0'), null);
  assert.deepEqual(cacheGet('k119'), { i: 119 });
});
