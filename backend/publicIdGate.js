import crypto from 'crypto';

const FAIL_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 20;
const fails = new Map();

function secret() {
  return process.env.JWT_SECRET || process.env.SUPABASE_JWT_SECRET || 'id-gate';
}

function dayKey(offset = 0) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

export function makeIdGateCode(barcode, offset = 0) {
  const raw = `${String(barcode || '').trim()}:${dayKey(offset)}`;
  return crypto.createHmac('sha256', secret()).update(raw).digest('hex').slice(0, 10);
}

export function isValidIdGateCode(barcode, code) {
  const given = String(code || '').trim().toLowerCase();
  if (!given) return false;
  return [0, -1].some((offset) => makeIdGateCode(barcode, offset).toLowerCase() === given);
}

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

export function gateProfile(full, { unlocked }) {
  const base = {
    type: full.type,
    name: full.name,
    school_name: full.school_name,
    locked: !unlocked,
  };
  if (!unlocked) {
    return {
      ...base,
      class: null,
      photo_url: null,
      role: null,
      error: undefined,
      hint: 'This ID needs a live school check. Ask the school desk to scan it.',
    };
  }
  return {
    ...base,
    class: full.class || null,
    photo_url: full.photo_url || null,
    role: full.role || null,
    school_logo_url: full.school_logo_url || null,
  };
}
