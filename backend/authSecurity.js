import path from 'path';
import fs from 'fs';
import { openLocalDb } from './localDb.js';
import { getDataDir } from './dataPaths.js';
import { supabase } from './supabaseClient.js';

const DATA_DIR = getDataDir();
const DB_PATH = path.join(DATA_DIR, 'school-extras.db');

const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILED_PER_EMAIL = 5;
const MAX_FAILED_PER_IP = 15;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;
const SIGNUP_WINDOW_MS = 60 * 60 * 1000;
const MAX_SIGNUPS_PER_IP = 5;
const MIN_PASSWORD_LENGTH = 8;

const HIT_LIMITS = {
  login: { max: 25, windowMs: LOCKOUT_WINDOW_MS },
  google: { max: 20, windowMs: LOCKOUT_WINDOW_MS },
  staff_login: { max: 15, windowMs: LOCKOUT_WINDOW_MS },
  resend: { max: 5, windowMs: SIGNUP_WINDOW_MS },
  fee_public: { max: 30, windowMs: LOCKOUT_WINDOW_MS },
};

const MAX_RESEND_PER_EMAIL = 3;

let dbPromise = null;
const memoryEvents = [];
let cloudReady = false;

function useCloudAuth() {
  return Boolean(supabase) && String(process.env.AUTH_STORE || 'supabase').toLowerCase() !== 'local';
}

async function getDb() {
  if (useCloudAuth()) return null;
  if (!dbPromise) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    dbPromise = Promise.resolve(openLocalDb(DB_PATH)).then(async (db) => {
      await db.exec(`
        CREATE TABLE IF NOT EXISTS auth_rate_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          kind TEXT NOT NULL,
          email TEXT,
          ip TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_auth_rate_kind_email ON auth_rate_events(kind, email, created_at);
        CREATE INDEX IF NOT EXISTS idx_auth_rate_kind_ip ON auth_rate_events(kind, ip, created_at);
      `);
      return db;
    });
  }
  return dbPromise;
}

export async function initAuthSecurityStore() {
  if (useCloudAuth()) {
    if (!supabase) {
      console.warn('Supabase is not configured; login rate limits will be in-memory only.');
      cloudReady = false;
      return;
    }
    const { error } = await supabase.from('auth_rate_events').select('id').limit(1);
    if (error) {
      console.warn(
        'auth_rate_events table missing; login rate limits will be in-memory only. Run database/supabase_core_billing.sql then database/supabase_backend_access.sql.'
      );
      cloudReady = false;
      return;
    }
    cloudReady = true;
    return;
  }
  await getDb();
}

const windowStartIso = (windowMs) => new Date(Date.now() - windowMs).toISOString();

function pruneMemory() {
  const cutoff = Date.now() - SIGNUP_WINDOW_MS * 2;
  for (let i = memoryEvents.length - 1; i >= 0; i -= 1) {
    if (new Date(memoryEvents[i].created_at).getTime() < cutoff) memoryEvents.splice(i, 1);
  }
}

async function insertEvent({ kind, email = null, ip = null }) {
  const entry = {
    kind,
    email: email ? String(email).trim().toLowerCase() : null,
    ip: ip && ip !== 'unknown' ? ip : null,
    created_at: new Date().toISOString(),
  };

  if (cloudReady) {
    const { error } = await supabase.from('auth_rate_events').insert([entry]);
    if (error) {
      console.warn('Failed to persist auth rate event:', error.message);
      memoryEvents.push(entry);
    }
    return;
  }

  const db = await getDb();
  if (!db) {
    pruneMemory();
    memoryEvents.push(entry);
    return;
  }
  await db.run(
    `INSERT INTO auth_rate_events (kind, email, ip, created_at) VALUES (?, ?, ?, ?)`,
    [entry.kind, entry.email, entry.ip, entry.created_at]
  );
}

async function countEvents({ kind, email, ip, windowMs }) {
  const since = windowStartIso(windowMs);

  if (cloudReady) {
    let query = supabase
      .from('auth_rate_events')
      .select('*', { count: 'exact', head: true })
      .eq('kind', kind)
      .gte('created_at', since);
    if (email) query = query.eq('email', String(email).trim().toLowerCase());
    if (ip) query = query.eq('ip', ip);
    const { count, error } = await query;
    if (error) {
      console.warn('Failed to count auth rate events:', error.message);
    } else {
      return count || 0;
    }
  }

  const db = await getDb();
  if (!db) {
    pruneMemory();
    const cutoff = Date.now() - windowMs;
    return memoryEvents.filter((event) => {
      if (event.kind !== kind) return false;
      if (new Date(event.created_at).getTime() < cutoff) return false;
      if (email && event.email !== String(email).trim().toLowerCase()) return false;
      if (ip && event.ip !== ip) return false;
      return true;
    }).length;
  }

  const clauses = ['kind = ?', 'created_at >= ?'];
  const params = [kind, since];
  if (email) {
    clauses.push('email = ?');
    params.push(String(email).trim().toLowerCase());
  }
  if (ip) {
    clauses.push('ip = ?');
    params.push(ip);
  }
  const row = await db.get(
    `SELECT COUNT(*) AS count FROM auth_rate_events WHERE ${clauses.join(' AND ')}`,
    params
  );
  return row?.count || 0;
}

