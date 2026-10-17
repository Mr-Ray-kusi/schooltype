/**
 * Where this process is running.
 * The website is static on Vercel. This API is a long-running Node server on Render.
 * Postgres is Supabase. Vercel serverless is not the API runtime.
 */

export function isRender() {
  return Boolean(process.env.RENDER);
}

export function isVercel() {
  return Boolean(process.env.VERCEL);
}

export function isProduction() {
  return isRender() || isVercel() || process.env.NODE_ENV === 'production';
}

/** Platform env vars must win over a .env file that was copied into the image. */
export function platformEnvWins() {
  return isRender() || isVercel() || process.env.NODE_ENV === 'production';
}

/**
 * Money, SMS, and rate-limit rows belong in Supabase.
 * `local` is an explicit opt-out for offline development only.
 */
export function preferSupabase(storeEnvName) {
  const mode = String(process.env[storeEnvName] || '').trim().toLowerCase();
  if (mode === 'local') return false;
  if (mode === 'supabase') return true;
  return Boolean(process.env.SUPABASE_URL);
}

/** Local SQLite is wiped on every Render deploy. Keep it for local dev only. */
export function useLocalDiskStore() {
  if (String(process.env.LOCAL_DISK_STORE || '').trim().toLowerCase() === '1') return true;
  if (isRender() || isVercel() || process.env.NODE_ENV === 'production') return false;
  return true;
}
