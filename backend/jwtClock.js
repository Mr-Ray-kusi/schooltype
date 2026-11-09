let offsetSec = 0;
let resyncTimer = null;

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
        const next = remote - Math.floor(Date.now() / 1000);
        if (Math.abs(next) > 48 * 3600) {
          console.warn(
            `Ignoring implausible Supabase clock offset of ${next}s. Tenant JWTs will use local time.`
          );
          offsetSec = 0;
        } else {
          offsetSec = next;
          if (Math.abs(offsetSec) >= 30) {
            console.warn(
              `Computer clock is ${Math.abs(offsetSec)}s ${offsetSec < 0 ? 'ahead of' : 'behind'} Supabase. School data will use Supabase time.`
            );
          }
        }
      }
    }
  } catch (error) {
    console.warn('Could not read Supabase clock:', error.message || error);
  }
  return offsetSec;
}

function scheduleClockResync() {
  if (resyncTimer) return;
  resyncTimer = setTimeout(() => {
    resyncTimer = null;
    void syncJwtClock();
  }, 250);
  if (resyncTimer.unref) resyncTimer.unref();
}

export function noteJwtClockRejection(message) {
  const text = String(message || '');
  if (!/issued at future|jwt expired/i.test(text)) return false;
  scheduleClockResync();
  return true;
}

export function isJwtAuthError(error) {
  return /issued at future|jwt expired|invalid jwt|jws|pgrst301|pgrst303/i.test(
    String(error?.message || error?.code || error || '')
  );
}
