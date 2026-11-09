import { AsyncLocalStorage } from 'async_hooks';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { tenantNowSec } from './jwtClock.js';

const tenantAls = new AsyncLocalStorage();
const clientPool = new Map();
const MAX_CLIENTS = 64;
const TOKEN_TTL_SEC = 60 * 60;

export function getTenantStore() {
  return tenantAls.getStore() || null;
}

export function runWithTenant(store, fn) {
  return tenantAls.run(store, fn);
}

function hmacSecret() {
  return String(process.env.SUPABASE_JWT_SECRET || '')
    .trim()
    .replace(/^['"]|['"]$/g, '');
}

function supabaseIssuer() {
  const url = String(process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
  return url ? `${url}/auth/v1` : '';
}

function encodeJwtPart(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

export function signTenantJwt(schoolId, role = 'authenticated') {
  const secret = hmacSecret();
  if (!secret || !schoolId) return null;
  const now = tenantNowSec();
  const payload = {
    aud: 'authenticated',
    role: 'authenticated',
    sub: String(schoolId),
    school_id: String(schoolId),
    app_role: role === 'authenticated' ? 'school' : String(role || 'school'),
    iat: now - 60,
    exp: now + TOKEN_TTL_SEC,
  };
  const iss = supabaseIssuer();
  if (iss) payload.iss = iss;
  const data = `${encodeJwtPart({ alg: 'HS256', typ: 'JWT' })}.${encodeJwtPart(payload)}`;
  const sig = crypto.createHmac('sha256', secret).update(data).digest('base64url');
  return `${data}.${sig}`;
}

function rememberClient(schoolId, entry) {
  if (clientPool.has(schoolId)) clientPool.delete(schoolId);
  clientPool.set(schoolId, entry);
  while (clientPool.size > MAX_CLIENTS) {
    const oldest = clientPool.keys().next().value;
    clientPool.delete(oldest);
  }
}

export function evictTenantClient(schoolId) {
  if (schoolId) clientPool.delete(String(schoolId));
}

export function createTenantClient(schoolId, role = 'authenticated') {
  const id = String(schoolId || '').trim();
  if (!id) return null;
  const now = tenantNowSec();
  const cached = clientPool.get(id);
  if (cached?.client && cached.exp - 120 > now) {
    cached.lastUsed = Date.now();
    rememberClient(id, cached);
    return cached.client;
  }

  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  const token = signTenantJwt(id, role);
  if (!url || !anon || !token) return null;
  const client = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  rememberClient(id, { client, exp: now + TOKEN_TTL_SEC, lastUsed: Date.now() });
  return client;
}

/** Pause tenant JWT for this school request only. Other schools keep their own clients. */
export function pauseTenantJwtForRequest(reason) {
  const store = getTenantStore();
  if (!store) return;
  store.usePlatform = true;
  if (store.schoolId) evictTenantClient(store.schoolId);
  const school = store.schoolId || 'unknown';
  console.warn(
    `Tenant JWT paused for school ${school} (${reason || 'auth error'}). This school still loads with school_id filters; other schools are unchanged.`
  );
}

/** @deprecated Use pauseTenantJwtForRequest. Kept so existing call sites stay request-scoped. */
export function disableTenantJwt(reason) {
  pauseTenantJwtForRequest(reason);
}

export function isTenantJwtDisabled() {
  return Boolean(getTenantStore()?.usePlatform);
}

export function usesTenantIsolation() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY && hmacSecret());
}
