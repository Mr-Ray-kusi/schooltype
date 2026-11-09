import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cacheGet, cacheSet, cacheStats, cacheInvalidate } from '../ttlCache.js';

test('the API cache evicts old entries instead of growing without a cap', () => {
  cacheInvalidate();
  const max = cacheStats().max;
  for (let i = 0; i < max + 20; i += 1) {
    cacheSet(`k${i}`, { i }, 60_000);
  }
  const stats = cacheStats();
  assert.equal(stats.entries <= stats.max, true);
  assert.equal(cacheGet('k0'), null);
  assert.deepEqual(cacheGet(`k${max + 19}`), { i: max + 19 });
});

test('invalidating one school cache leaves other schools in place', () => {
  cacheInvalidate();
  cacheSet('dash:school-a', { school: 'a' }, 60_000);
  cacheSet('att-day:school-b', { school: 'b' }, 60_000);
  cacheInvalidate('school-a');
  assert.equal(cacheGet('dash:school-a'), null);
  assert.deepEqual(cacheGet('att-day:school-b'), { school: 'b' });
});
