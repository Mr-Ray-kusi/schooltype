import crypto from 'crypto';
import { platformSupabase, supabase } from './supabaseClient.js';
import { normalizePoolerUrl, rawDbUrl } from './dbPooler.js';

function lockDb() {
  return platformSupabase || supabase;
}

function lockKey(name) {
  const digest = crypto.createHash('sha256').update(String(name || 'job')).digest();
  return digest.readInt32BE(0);
}

async function withPgAdvisoryLock(name, run) {
  const raw = rawDbUrl();
  if (!raw) return { attempted: false, ran: false, result: undefined };
  let pg;
  try {
    pg = await import('pg');
  } catch {
    return { attempted: false, ran: false, result: undefined };
  }
  const Client = pg.default?.Client || pg.Client;
  const { url } = normalizePoolerUrl(raw);
  const client = new Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 8000,
  });
  try {
    await client.connect();
    const key = lockKey(name);
    const { rows } = await client.query('SELECT pg_try_advisory_lock($1) AS locked', [key]);
    if (!rows?.[0]?.locked) {
      await client.end().catch(() => {});
      return { attempted: true, ran: false, result: undefined };
    }
    try {
      const result = await run();
      return { attempted: true, ran: true, result };
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [key]).catch(() => {});
      await client.end().catch(() => {});
    }
  } catch (error) {
    try {
      await client.end();
    } catch {
      // already closed
    }
    console.warn(`Job lock ${name} via Postgres failed:`, error.message || error);
    return { attempted: false, ran: false, result: undefined };
  }
}

async function withTableLock(name, ttlMs, run) {
  const db = lockDb();
  if (!db) return { attempted: false, ran: false, result: undefined };
  const now = Date.now();
  const holder = `${process.env.RENDER_INSTANCE_ID || process.pid}:${now}`;
  const until = new Date(now + Math.max(5000, ttlMs)).toISOString();
  try {
    const { data: current } = await db.from('job_locks').select('name, holder, expires_at').eq('name', name).maybeSingle();
    if (current?.expires_at && new Date(current.expires_at).getTime() > now) {
      return { attempted: true, ran: false, result: undefined };
    }
    const payload = { name, holder, expires_at: until, updated_at: new Date().toISOString() };
    const { error } = await db.from('job_locks').upsert(payload, { onConflict: 'name' });
    if (error) {
      console.warn(`Job lock table ${name}:`, error.message);
      return { attempted: false, ran: false, result: undefined };
    }
    const { data: claimed } = await db.from('job_locks').select('holder').eq('name', name).maybeSingle();
    if (claimed?.holder !== holder) {
      return { attempted: true, ran: false, result: undefined };
    }
    const result = await run();
    return { attempted: true, ran: true, result };
  } catch (error) {
    console.warn(`Job lock ${name} skipped:`, error.message || error);
    return { attempted: false, ran: false, result: undefined };
  }
}

/**
 * Run `fn` on at most one API replica. Prefers a Postgres advisory lock, then a job_locks row.
 * If neither store is available, runs locally so a single-instance dev server still works.
 */
export async function withJobLock(name, ttlMs, fn) {
  const job = String(name || 'job');
  const ttl = Number(ttlMs) > 0 ? Number(ttlMs) : 60 * 1000;
  const pg = await withPgAdvisoryLock(job, fn);
  if (pg.attempted) return pg;
  const table = await withTableLock(job, ttl, fn);
  if (table.attempted) return table;
  return { attempted: false, ran: true, result: await fn() };
}
