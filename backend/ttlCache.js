import { platformSupabase } from './supabaseClient.js';
import { isSharedRuntimeEnabled } from './sharedRuntime.js';

const store = new Map();
// One school keeps a handful of hot keys (dashboard, roster, fees, analytics).
// 20 schools at once need room so a morning of scans does not evict them all.
const MAX_ENTRIES = 800;
let seenGeneration = null;
let bumpTimer = null;
let syncTimer = null;

function evictExpired(now = Date.now()) {
  for (const [key, hit] of store.entries()) {
    if (!hit || now > hit.expiresAt) store.delete(key);
  }
}

function evictOldest() {
  const first = store.keys().next().value;
  if (first !== undefined) store.delete(first);
}

export function cacheGet(key) {
  const hit = store.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    store.delete(key);
    return null;
  }
  return hit.value;
}

export function cacheSet(key, value, ttlMs) {
  evictExpired();
  if (store.has(key)) store.delete(key);
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
  while (store.size > MAX_ENTRIES) evictOldest();
  return value;
}

function clearLocal(prefix = '') {
  if (!prefix) {
    store.clear();
    return;
  }
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

async function publishCacheBump() {
  if (!platformSupabase || !isSharedRuntimeEnabled()) return;
  try {
    const { data, error } = await platformSupabase
      .from('runtime_flags')
      .select('value')
      .eq('name', 'cache_generation')
      .maybeSingle();
    if (error) return;
    const next = String((Number(data?.value) || 0) + 1);
    const saved = await platformSupabase.from('runtime_flags').upsert(
      { name: 'cache_generation', value: next, updated_at: new Date().toISOString() },
      { onConflict: 'name' }
    );
    if (!saved.error) seenGeneration = next;
  } catch {
    // another server will keep its cache until the next successful bump
  }
}

function scheduleCacheBump() {
  if (!isSharedRuntimeEnabled()) return;
  if (bumpTimer) return;
  bumpTimer = setTimeout(() => {
    bumpTimer = null;
    void publishCacheBump();
  }, 40);
  if (bumpTimer.unref) bumpTimer.unref();
}

async function pullCacheGeneration() {
  if (!platformSupabase || !isSharedRuntimeEnabled()) return;
  try {
    const { data, error } = await platformSupabase
      .from('runtime_flags')
      .select('value')
      .eq('name', 'cache_generation')
      .maybeSingle();
    if (error || !data) return;
    const value = String(data.value || '0');
    if (seenGeneration == null) {
      seenGeneration = value;
      return;
    }
    if (value !== seenGeneration) {
      seenGeneration = value;
      clearLocal('');
    }
  } catch {
    // keep serving this process cache until the next check
  }
}

export function startSharedCacheSync() {
  if (syncTimer || !platformSupabase) return;
  void pullCacheGeneration();
  syncTimer = setInterval(() => {
    void pullCacheGeneration();
  }, 1000);
  if (syncTimer.unref) syncTimer.unref();
}

export function cacheInvalidate(prefix = '') {
  clearLocal(prefix);
  scheduleCacheBump();
}

export function cacheStats() {
  evictExpired();
  return { entries: store.size, max: MAX_ENTRIES };
}
