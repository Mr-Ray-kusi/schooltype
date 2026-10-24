import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { disableTenantJwt, getTenantStore } from './tenantContext.js';
import { isJwtAuthError, noteJwtClockRejection } from './jwtClock.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({
  path: path.join(__dirname, '.env'),
  // Render and any production host inject env vars. A copied .env must not replace them.
  override: !process.env.RENDER && !process.env.VERCEL && process.env.NODE_ENV !== 'production',
});

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.SUPABASE_ANON_KEY;
const supabaseKey = serviceKey || anonKey;

if (!supabaseUrl || !supabaseKey) {
  console.error(
    'Missing SUPABASE_URL and SUPABASE_ANON_KEY (or SUPABASE_SERVICE_ROLE_KEY). Set them in backend/.env locally or in the Render service env.'
  );
}

const platform =
  supabaseUrl && supabaseKey
    ? createClient(supabaseUrl, supabaseKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;

/** Master-key client: signup, plan changes, Paystack webhook, cron. */
export const platformSupabase = platform;

/**
 * School screens use a tenant JWT when SUPABASE_JWT_SECRET is set.
 * Platform jobs and unauthenticated routes keep the service-role client.
 */
export const supabase = platform
  ? new Proxy(platform, {
      get(target, prop, receiver) {
        const tenant = getTenantStore();
        const client = tenant?.db || target;
        const value = client[prop];
        if (typeof value === 'function') return value.bind(client);
        return value;
      },
    })
  : null;

export async function withSchoolDb(run) {
  const first = await run(supabase);
  if (!first?.error || !isJwtAuthError(first.error)) return first;
  noteJwtClockRejection(first.error.message || first.error.code);
  disableTenantJwt(first.error.message || first.error.code);
  if (!platform || platform === supabase) return first;
  return run(platform);
}

if (platform && serviceKey && !process.env.SUPABASE_JWT_SECRET) {
  console.warn(
    'SUPABASE_JWT_SECRET is not set. School screens still use the master key. Set it to the Supabase JWT secret so RLS can isolate tenants.'
  );
}
