import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizePoolerUrl } from '../dbPooler.js';

test('a pooler URI with the project ref in the database name is rewritten to /postgres', () => {
  const raw =
    'postgresql://postgres.abcd1234:secret%40pw@aws-0-eu-central-1.pooler.supabase.com:6543/postgres.abcd1234';
  const next = normalizePoolerUrl(raw);
  assert.equal(next.rewrote, true);
  assert.equal(next.notes.includes('database_was_project_ref'), true);
  assert.match(next.url, /:6543\/postgres$/);
  assert.equal(next.url.includes('secret%40pw'), true);
  assert.equal(next.url.includes(':6543/postgres.abcd1234'), false);
});
