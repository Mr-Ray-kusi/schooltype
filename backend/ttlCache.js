import { platformSupabase } from './supabaseClient.js';
import { isSharedRuntimeEnabled } from './sharedRuntime.js';

const store = new Map();
const MAX_ENTRIES = 1500;
let seenGeneration = null;
let bumpTimer = null;
let syncTimer = null;
const pendingPrefixes = new Set();

function evictExpired(now = Date.now()) {
  for (const [key, hit] of store.entries()) {
    if (!hit || now > hit.expiresAt) store.delete(key);
  }
}

function evictOldest() {
  const first = store.keys().next().value;
  if (first !== undefined) store.delete(first);
}

function keyMatchesPrefix(key, prefix) {
  if (!prefix) return true;
  return key.startsWith(prefix) || key.includes(`:${prefix}`) || key.includes(`${prefix}:`);
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
    if (keyMatchesPrefix(key, prefix)) store.delete(key);
  }
}

function encodeBump(generation, prefixes) {
  if (!prefixes?.length || prefixes.includes('')) return String(generation);
  return JSON.stringify({ g: generation, p: prefixes });
}

function decodeBump(raw) {
  const text = String(raw || '0');
  if (text.startsWith('{')) {
    try {
      const parsed = JSON.parse(text);
      const generation = String(parsed?.g ?? text);
      const prefixes = Array.isArray(parsed?.p) ? parsed.p.map(String) : [''];
      return { generation, prefixes: prefixes.length ? prefixes : [''] };
    } catch {
      return { generation: text, prefixes: [''] };
    }
  }
  return { generation: text, prefixes: [''] };
}

async function publishCacheBump() {
  if (!platformSupabase || !isSharedRuntimeEnabled()) return;
  const prefixes = pendingPrefixes.has('') ? [''] : [...pendingPrefixes];
  pendingPrefixes.clear();
  try {
    const { data, error } = await platformSupabase
      .from('runtime_flags')
      .select('value')
      .eq('name', 'cache_generation')
      .maybeSingle();
    if (error) return;
    const current = decodeBump(data?.value);
    const nextGen = String((Number(current.generation) || 0) + 1);
    const next = encodeBump(nextGen, prefixes);
    const saved = await platformSupabase.from('runtime_flags').upsert(
      { name: 'cache_generation', value: next, updated_at: new Date().toISOString() },
      { onConflict: 'name' }
    );
    if (!saved.error) seenGeneration = next;
  } catch {
    // another server will keep its cache until the next successful bump
  }
}

function scheduleCacheBump(prefix = '') {
  if (!isSharedRuntimeEnabled()) return;
  pendingPrefixes.add(prefix);
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
      const bump = decodeBump(value);
      seenGeneration = value;
      for (const prefix of bump.prefixes) clearLocal(prefix);
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
  scheduleCacheBump(prefix);
}

export function cacheStats() {
  evictExpired();
  return { entries: store.size, max: MAX_ENTRIES };
}
