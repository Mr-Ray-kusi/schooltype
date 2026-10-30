import { cacheStats } from './ttlCache.js';
import { platformSupabase } from './supabaseClient.js';

const REQUIRED_INDEXES = [
  'idx_students_school_created',
  'idx_students_school_class',
  'idx_students_barcode',
  'idx_staffs_school_created',
  'idx_staffs_barcode',
  'idx_nonstaffs_school_created',
  'idx_nonstaffs_barcode',
  'idx_attendance_school_date',
  'idx_classes_school',
  'idx_subjects_school',
  'idx_student_scores_school_updated',
];

export function describeDbPooler() {
  const raw = String(process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || '').trim();
  if (!raw) {
    return {
      configured: false,
      pooler: false,
      warning:
        'Set SUPABASE_DB_URL to the Supabase transaction pooler (host *.pooler.supabase.com, port 6543). A direct :5432 URL hits the session limit at morning scan time.',
    };
  }
  const pooler = /pooler\.supabase\.com|:6543\b/i.test(raw);
  return {
    configured: true,
    pooler,
    warning: pooler
      ? null
      : 'SUPABASE_DB_URL looks like a direct Postgres connection. Switch to the transaction pooler on port 6543.',
  };
}

function memorySnapshot() {
  const mem = process.memoryUsage();
  const mb = (bytes) => Math.round((Number(bytes) || 0) / 1024 / 102.4) / 10;
  return {
    rss_mb: mb(mem.rss),
    heap_used_mb: mb(mem.heapUsed),
    heap_total_mb: mb(mem.heapTotal),
    cache: cacheStats(),
  };
}

export async function checkPerformanceIndexes() {
  const client = platformSupabase;
  if (!client) return { ready: false, checked: false, found: [] };
  try {
    const { data, error } = await client.rpc('schooltype_performance_indexes_ready');
    if (!error && data && typeof data === 'object') {
      return {
        ready: Boolean(data.ready),
        checked: true,
        found: data.found || [],
      };
    }
  } catch {
    // function not installed yet
  }
  return {
    ready: false,
    checked: false,
    found: [],
    warning: 'Run backend/migrations/add_performance_indexes.sql in Supabase so /api/health can confirm the indexes.',
  };
}

export async function buildHealthPayload({ checkDb = false } = {}) {
  const memory = memorySnapshot();
  const pooler = describeDbPooler();
  const payload = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    memory,
    db_pooler: pooler,
    instance: process.env.RENDER_INSTANCE_ID || null,
    plan_hint:
      'Use one larger Render instance. Do not add a second instance until scanner locks and this cache live in Supabase.',
  };
  if (memory.rss_mb >= 400) {
    payload.status = 'degraded';
    payload.memory_warning = 'RSS is high. Render will restart this process if the uncapped cache grows again.';
  }
  if (checkDb) {
    const indexes = await checkPerformanceIndexes();
    payload.indexes = indexes;
    if (indexes.checked && !indexes.ready) {
      payload.status = 'degraded';
      payload.index_warning = `Missing performance indexes. Need ${REQUIRED_INDEXES.length}; found ${(indexes.found || []).length}.`;
    }
  }
  return payload;
}

export function publicHealthView(payload, { detailed = false } = {}) {
  if (detailed) return payload;
  return {
    status: payload?.status || 'ok',
    timestamp: payload?.timestamp || new Date().toISOString(),
  };
}
