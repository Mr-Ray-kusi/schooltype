import dns from 'node:dns/promises';
import { describeDbPooler } from './runtimeHealth.js';

export function rawDbUrl() {
  return String(process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || '')
    .trim()
    .replace(/^['"]|['"]$/g, '');
}

/**
 * Transaction pooler URI:
 *   postgresql://postgres.[PROJECT-REF]:PASSWORD@….pooler.supabase.com:6543/postgres
 * A common paste error puts the project ref in the database name.
 * Rewrite that without re-serializing the password.
 */
export function normalizePoolerUrl(raw = rawDbUrl()) {
  const notes = [];
  let url = raw.replace(/^postgres:/i, 'postgresql:');
  if (/\/postgres\.[A-Za-z0-9]+(?=[?#]|$)/.test(url)) {
    url = url.replace(/\/postgres\.[A-Za-z0-9]+(?=[?#]|$)/, '/postgres');
    notes.push('database_was_project_ref');
  }
  const pooler = /pooler\.supabase\.com|:6543\b/i.test(url);
  return { url, rewrote: notes.length > 0, notes, pooler };
}

function safeError(error) {
  const code = error?.code || error?.errno || 'connect_failed';
  const text = String(error?.message || '');
  if (/password authentication failed/i.test(text) || code === '28P01') {
    return { code: '28P01', message: 'Pooler rejected the database password. Use the database password from Supabase, not the anon or service-role key.' };
  }
  if (code === '3D000') return { code, message: 'Pooler database name is wrong. The path must be /postgres.' };
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return { code, message: 'Pooler host was not found.' };
  if (code === 'ECONNREFUSED') return { code, message: 'Pooler refused the connection.' };
  if (/timeout expired|ETIMEDOUT|CONNECTION_TIMEOUT/i.test(text) || code === 'ETIMEDOUT') {
    return { code: 'ETIMEDOUT', message: 'Pooler timed out. Confirm the Transaction pooler URI (port 6543) and that this host can reach it.' };
  }
  if (/self-signed|certificate|ssl/i.test(text)) return { code: 'SSL', message: 'Pooler SSL handshake failed.' };
  return { code, message: 'Pooler connection failed.' };
}

async function connectOptions(connectionString) {
  let parsed;
  try {
    parsed = new URL(connectionString.replace(/^postgres:/i, 'postgresql:'));
  } catch {
    return { connectionString, connectionTimeoutMillis: 8000, ssl: { rejectUnauthorized: false } };
  }

  let host = parsed.hostname;
  const ssl = { rejectUnauthorized: false };
  try {
    const v4 = await dns.lookup(host, { family: 4 });
    if (v4?.address) {
      ssl.servername = host;
      host = v4.address;
    }
  } catch {
    // keep hostname
  }

  return {
    host,
    port: Number(parsed.port || 6543),
    user: decodeURIComponent(parsed.username || 'postgres'),
    password: decodeURIComponent(parsed.password || ''),
    database: decodeURIComponent((parsed.pathname || '/postgres').replace(/^\//, '') || 'postgres'),
    ssl,
    connectionTimeoutMillis: 8000,
  };
}

async function tryConnect(Client, connectionString) {
  const options = await connectOptions(connectionString);
  const client = new Client(options);
  try {
    await client.connect();
    const result = await client.query('select 1 as ok');
    await client.end();
    return { ok: Number(result.rows?.[0]?.ok) === 1, error: null };
  } catch (error) {
    try {
      await client.end();
    } catch {
      // already closed
    }
    return { ok: false, error: safeError(error) };
  }
}

export async function pingDbPooler() {
  const info = describeDbPooler();
  const raw = rawDbUrl();
  if (!raw) {
    return { ...info, ok: false, latency_ms: null };
  }

  let pg;
  try {
    pg = await import('pg');
  } catch {
    return { ...info, ok: false, error: { code: 'NO_PG', message: 'pg is not installed on this host.' } };
  }
  const Client = pg.default?.Client || pg.Client;
  const normalized = normalizePoolerUrl(raw);
  const started = Date.now();

  const first = await tryConnect(Client, normalized.url);
  if (first.ok) {
    return {
      ...info,
      pooler: normalized.pooler || info.pooler,
      ok: true,
      latency_ms: Date.now() - started,
      normalized: normalized.rewrote,
      notes: normalized.notes,
    };
  }

  if (normalized.rewrote) {
    const fallback = await tryConnect(Client, raw);
    if (fallback.ok) {
      return { ...info, ok: true, latency_ms: Date.now() - started, normalized: false };
    }
  }

  return {
    ...info,
    pooler: normalized.pooler || info.pooler,
    ok: false,
    latency_ms: Date.now() - started,
    normalized: normalized.rewrote,
    notes: normalized.notes,
    error: first.error,
  };
}