async function lastEventAt({ kind, email, ip, windowMs }) {
  const since = windowStartIso(windowMs);

  if (cloudReady) {
    let query = supabase
      .from('auth_rate_events')
      .select('created_at')
      .eq('kind', kind)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(1);
    if (email) query = query.eq('email', String(email).trim().toLowerCase());
    if (ip) query = query.eq('ip', ip);
    const { data, error } = await query.maybeSingle();
    if (!error && data?.created_at) return new Date(data.created_at).getTime();
  }

  const db = await getDb();
  if (!db) {
    pruneMemory();
    const cutoff = Date.now() - windowMs;
    const matches = memoryEvents.filter((event) => {
      if (event.kind !== kind) return false;
      if (new Date(event.created_at).getTime() < cutoff) return false;
      if (email && event.email !== String(email).trim().toLowerCase()) return false;
      if (ip && event.ip !== ip) return false;
      return true;
    });
    if (!matches.length) return Date.now();
    return Math.max(...matches.map((event) => new Date(event.created_at).getTime()));
  }

  const clauses = ['kind = ?', 'created_at >= ?'];
  const params = [kind, since];
  if (email) {
    clauses.push('email = ?');
    params.push(String(email).trim().toLowerCase());
  }
  if (ip) {
    clauses.push('ip = ?');
    params.push(ip);
  }
  const row = await db.get(
    `SELECT MAX(created_at) AS last_at FROM auth_rate_events WHERE ${clauses.join(' AND ')}`,
    params
  );
  return row?.last_at ? new Date(row.last_at).getTime() : Date.now();
}

export function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

export function validatePasswordStrength(password) {
  if (!password || typeof password !== 'string') {
    return 'Password is required';
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    return 'Password must include at least one letter and one number';
  }
  if (password.length > 128) {
    return 'Password is too long';
  }
  return null;
}

function deny(message, retryAfterSec) {
  return { allowed: false, retryAfterSec, message };
}

export async function checkAuthHitAllowed(kind, ip) {
  const limits = HIT_LIMITS[kind] || HIT_LIMITS.login;
  if (!ip || ip === 'unknown') return { allowed: true };
  const count = await countEvents({ kind, ip, windowMs: limits.windowMs });
  if (count >= limits.max) {
    return deny(
      'Too many attempts from this network. Please wait before trying again.',
      Math.ceil(limits.windowMs / 1000)
    );
  }
  return { allowed: true };
}

export async function recordAuthHit(kind, ip, email = null) {
  await insertEvent({ kind, ip, email });
}

export async function checkLoginAllowed(email, ip) {
  const normalizedEmail = email?.trim().toLowerCase();
  const emailFails = await countEvents({
    kind: 'login_fail',
    email: normalizedEmail,
    windowMs: LOCKOUT_WINDOW_MS,
  });

  if (emailFails >= MAX_FAILED_PER_EMAIL) {
    const lastFailed = await lastEventAt({
      kind: 'login_fail',
      email: normalizedEmail,
      windowMs: LOCKOUT_WINDOW_MS,
    });
    const retryAfterSec = Math.max(1, Math.ceil((lastFailed + LOCKOUT_DURATION_MS - Date.now()) / 1000));
    return deny(
      `Too many failed login attempts. Try again in ${Math.ceil(retryAfterSec / 60)} minute(s).`,
      retryAfterSec
    );
  }

  if (ip && ip !== 'unknown') {
    const ipFails = await countEvents({
      kind: 'login_fail',
      ip,
      windowMs: LOCKOUT_WINDOW_MS,
    });
    if (ipFails >= MAX_FAILED_PER_IP) {
      return deny(
        'Too many login attempts from this network. Please wait before trying again.',
        Math.ceil(LOCKOUT_DURATION_MS / 1000)
      );
    }
  }

  return { allowed: true };
}

export async function recordLoginFailure(email, ip) {
  await insertEvent({ kind: 'login_fail', email, ip });
}

export async function clearLoginFailures(email) {
  const normalized = email?.trim().toLowerCase();
  if (!normalized) return;

  if (cloudReady) {
    await supabase.from('auth_rate_events').delete().eq('kind', 'login_fail').eq('email', normalized);
    return;
  }

  const db = await getDb();
  if (!db) {
    for (let i = memoryEvents.length - 1; i >= 0; i -= 1) {
      if (memoryEvents[i].kind === 'login_fail' && memoryEvents[i].email === normalized) {
        memoryEvents.splice(i, 1);
      }
    }
    return;
  }
  await db.run(`DELETE FROM auth_rate_events WHERE kind = 'login_fail' AND email = ?`, [normalized]);
}

export async function checkSignupAllowed(ip) {
  if (!ip || ip === 'unknown') return { allowed: true };
  const count = await countEvents({ kind: 'signup', ip, windowMs: SIGNUP_WINDOW_MS });
  if (count >= MAX_SIGNUPS_PER_IP) {
    return deny('Too many sign-up attempts from this network. Please try again later.', 3600);
  }
  return { allowed: true };
}

export async function recordSignupAttempt(ip) {
  await insertEvent({ kind: 'signup', ip });
}

export async function checkResendAllowed(email, ip) {
  const hit = await checkAuthHitAllowed('resend', ip);
  if (!hit.allowed) return hit;

  if (email) {
    const emailCount = await countEvents({
      kind: 'resend',
      email,
      windowMs: SIGNUP_WINDOW_MS,
    });
    if (emailCount >= MAX_RESEND_PER_EMAIL) {
      return deny('Too many verification emails requested. Please try again later.', 3600);
    }
  }
  return { allowed: true };
}

export async function recordResendAttempt(email, ip) {
  await insertEvent({ kind: 'resend', email, ip });
}

export function parseJwtExpiresInSeconds(value) {
  const raw = String(value || '24h').trim();
  const match = /^(\d+)\s*([smhd])?$/i.exec(raw);
  if (!match) return 24 * 60 * 60;
  const amount = parseInt(match[1], 10);
  const unit = (match[2] || 's').toLowerCase();
  const multipliers = { s: 1, m: 60, h: 3600, d: 86400 };
  return amount * (multipliers[unit] || 1);
}
