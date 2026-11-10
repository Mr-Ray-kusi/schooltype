import crypto from 'crypto';
import { platformSupabase } from './supabaseClient.js';
import { isSharedRuntimeEnabled } from './sharedRuntime.js';

export const SCHOOL_ADMIN_DEVICE_LIMIT = 2;
export const SCANNER_DEVICE_LIMIT = 2;
export const SCANNER_IDLE_MS = 20 * 60 * 1000;

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function useCloud() {
  return Boolean(platformSupabase);
}

let sessionSeq = 0;
const memory = new Map();
const sessionsById = new Map();
const staffCurrent = new Map();
const staffByHash = new Map();
const studentCurrent = new Map();
const scannerSlots = new Map();

export const ACCESS_TTL_SEC = 15 * 60;

function rememberSession(row) {
  if (!row?.token_hash) return row;
  memory.set(row.token_hash, row);
  if (row.id) sessionsById.set(row.id, row);
  return row;
}

function isLive(row, now = Date.now()) {
  return Boolean(row) && !row.revoked_at && new Date(row.expires_at).getTime() > now;
}

export async function createAuthSession({ schoolId, token, remember, expiresAt, kind = 'admin' }) {
  const row = {
    id: crypto.randomUUID(),
    school_id: schoolId,
    token_hash: hashToken(token),
    remember: Boolean(remember),
    kind,
    expires_at: new Date(expiresAt).toISOString(),
    created_at: new Date().toISOString(),
    last_seen_at: new Date().toISOString(),
    revoked_at: null,
    seq: ++sessionSeq,
  };
  rememberSession(row);
  if (useCloud()) {
    const persist = { ...row };
    delete persist.kind;
    delete persist.seq;
    try {
      const { error } = await platformSupabase.from('auth_sessions').insert([persist]);
      if (error && error.code !== '42P01' && error.code !== 'PGRST205') {
        console.warn('Failed to persist auth session:', error.message);
      }
    } catch (error) {
      console.warn('Failed to persist auth session:', error.message);
    }
  }
  return row;
}

