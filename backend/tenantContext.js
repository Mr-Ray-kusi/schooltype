import { AsyncLocalStorage } from 'async_hooks';
import jwt from 'jsonwebtoken';
import { createClient } from '@supabase/supabase-js';

const tenantAls = new AsyncLocalStorage();

export function getTenantStore() {
  return tenantAls.getStore() || null;
}

export function runWithTenant(store, fn) {
  return tenantAls.run(store, fn);
}

export function signTenantJwt(schoolId, role = 'authenticated') {
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret || !schoolId) return null;
  return jwt.sign(
    {
      aud: 'authenticated',
      role: 'authenticated',
      sub: String(schoolId),
      school_id: String(schoolId),
      app_role: role,
    },
    secret,
    { expiresIn: '2h', algorithm: 'HS256' }
  );
}

export function createTenantClient(schoolId, role = 'authenticated') {
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
