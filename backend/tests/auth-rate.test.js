import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  SCANNER_MARKS_PER_MINUTE,
  blockedByLimit,
  getClientIp,
  takeMemoryLimit,
  takeScannerLimit,
} from '../authSecurity.js';

test('client IP ignores a caller-supplied forwarded header', () => {
  const req = {
    ip: '203.0.113.8',
    headers: { 'x-forwarded-for': '198.51.100.9, 203.0.113.8' },
    socket: { remoteAddress: '10.0.0.4' },
  };
  assert.equal(getClientIp(req), '203.0.113.8');
  assert.equal(getClientIp({ headers: { 'x-forwarded-for': '198.51.100.9' } }), 'unknown');
  assert.equal(getClientIp({ ip: '::ffff:203.0.113.8' }), '203.0.113.8');
});

test('memory limit blocks the request after the cap', () => {
  const key = `test:${Date.now()}`;
  assert.equal(takeMemoryLimit(key, { max: 2, windowMs: 60_000 }).allowed, true);
  assert.equal(takeMemoryLimit(key, { max: 2, windowMs: 60_000 }).allowed, true);
  const blocked = takeMemoryLimit(key, { max: 2, windowMs: 60_000 });
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSec > 0);
});

test('scanner limit follows the link, not a spoofed address', () => {
  const token = `scanner-${Date.now()}`;
  let last = { allowed: true };
  for (let i = 0; i < SCANNER_MARKS_PER_MINUTE; i += 1) last = takeScannerLimit(token);
  assert.equal(last.allowed, true);
  assert.equal(takeScannerLimit(token).allowed, false);
  assert.equal(takeScannerLimit(`${token}-other`).allowed, true);
});

test('blocked response is 429 and does not continue', () => {
  const headers = {};
  let body = null;
  let status = 200;
  const res = {
    setHeader(name, value) {
      headers[name] = value;
    },
    status(code) {
      status = code;
      return this;
    },
    json(payload) {
      body = payload;
    },
  };
  assert.equal(blockedByLimit(res, { allowed: true }), false);
  assert.equal(
    blockedByLimit(res, { allowed: false, retryAfterSec: 15, message: 'Too many requests. Please wait before trying again.' }),
    true
  );
  assert.equal(status, 429);
  assert.equal(headers['Retry-After'], '15');
  assert.match(body.error, /Too many requests/);
});