export async function trimSchoolAdminSessions(schoolId, keepToken, limit = SCHOOL_ADMIN_DEVICE_LIMIT) {
  if (!schoolId) return;
  const keepHash = keepToken ? hashToken(keepToken) : null;
  const now = Date.now();
  const byHash = new Map();

  for (const [hash, row] of memory.entries()) {
    if (row.school_id !== schoolId) continue;
    if (row.kind && row.kind !== 'admin') continue;
    if (!isLive(row, now)) continue;
    byHash.set(hash, row);
  }

  if (useCloud()) {
    const { data, error } = await platformSupabase
      .from('auth_sessions')
      .select('token_hash, school_id, created_at, expires_at, revoked_at')
      .eq('school_id', schoolId)
      .is('revoked_at', null);
    if (!error && Array.isArray(data)) {
      for (const row of data) {
        if (!isLive(row, now)) continue;
        const existing = byHash.get(row.token_hash);
        if (!existing) byHash.set(row.token_hash, row);
      }
    }
  }

  const ranked = [...byHash.entries()].sort((a, b) => {
    const aKeep = a[0] === keepHash ? 1 : 0;
    const bKeep = b[0] === keepHash ? 1 : 0;
    if (aKeep !== bKeep) return bKeep - aKeep;
    const byTime = new Date(b[1].created_at || 0).getTime() - new Date(a[1].created_at || 0).getTime();
    if (byTime) return byTime;
    return (b[1].seq || 0) - (a[1].seq || 0);
  });

  const keepCount = keepHash && byHash.has(keepHash) ? 1 : 0;
  const extra = ranked.filter(([hash]) => hash !== keepHash).slice(Math.max(0, limit - keepCount));
  const revokedAt = new Date().toISOString();
  for (const [hash, row] of extra) {
    rememberSession({ ...row, token_hash: hash, revoked_at: revokedAt });
    if (useCloud()) {
      platformSupabase.from('auth_sessions').update({ revoked_at: revokedAt }).eq('token_hash', hash).then(() => {}).catch(() => {});
    }
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SCANNER_BLOCKED =
  'Attendance scanner is already open on two devices. Close one of those scanners to use this phone.';

function isUuid(value) {
  return UUID_RE.test(String(value || ''));
}

function useSharedRow(id) {
  return Boolean(platformSupabase) && isSharedRuntimeEnabled() && isUuid(id);
}

function missingTable(error) {
  return error?.code === '42P01' || error?.code === 'PGRST205';
}

export function setStaffSession(staffId, token) {
  const id = String(staffId || '').trim();
  if (!id || !token) return undefined;
  const tokenHash = hashToken(token);
  const previous = staffCurrent.get(id);
  if (previous && previous !== tokenHash) staffByHash.delete(previous);
  staffCurrent.set(id, tokenHash);
  staffByHash.set(tokenHash, id);
  if (useSharedRow(id)) {
    platformSupabase
      .from('staff_device_sessions')
      .upsert({ staff_id: id, token_hash: tokenHash, updated_at: new Date().toISOString() }, { onConflict: 'staff_id' })
      .then(({ error }) => {
        if (error && !missingTable(error)) {
          console.warn('Failed to share staff device session:', error.message);
        }
      })
      .catch((error) => {
        console.warn('Failed to share staff device session:', error.message);
      });
  }
  return tokenHash;
}

export function clearStaffSession(staffId) {
  const id = String(staffId || '').trim();
  if (!id) return;
  const previous = staffCurrent.get(id);
  if (previous) staffByHash.delete(previous);
  staffCurrent.set(id, 'revoked');
  if (!useSharedRow(id)) return;
  platformSupabase
    .from('staff_device_sessions')
    .upsert({ staff_id: id, token_hash: 'revoked', updated_at: new Date().toISOString() }, { onConflict: 'staff_id' })
    .then(({ error }) => {
      if (error && !missingTable(error)) console.warn('Failed to clear staff device session:', error.message);
    })
    .catch(() => {});
}

export async function staffIdForRefreshToken(token) {
  const hash = hashToken(token);
  const localId = staffByHash.get(hash);
  if (localId && staffCurrent.get(localId) === hash) return localId;
  if (!platformSupabase) return null;
  const { data, error } = await platformSupabase
    .from('staff_device_sessions')
    .select('staff_id, token_hash')
    .eq('token_hash', hash)
    .maybeSingle();
  if (error || !data?.staff_id || data.token_hash !== hash) return null;
  staffCurrent.set(data.staff_id, hash);
  staffByHash.set(hash, data.staff_id);
  return data.staff_id;
}

export async function isStaffRefreshActive(staffId, refreshHash) {
  const id = String(staffId || '').trim();
  if (!id || !refreshHash) return false;
  if (staffCurrent.get(id) === 'revoked') return false;
  if (staffCurrent.get(id) === refreshHash) return true;
  if (!useSharedRow(id)) return false;
  const { data, error } = await platformSupabase
    .from('staff_device_sessions')
    .select('token_hash')
    .eq('staff_id', id)
    .maybeSingle();
  if (error || !data?.token_hash || data.token_hash === 'revoked') return false;
  staffCurrent.set(id, data.token_hash);
  staffByHash.set(data.token_hash, id);
  return data.token_hash === refreshHash;
}

export function setStudentPortalSession(studentId, token, meta = {}) {
  const id = String(studentId || '').trim();
  if (!id || !token) return '';
  const tokenHash = hashToken(token);
  studentCurrent.set(id, { tokenHash, schoolId: meta.schoolId || null, rollNumber: meta.rollNumber || null });
  return tokenHash;
}

export function clearStudentPortalSession(studentId) {
  const id = String(studentId || '').trim();
  if (!id) return;
  studentCurrent.set(id, { tokenHash: 'revoked' });
}

export function isStudentRefreshActive(studentId, refreshHash) {
  const row = studentCurrent.get(String(studentId || '').trim());
  if (!row || row.tokenHash === 'revoked') return false;
  return row.tokenHash === refreshHash;
}

export function studentForRefreshToken(token) {
  const hash = hashToken(token);
  for (const [studentId, row] of studentCurrent.entries()) {
    if (row?.tokenHash === hash) return { studentId, ...row };
  }
  return null;
}

export function isStaffSessionActive(staffId, token) {
  const id = String(staffId || '').trim();
  if (!id || !token) return false;
  const tokenHash = hashToken(token);
  if (staffCurrent.get(id) === 'revoked') return false;
  if (!useSharedRow(id)) {
    const current = staffCurrent.get(id);
    if (!current) return true;
    return current === tokenHash;
  }
  return platformSupabase
    .from('staff_device_sessions')
    .select('token_hash')
    .eq('staff_id', id)
    .maybeSingle()
    .then(({ data, error }) => {
      if (error) {
        if (!missingTable(error)) console.warn('Staff device session lookup failed:', error.message);
        const current = staffCurrent.get(id);
        if (!current) return true;
        return current === tokenHash;
      }
      if (!data?.token_hash || data.token_hash === 'revoked') return false;
      staffCurrent.set(id, data.token_hash);
      staffByHash.set(data.token_hash, id);
      return data.token_hash === tokenHash;
    })
    .catch(() => {
      const current = staffCurrent.get(id);
      if (!current) return true;
      return current === tokenHash;
    });
}

function scannerKey(schoolId) {
  return String(schoolId || '');
}

function pruneScannerSlots(schoolId, now = Date.now()) {
  const key = scannerKey(schoolId);
  const slots = scannerSlots.get(key) || [];
  const live = slots.filter((slot) => now - slot.lastSeen < SCANNER_IDLE_MS);
  scannerSlots.set(key, live);
  return live;
}

function claimScannerSlotMemory(schoolId, deviceId, limit = SCANNER_DEVICE_LIMIT) {
  const id = String(deviceId || '').trim();
  if (!schoolId || !id) return { allowed: false, error: 'Scanner device is required' };
  const now = Date.now();
  const live = pruneScannerSlots(schoolId, now);
  const existing = live.find((slot) => slot.deviceId === id);
  if (existing) {
    existing.lastSeen = now;
    return { allowed: true, deviceId: id };
  }
  if (live.length >= limit) {
    return { allowed: false, error: SCANNER_BLOCKED };
  }
  live.push({ deviceId: id, lastSeen: now });
  scannerSlots.set(scannerKey(schoolId), live);
  return { allowed: true, deviceId: id };
}

async function claimScannerSlotShared(schoolId, deviceId, limit) {
  const now = new Date().toISOString();
  const idleBefore = new Date(Date.now() - SCANNER_IDLE_MS).toISOString();
  const pruned = await platformSupabase
    .from('scanner_slots')
    .delete()
    .eq('school_id', schoolId)
    .lt('last_seen_at', idleBefore);
  if (pruned.error) {
    if (!missingTable(pruned.error)) console.warn('Scanner slot cleanup failed:', pruned.error.message);
    return claimScannerSlotMemory(schoolId, deviceId, limit);
  }

  const existing = await platformSupabase
    .from('scanner_slots')
    .select('device_id')
    .eq('school_id', schoolId)
    .eq('device_id', deviceId)
    .maybeSingle();
  if (existing.error) return claimScannerSlotMemory(schoolId, deviceId, limit);
  if (existing.data) {
    await platformSupabase
      .from('scanner_slots')
      .update({ last_seen_at: now })
      .eq('school_id', schoolId)
      .eq('device_id', deviceId);
    return { allowed: true, deviceId };
  }

  const live = await platformSupabase.from('scanner_slots').select('device_id').eq('school_id', schoolId);
  if (live.error) return claimScannerSlotMemory(schoolId, deviceId, limit);
  if ((live.data || []).length >= limit) {
    return { allowed: false, error: SCANNER_BLOCKED };
  }

  const inserted = await platformSupabase
    .from('scanner_slots')
    .insert([{ school_id: schoolId, device_id: deviceId, last_seen_at: now }]);
  if (inserted.error && inserted.error.code !== '23505') {
    console.warn('Scanner slot insert failed:', inserted.error.message);
    return { allowed: false, error: 'Could not open the scanner. Try again.' };
  }

  const after = await platformSupabase
    .from('scanner_slots')
    .select('device_id, last_seen_at')
    .eq('school_id', schoolId)
    .order('last_seen_at', { ascending: true });
  const rows = after.data || [];
  if (rows.length > limit) {
    const keep = new Set(rows.slice(0, limit).map((row) => row.device_id));
    if (!keep.has(deviceId)) {
      await platformSupabase.from('scanner_slots').delete().eq('school_id', schoolId).eq('device_id', deviceId);
      return { allowed: false, error: SCANNER_BLOCKED };
    }
  }
  return { allowed: true, deviceId };
}

export function claimScannerSlot(schoolId, deviceId, limit = SCANNER_DEVICE_LIMIT) {
  const id = String(deviceId || '').trim();
  if (!schoolId || !id) return { allowed: false, error: 'Scanner device is required' };
  if (!useSharedRow(schoolId)) return claimScannerSlotMemory(schoolId, id, limit);
  return claimScannerSlotShared(schoolId, id, limit);
}

export function touchScannerSlot(schoolId, deviceId) {
  return claimScannerSlot(schoolId, deviceId);
}

export function releaseScannerSlot(schoolId, deviceId) {
  const key = scannerKey(schoolId);
  const id = String(deviceId || '').trim();
  const live = (scannerSlots.get(key) || []).filter((slot) => slot.deviceId !== id);
  scannerSlots.set(key, live);
  if (!useSharedRow(schoolId) || !id) return undefined;
  return platformSupabase
    .from('scanner_slots')
    .delete()
    .eq('school_id', schoolId)
    .eq('device_id', id)
    .then(({ error }) => {
      if (error && !missingTable(error)) console.warn('Scanner slot release failed:', error.message);
    })
    .catch((error) => {
      console.warn('Scanner slot release failed:', error.message);
    });
}

export async function getAuthSession(token) {
  if (!token) return { status: 'missing' };
  const tokenHash = hashToken(token);
  const cached = memory.get(tokenHash);
  if (cached) {
    if (cached.revoked_at) return { status: 'revoked' };
    if (new Date(cached.expires_at).getTime() < Date.now()) return { status: 'expired' };
    return { status: 'ok', session: cached };
  }
  if (!useCloud()) return { status: 'missing' };
  const { data, error } = await platformSupabase
    .from('auth_sessions')
    .select('*')
    .eq('token_hash', tokenHash)
    .maybeSingle();
  if (error) {
    if (error.code === '42P01') return { status: 'table_missing' };
    return { status: 'missing' };
  }
  if (!data) return { status: 'missing' };
  rememberSession(data);
  if (data.revoked_at) return { status: 'revoked', session: data };
  if (new Date(data.expires_at).getTime() < Date.now()) return { status: 'expired', session: data };
  return { status: 'ok', session: data };
}

export async function revokeAuthSession(token) {
  if (!token) return;
  const tokenHash = hashToken(token);
  const now = new Date().toISOString();
  const cached = memory.get(tokenHash);
  if (cached) rememberSession({ ...cached, revoked_at: now });
  else rememberSession({ school_id: null, token_hash: tokenHash, expires_at: now, revoked_at: now });
  if (!useCloud()) return;
  await platformSupabase.from('auth_sessions').update({ revoked_at: now }).eq('token_hash', tokenHash);
}

export async function getAuthSessionById(id) {
  if (!id) return { status: 'missing' };
  const cached = sessionsById.get(id);
  if (cached) {
    if (cached.revoked_at) return { status: 'revoked', session: cached };
    if (new Date(cached.expires_at).getTime() < Date.now()) return { status: 'expired', session: cached };
    return { status: 'ok', session: cached };
  }
  if (!useCloud()) return { status: 'missing' };
  const { data, error } = await platformSupabase.from('auth_sessions').select('*').eq('id', id).maybeSingle();
  if (error) {
    if (error.code === '42P01' || error.code === 'PGRST205') return { status: 'table_missing' };
    return { status: 'missing' };
  }
  if (!data) return { status: 'missing' };
  rememberSession(data);
  if (data.revoked_at) return { status: 'revoked', session: data };
  if (new Date(data.expires_at).getTime() < Date.now()) return { status: 'expired', session: data };
  return { status: 'ok', session: data };
}

export async function revokeAuthSessionById(id) {
  if (!id) return;
  const now = new Date().toISOString();
  const cached = sessionsById.get(id);
  if (cached) rememberSession({ ...cached, revoked_at: now });
  if (!useCloud()) return;
  await platformSupabase.from('auth_sessions').update({ revoked_at: now }).eq('id', id);
}

export async function rotateAuthSession(sessionId, currentToken, nextToken) {
  const currentHash = hashToken(currentToken);
  const found = await getAuthSessionById(sessionId);
  const row = found.session;
  if (found.status !== 'ok' || !row || row.token_hash !== currentHash) return null;
  const nextHash = hashToken(nextToken);
  memory.delete(currentHash);
  const updated = rememberSession({
    ...row,
    token_hash: nextHash,
    last_seen_at: new Date().toISOString(),
  });
  if (useCloud()) {
    const { error } = await platformSupabase
      .from('auth_sessions')
      .update({ token_hash: nextHash, last_seen_at: updated.last_seen_at })
      .eq('id', sessionId)
      .eq('token_hash', currentHash)
      .is('revoked_at', null);
    if (error && error.code !== '42P01' && error.code !== 'PGRST205') return null;
  }
  return updated;
}

export async function revokeSchoolSessions(schoolId) {
  const now = new Date().toISOString();
  for (const [key, row] of memory.entries()) {
    if (row.school_id === schoolId) rememberSession({ ...row, revoked_at: now });
  }
  if (!useCloud() || !schoolId) return;
  await platformSupabase
    .from('auth_sessions')
    .update({ revoked_at: now })
    .eq('school_id', schoolId)
    .is('revoked_at', null);
}

export function sessionTtlSeconds(remember) {
  return remember ? 60 * 60 * 24 * 30 : 60 * 60 * 12;
}
