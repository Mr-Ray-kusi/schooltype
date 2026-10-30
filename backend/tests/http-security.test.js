import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyBaselineSecurityHeaders, corsOriginAllowed, safeClientError } from '../httpSecurity.js';

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

test('safeClientError hides internal details', () => {
  const hidden = safeClientError(new Error('JWT expired supabase password'), 'Request failed');
  assert.equal(hidden.error, 'Request failed');
  const shown = safeClientError({ status: 400, message: 'Fill in your email' }, 'Request failed');
  assert.equal(shown.status, 400);
  assert.equal(shown.error, 'Fill in your email');
});
