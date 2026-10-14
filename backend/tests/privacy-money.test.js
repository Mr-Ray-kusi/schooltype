import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.AUTH_STORE = 'local';
process.env.JWT_SECRET = 'test-jwt-secret-that-is-at-least-32-chars';
process.env.SUPABASE_JWT_SECRET = 'test-supabase-jwt-secret-32-chars!!';

const { gateProfile, isValidIdGateCode, makeIdGateCode, publicIdRateLimited, recordPublicIdFailure } =
  await import('../publicIdGate.js');
const { paymentCreatesSchool } = await import('../schoolSignupPayment.js');
const { signTenantJwt } = await import('../tenantContext.js');
const { checkLoginAllowed, recordLoginFailure } = await import('../authSecurity.js');

test('a public ID without a live check hides class, photo, and contacts', () => {
  const locked = gateProfile(
    {
      type: 'student',
      name: 'Ama Mensah',
      class: 'JHS 2',
      photo_url: 'data:image/png;base64,xxx',
      school_name: 'Sunrise School',
      school_logo_url: 'logo',
      role: null,
    },
    { unlocked: false }
  );
  assert.equal(locked.name, 'Ama Mensah');
  assert.equal(locked.school_name, 'Sunrise School');
  assert.equal(locked.class, null);
  assert.equal(locked.photo_url, null);
  assert.equal(locked.locked, true);
});

test('a gate scan with a short-lived code unlocks name, photo, class, and school', () => {
  const barcode = 'school-a-STU-1';
  const code = makeIdGateCode(barcode);
  assert.equal(isValidIdGateCode(barcode, code), true);
  assert.equal(isValidIdGateCode(barcode, 'not-a-real-gate'), false);
  const open = gateProfile(
    {
      type: 'student',
      name: 'Ama Mensah',
      class: 'JHS 2',
      photo_url: 'photo',
      school_name: 'Sunrise School',
      school_logo_url: 'logo',
    },
    { unlocked: true }
  );
  assert.equal(open.class, 'JHS 2');
  assert.equal(open.photo_url, 'photo');
});

test('repeated public ID guesses are rate limited', () => {
  const ip = '203.0.113.9';
  for (let i = 0; i < 20; i += 1) recordPublicIdFailure(ip);
  assert.equal(publicIdRateLimited(ip), true);
});

test('tenant JWT carries only that school_id', () => {
  const token = signTenantJwt('school-a', 'admin');
  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
  assert.equal(payload.school_id, 'school-a');
  assert.notEqual(payload.school_id, 'school-b');
  assert.equal(payload.role, 'authenticated');
});

test('a failed payment does not create a school', () => {
  assert.equal(paymentCreatesSchool('failed'), false);
  assert.equal(paymentCreatesSchool('abandoned'), false);
  assert.equal(paymentCreatesSchool('pending'), false);
});

test('a successful payment is the only status that may create a school and receipt', () => {
  assert.equal(paymentCreatesSchool('success'), true);
});

test('a locked account stays locked after more attempts', async () => {
  const email = 'locked-owner@example.com';
  const ip = '198.51.100.12';
  for (let i = 0; i < 5; i += 1) {
    await recordLoginFailure(email, ip);
  }
  const first = await checkLoginAllowed(email, ip);
  assert.equal(first.allowed, false);
  await recordLoginFailure(email, ip);
  const still = await checkLoginAllowed(email, ip);
  assert.equal(still.allowed, false);
});
