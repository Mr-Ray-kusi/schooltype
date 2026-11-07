import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isTransientSmtpError, smtpLookup } from '../smtpLookup.js';

test('SMTP network errors are treated as temporary', () => {
  assert.equal(isTransientSmtpError({ code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND smtp.gmail.com' }), true);
  assert.equal(isTransientSmtpError({ message: 'connect ENETUNREACH 2607:f8b0::6c:587' }), true);
  assert.equal(isTransientSmtpError({ message: 'Invalid login: 534-5.7.9 Application-specific password required' }), false);
});

test('smtpLookup is a dns.lookup-compatible callback', () => {
  assert.equal(typeof smtpLookup, 'function');
  assert.equal(smtpLookup.length, 3);
});
