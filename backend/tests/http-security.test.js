import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyBaselineSecurityHeaders,
  corsOriginAllowed,
  redactSecrets,
  safeClientError,
  sanitizePublicText,
  sanitizeSearchTerm,
  scrubErrorResponse,
} from '../httpSecurity.js';

test('API responses are not cached and do not advertise Express', () => {
  const headers = {};
  const res = {
    removeHeader(name) {
      headers[`removed:${name}`] = true;
    },
    setHeader(name, value) {
      headers[name] = value;
    },
  };
  applyBaselineSecurityHeaders(res, { production: true });
  assert.equal(headers['removed:X-Powered-By'], true);
  assert.match(String(headers['Cache-Control']), /no-store/);
  assert.equal(headers['X-Content-Type-Options'], 'nosniff');
  assert.ok(headers['Strict-Transport-Security']);
});

test('production CORS never treats * as an allowed origin', () => {
  assert.equal(corsOriginAllowed('https://evil.example', ['*'], { production: true }), false);
  assert.equal(
    corsOriginAllowed('https://schootype.vercel.app', ['https://schootype.vercel.app'], { production: true }),
    true
  );
});

test('sanitizePublicText strips control characters and caps length', () => {
  assert.equal(sanitizePublicText('  Ama\u0000 Mensah  ', 80), 'Ama Mensah');
  assert.equal(sanitizePublicText('x'.repeat(50), 10).length, 10);
});

test('safeClientError hides internal details', () => {
  const hidden = safeClientError(new Error('JWT expired supabase password'), 'Request failed');
  assert.equal(hidden.error, 'Request failed');
  const shown = safeClientError({ status: 400, message: 'Fill in your email' }, 'Request failed');
  assert.equal(shown.status, 400);
  assert.equal(shown.error, 'Fill in your email');
});

test('search text cannot change a PostgREST filter', () => {
  const dirty = "Ama),(school_id.eq.00000000-0000-0000-0000-000000000000";
  const safe = sanitizeSearchTerm(dirty);
  assert.equal(safe.includes(','), false);
  assert.equal(safe.includes('('), false);
  assert.equal(safe.includes('.'), false);
  assert.match(safe, /Ama/);
});

test('server errors do not return database text or secret keys', () => {
  const leaked = scrubErrorResponse(
    { error: 'duplicate key value violates unique constraint "students_pkey"' },
    500
  );
  assert.equal(leaked.error, 'Request failed');

  const secret = 'sk_live_' + 'abc123secretvalue';
  const redacted = scrubErrorResponse({ error: `Paystack rejected ${secret}` }, 400);
  assert.equal(redacted.error.includes('sk_live_'), false);
  assert.match(redacted.error, /\[redacted\]/);

  const kept = scrubErrorResponse({ error: 'Failed to load students' }, 500);
  assert.equal(kept.error, 'Failed to load students');
  assert.equal(redactSecrets('postgres://user:pass@host/db').includes('postgres://'), false);
});
