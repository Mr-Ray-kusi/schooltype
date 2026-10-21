const FAIL_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 20;
const fails = new Map();

export function publicIdRateLimited(ip) {
  const key = String(ip || 'unknown');
  const now = Date.now();
  const row = fails.get(key) || { count: 0, start: now };
  if (now - row.start > FAIL_WINDOW_MS) {
    fails.set(key, { count: 0, start: now });
    return false;
  }
  return row.count >= MAX_FAILS;
}

export function recordPublicIdFailure(ip) {
  const key = String(ip || 'unknown');
  const now = Date.now();
  const row = fails.get(key);
  if (!row || now - row.start > FAIL_WINDOW_MS) {
    fails.set(key, { count: 1, start: now });
    return;
  }
  row.count += 1;
}

export function gateProfile(full) {
  return {
    type: full.type,
    name: full.name,
    school_name: full.school_name,
    school_logo_url: full.school_logo_url || null,
    class: full.class || null,
    role: full.role || null,
    parent_name: full.parent_name || null,
    parent_phone: full.parent_phone || null,
    photo_url: null,
    locked: false,
  };
}
