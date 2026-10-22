import { describeDbPooler } from './runtimeHealth.js';

function connectionString() {
  return String(process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || '').trim();
}

function safeError(error) {
  const code = error?.code || error?.errno || 'connect_failed';
  if (code === '28P01') return { code, message: 'Pooler rejected the database password.' };
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return { code, message: 'Pooler host was not found.' };
  if (code === 'ECONNREFUSED') return { code, message: 'Pooler refused the connection.' };
  if (code === 'ETIMEDOUT' || code === 'CONNECTION_TIMEOUT') return { code, message: 'Pooler timed out.' };
  return { code, message: 'Pooler connection failed.' };
}

export async function pingDbPooler() {
  const info = describeDbPooler();
  const raw = connectionString();
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
  const started = Date.now();
  const client = new Client({
    connectionString: raw,
    connectionTimeoutMillis: 8000,
    ssl: { rejectUnauthorized: false },
  });
  try {
    await client.connect();
    const result = await client.query('select 1 as ok');
    await client.end();
    return {
      ...info,
      ok: Number(result.rows?.[0]?.ok) === 1,
      latency_ms: Date.now() - started,
    };
  } catch (error) {
    try {
      await client.end();
    } catch {
      // already closed
    }
    return {
      ...info,
      ok: false,
      latency_ms: Date.now() - started,
      error: safeError(error),
    };
  }
}
