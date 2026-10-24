let offsetSec = 0;

export function tenantNowSec() {
  return Math.floor(Date.now() / 1000) + offsetSec;
}

export function jwtClockOffsetSec() {
  return offsetSec;
}

export async function syncJwtClock(supabaseUrl = process.env.SUPABASE_URL) {
  if (!supabaseUrl) return offsetSec;
  try {
    const base = String(supabaseUrl).replace(/\/$/, '');
    const res = await fetch(`${base}/auth/v1/health`, { method: 'GET' });
    const header = res.headers.get('date');
    if (header) {
      const remote = Math.floor(new Date(header).getTime() / 1000);
      if (Number.isFinite(remote) && remote > 1e9) {
        offsetSec = remote - Math.floor(Date.now() / 1000);
        if (Math.abs(offsetSec) >= 30) {
          console.warn(
            `Computer clock is ${Math.abs(offsetSec)}s ${offsetSec < 0 ? 'ahead of' : 'behind'} Supabase. School data will use Supabase time.`
          );
        }
      }
    }
  } catch (error) {
    console.warn('Could not read Supabase clock:', error.message || error);
  }
  return offsetSec;
}

export function noteJwtClockRejection(message) {
  const text = String(message || '');
  if (/issued at future/i.test(text)) {
    offsetSec = Math.min(offsetSec, 0) - 8 * 3600;
    return true;
  }
  if (/jwt expired/i.test(text)) {
    offsetSec = Math.max(offsetSec, 0) + 8 * 3600;
    return true;
  }
  return false;
}

export function isJwtAuthError(error) {
  return /issued at future|jwt expired|invalid jwt|jws|pgrst301|pgrst303/i.test(
    String(error?.message || error?.code || error || '')
  );
}
