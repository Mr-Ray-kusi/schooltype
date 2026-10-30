import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizePoolerUrl } from '../dbPooler.js';
import { publicHealthView } from '../runtimeHealth.js';

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

test('public health does not expose memory or pooler details', () => {
  const open = publicHealthView(
    {
      status: 'ok',
      timestamp: '2026-01-01T00:00:00.000Z',
      memory: { rss_mb: 512 },
      db_pooler: { configured: true, warning: 'secret host' },
      instance: 'srv-1',
    },
    { detailed: false }
  );
  assert.deepEqual(open, { status: 'ok', timestamp: '2026-01-01T00:00:00.000Z' });
});
