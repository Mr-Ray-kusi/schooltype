import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.SUPABASE_JWT_SECRET = 'test-supabase-jwt-secret-32-chars!!';
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_ANON_KEY = 'anon-test-key';

const { signTenantJwt, createTenantClient, runWithTenant, disableTenantJwt, isTenantJwtDisabled } =
  await import('../tenantContext.js');
const { noteJwtClockRejection, jwtClockOffsetSec } = await import('../jwtClock.js');

test('tenant JWT carries only that school_id and a supabase issuer', () => {
  const token = signTenantJwt('school-a', 'admin');
  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
  assert.equal(payload.school_id, 'school-a');
  assert.notEqual(payload.school_id, 'school-b');
  assert.equal(payload.role, 'authenticated');
  assert.equal(payload.iss, 'https://example.supabase.co/auth/v1');
  assert.ok(payload.iat <= Math.floor(Date.now() / 1000));
  assert.ok(payload.exp > Math.floor(Date.now() / 1000));
});

test('a JWT failure in one school request does not pause JWT for another school', async () => {
  const clientA = createTenantClient('school-a');
  const clientB = createTenantClient('school-b');
  assert.ok(clientA);
  assert.ok(clientB);

  await runWithTenant({ db: clientA, schoolId: 'school-a' }, () => {
    disableTenantJwt('invalid jwt');
    assert.equal(isTenantJwtDisabled(), true);
  });

  await runWithTenant({ db: clientB, schoolId: 'school-b' }, () => {
    assert.equal(isTenantJwtDisabled(), false);
  });

  assert.ok(createTenantClient('school-b'));
});

test('a clock rejection does not jump the process clock by eight hours', () => {
  const before = jwtClockOffsetSec();
  assert.equal(noteJwtClockRejection('JWT expired'), true);
  assert.equal(jwtClockOffsetSec(), before);
});
