import crypto from 'crypto';
import { platformSupabase } from './supabaseClient.js';

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function useCloud() {
  return Boolean(platformSupabase);
}

const memory = new Map();

export async function createAuthSession({ schoolId, token, remember, expiresAt }) {
  const row = {
    id: crypto.randomUUID(),
    school_id: schoolId,
    token_hash: hashToken(token),
    remember: Boolean(remember),
    expires_at: new Date(expiresAt).toISOString(),
    created_at: new Date().toISOString(),
    last_seen_at: new Date().toISOString(),
    revoked_at: null,
  };
  memory.set(row.token_hash, row);
  if (useCloud()) {
    platformSupabase
      .from('auth_sessions')
      .insert([row])
      .then(({ error }) => {
        if (error && error.code !== '42P01') {
          console.warn('Failed to persist auth session:', error.message);
        }
      })
      .catch((error) => {
        console.warn('Failed to persist auth session:', error.message);
      });
  }
  return row;
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
  memory.set(tokenHash, data);
  if (data.revoked_at) return { status: 'revoked', session: data };
  if (new Date(data.expires_at).getTime() < Date.now()) return { status: 'expired', session: data };
  return { status: 'ok', session: data };
}

export async function revokeAuthSession(token) {
  if (!token) return;
  const tokenHash = hashToken(token);
  const now = new Date().toISOString();
  const cached = memory.get(tokenHash);
  if (cached) memory.set(tokenHash, { ...cached, revoked_at: now });
  else memory.set(tokenHash, { school_id: null, token_hash: tokenHash, expires_at: now, revoked_at: now });
  if (!useCloud()) return;
  await platformSupabase.from('auth_sessions').update({ revoked_at: now }).eq('token_hash', tokenHash);
}

export async function revokeSchoolSessions(schoolId) {
  const now = new Date().toISOString();
  for (const [key, row] of memory.entries()) {
    if (row.school_id === schoolId) memory.set(key, { ...row, revoked_at: now });
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
