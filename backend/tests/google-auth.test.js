import assert from 'node:assert/strict';
import { test } from 'node:test';
import { verifyGoogleIdentity } from '../googleAuth.js';

test('Google sign-in refuses a missing token', async () => {
  const previous = process.env.GOOGLE_CLIENT_ID;
  process.env.GOOGLE_CLIENT_ID = 'test-client.apps.googleusercontent.com';
  await assert.rejects(() => verifyGoogleIdentity({}), /token is missing/i);
  if (previous == null) delete process.env.GOOGLE_CLIENT_ID;
  else process.env.GOOGLE_CLIENT_ID = previous;
});
