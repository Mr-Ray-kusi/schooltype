import assert from 'node:assert/strict';
import { test, afterEach } from 'node:test';

process.env.AUTH_STORE = 'local';
process.env.SUPABASE_JWT_SECRET = 'test-supabase-jwt-secret-32-chars!!';
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_ANON_KEY = 'anon-test-key';

const savedNodeEnv = process.env.NODE_ENV;
const {
  allowsTenantJwtFallback,
  createTenantClient,
  disableTenantJwt,
  isTenantJwtDisabled,
  resetTenantJwtDisabledForTests,
} = await import('../tenantContext.js');
const { requiresAuthSessions } = await import('../sessionStore.js');

afterEach(() => {
  resetTenantJwtDisabledForTests();
  delete process.env.ALLOW_TENANT_JWT_FALLBACK;
  delete process.env.REQUIRE_AUTH_SESSIONS;
  if (savedNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = savedNodeEnv;
});

test('production fails closed: tenant JWT is not paused and createTenantClient still works', () => {
  process.env.NODE_ENV = 'production';
  delete process.env.ALLOW_TENANT_JWT_FALLBACK;
  assert.equal(allowsTenantJwtFallback(), false);
  assert.equal(disableTenantJwt('JWT expired'), false);
  assert.equal(isTenantJwtDisabled(), false);
  assert.ok(createTenantClient('school-a', 'school'));
});

test('ALLOW_TENANT_JWT_FALLBACK=true pauses tenant JWT even in production', () => {
  process.env.NODE_ENV = 'production';
  process.env.ALLOW_TENANT_JWT_FALLBACK = 'true';
  assert.equal(allowsTenantJwtFallback(), true);
  assert.equal(disableTenantJwt('clock mismatch'), true);
  assert.equal(isTenantJwtDisabled(), true);
  assert.equal(createTenantClient('school-a', 'school'), null);
});

test('non-production allows service-role fallback by default', () => {
  process.env.NODE_ENV = 'development';
  delete process.env.ALLOW_TENANT_JWT_FALLBACK;
  assert.equal(allowsTenantJwtFallback(), true);
  assert.equal(disableTenantJwt('issued at future'), true);
  assert.equal(isTenantJwtDisabled(), true);
});

test('ALLOW_TENANT_JWT_FALLBACK=false blocks fallback outside production', () => {
  process.env.NODE_ENV = 'development';
  process.env.ALLOW_TENANT_JWT_FALLBACK = 'false';
  assert.equal(allowsTenantJwtFallback(), false);
  assert.equal(disableTenantJwt('invalid jwt'), false);
  assert.equal(isTenantJwtDisabled(), false);
});

test('requiresAuthSessions defaults on in production and off otherwise', () => {
  process.env.NODE_ENV = 'production';
  delete process.env.REQUIRE_AUTH_SESSIONS;
  assert.equal(requiresAuthSessions(), true);

  process.env.REQUIRE_AUTH_SESSIONS = 'false';
  assert.equal(requiresAuthSessions(), false);

  process.env.NODE_ENV = 'development';
  delete process.env.REQUIRE_AUTH_SESSIONS;
  assert.equal(requiresAuthSessions(), false);

  process.env.REQUIRE_AUTH_SESSIONS = 'true';
  assert.equal(requiresAuthSessions(), true);
});
