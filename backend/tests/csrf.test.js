import assert from 'node:assert/strict';
import { test } from 'node:test';
import { csrfTokensMatch, createCsrfToken, requireCsrf } from '../csrf.js';

test('CSRF comparison is length-safe and rejects mismatches', () => {
  const token = createCsrfToken();
  assert.equal(csrfTokensMatch(token, token), true);
  assert.equal(csrfTokensMatch(token, `${token}x`.slice(1)), false);
  assert.equal(csrfTokensMatch('', token), false);
  assert.equal(csrfTokensMatch(token, ''), false);
});

test('mutating cookie sessions need a matching CSRF header', () => {
  const token = createCsrfToken();
  const req = {
    method: 'POST',
    path: '/api/students',
    headers: { 'x-csrf-token': token, cookie: `st_session=abc; st_csrf=${token}` },
  };
  let status = 200;
  const res = {
    status(code) {
      status = code;
      return this;
    },
    json() {
      return this;
    },
  };
  let nextCalled = false;
  requireCsrf(req, res, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, true);
  assert.equal(status, 200);

  nextCalled = false;
  requireCsrf({ ...req, headers: { cookie: `st_session=abc; st_csrf=${token}` } }, res, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, false);
  assert.equal(status, 403);
});

test('public login and fee routes skip CSRF', () => {
  let nextCalled = false;
  requireCsrf(
    { method: 'POST', path: '/api/auth/login', headers: { cookie: 'st_session=abc; st_csrf=nope' } },
    {
      status() {
        return this;
      },
      json() {
        return this;
      },
    },
    () => {
      nextCalled = true;
    }
  );
  assert.equal(nextCalled, true);
});
