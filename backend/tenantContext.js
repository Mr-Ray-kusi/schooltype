import { AsyncLocalStorage } from 'async_hooks';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { tenantNowSec } from './jwtClock.js';

const tenantAls = new AsyncLocalStorage();
let tenantJwtDisabled = false;

export function getTenantStore() {
  return tenantAls.getStore() || null;
}

export function runWithTenant(store, fn) {
  return tenantAls.run(store, fn);
}

/**
 * When false (production default), JWT/RLS failures stay on the tenant client.
 * Service-role fallback is only for local/dev, or ALLOW_TENANT_JWT_FALLBACK=true.
 */
export function allowsTenantJwtFallback() {
  if (process.env.ALLOW_TENANT_JWT_FALLBACK === 'true') return true;
  if (process.env.ALLOW_TENANT_JWT_FALLBACK === 'false') return false;
  return process.env.NODE_ENV !== 'production';
}

export function isTenantJwtDisabled() {
  return tenantJwtDisabled;
}

/** Test helper — do not use in request paths. */
export function resetTenantJwtDisabledForTests() {
  tenantJwtDisabled = false;
}

/**
 * @returns {boolean} true if tenant JWT was paused and callers may use the service-role client
 */
export function disableTenantJwt(reason) {
  if (!allowsTenantJwtFallback()) {
    console.error(
      `Tenant JWT rejected (${reason || 'auth error'}). Failing closed — keeping RLS (no service-role fallback).`
    );
    return false;
  }
  if (tenantJwtDisabled) return true;
  tenantJwtDisabled = true;
  console.warn(
    `Tenant JWT paused (${reason || 'clock mismatch'}). School screens still load with school_id filters.`
  );
  return true;
}

function encodeJwtPart(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

export function signTenantJwt(schoolId, role = 'authenticated') {
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret || !schoolId) return null;
  const local = Math.floor(Date.now() / 1000);
  const remote = tenantNowSec();
  const iat = Math.min(local, remote) - 24 * 60 * 60;
  const exp = Math.max(local, remote) + 12 * 60 * 60;
  const payload = {
    aud: 'authenticated',
    role: 'authenticated',
    sub: String(schoolId),
    school_id: String(schoolId),
    app_role: role,
    iat,
    exp,
  };
  const data = `${encodeJwtPart({ alg: 'HS256', typ: 'JWT' })}.${encodeJwtPart(payload)}`;
  const sig = crypto.createHmac('sha256', secret).update(data).digest('base64url');
  return `${data}.${sig}`;
}

export function createTenantClient(schoolId, role = 'authenticated') {
  if (tenantJwtDisabled) return null;
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  const token = signTenantJwt(schoolId, role);
  if (!url || !anon || !token) return null;
  return createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

export function usesTenantIsolation() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY && process.env.SUPABASE_JWT_SECRET);
}
