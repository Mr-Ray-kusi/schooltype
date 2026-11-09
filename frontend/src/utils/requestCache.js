import { cacheGetResponse, readCachedGet } from './offlineQueue';

const memory = new Map();
const inflight = new Map();
const MAX_MEMORY_ENTRIES = 80;
const SNAPSHOT_KEY = 'st_get_cache';
const SNAPSHOT_MAX = 220000;
const SNAPSHOT_KEYS = /^(dashboard:|classes$|subjects$|notifications:unread$|students:|staff:|alumni$)/;

function hydrateFromStorage() {
  if (typeof sessionStorage === 'undefined') return;
  const sources = [];
  try {
    sources.push(sessionStorage.getItem(SNAPSHOT_KEY));
  } catch {
    // private mode
  }
  try {
    sources.push(localStorage.getItem(SNAPSHOT_KEY));
  } catch {
    // private mode
  }
  for (const raw of sources) {
    if (!raw) continue;
    try {
      const entries = JSON.parse(raw);
      if (!Array.isArray(entries)) continue;
      entries.forEach((entry) => {
        if (!entry?.key || entry.data === undefined) return;
        if (memory.has(entry.key)) return;
        memory.set(entry.key, { at: Number(entry.at) || 0, data: entry.data });
      });
      return;
    } catch {
      // ignore corrupt snapshot
    }
  }
}

hydrateFromStorage();

let persistTimer = 0;
function persistSnapshot() {
  if (typeof sessionStorage === 'undefined') return;
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = 0;
    const entries = [];
    for (const [key, value] of memory.entries()) {
      if (!SNAPSHOT_KEYS.test(key)) continue;
      entries.push({ key, at: value.at, data: value.data });
    }
    let raw = '[]';
    try {
      raw = JSON.stringify(entries);
    } catch {
      return;
    }
    if (raw.length > SNAPSHOT_MAX) {
      raw = JSON.stringify(entries.slice(0, 8));
    }
    try {
      sessionStorage.setItem(SNAPSHOT_KEY, raw);
    } catch {
      // ignore quota
    }
    try {
      localStorage.setItem(SNAPSHOT_KEY, raw);
    } catch {
      // ignore quota
    }
  }, 40);
}

export function peekCache(key) {
  return memory.get(key)?.data;
}

export function clearPersistedCache() {
  memory.clear();
  inflight.clear();
  try {
    sessionStorage.removeItem(SNAPSHOT_KEY);
  } catch {
    // ignore
  }
  try {
    localStorage.removeItem(SNAPSHOT_KEY);
  } catch {
    // ignore
  }
}

export function isCacheFresh(key, ttlMs) {
  const hit = memory.get(key);
  return Boolean(hit && Date.now() - hit.at < ttlMs);
}

/** Keep a GET for this browser session. A full reload drops it; logout clears it. */
export function sessionGet(key, fetcher) {
  return cachedGet(key, fetcher, Number.POSITIVE_INFINITY);
}

export function rememberSession(key, data) {
  memory.set(key, { at: Date.now(), data });
}

/**
 * GET cache. Dashboard uses 5 minutes; lists default to 45s.
 * In-flight requests for the same key are deduped.
 */
export async function cachedGet(key, fetcher, ttlMs = 45000) {
  const hit = memory.get(key);
  if (hit && Date.now() - hit.at < ttlMs) {
    return hit.data;
  }
  if (inflight.has(key)) {
    return inflight.get(key);
  }

  const pending = (async () => {
    try {
      const data = await fetcher();
      memory.set(key, { at: Date.now(), data });
      while (memory.size > MAX_MEMORY_ENTRIES) {
        const oldest = memory.keys().next().value;
        if (oldest === undefined) break;
        memory.delete(oldest);
      }
      persistSnapshot();
      cacheGetResponse(key, data);
      return data;
    } catch (error) {
      const offline = typeof navigator !== 'undefined' && !navigator.onLine;
      if (offline || !error?.response) {
        const cached = hit?.data ?? (await readCachedGet(key));
        if (cached != null) return cached;
      }
      throw error;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, pending);
  return pending;
}

/**
 * Return cached data immediately (even if stale) and refresh in the background.
 */
export async function staleGet(key, fetcher, ttlMs = 45000, onFresh) {
  const hit = memory.get(key);
  if (hit?.data !== undefined) {
    if (Date.now() - hit.at >= ttlMs) {
      cachedGet(key, fetcher, 0)
        .then((data) => onFresh?.(data))
        .catch(() => {});
    } else {
      onFresh?.(hit.data);
    }
    return hit.data;
  }
  const data = await cachedGet(key, fetcher, ttlMs);
  onFresh?.(data);
  return data;
}

export async function forceGet(key, fetcher) {
  invalidateCache(key);
  return cachedGet(key, fetcher, 0);
}

export function invalidateCache(prefix = '') {
  if (!prefix) {
    memory.clear();
    inflight.clear();
    persistSnapshot();
    return;
  }
  for (const key of memory.keys()) {
    if (key.startsWith(prefix)) memory.delete(key);
  }
  for (const key of inflight.keys()) {
    if (key.startsWith(prefix)) inflight.delete(key);
  }
  persistSnapshot();
}

const SCHOOL_DATA_EVENT = 'schooltype:data';
const SCHOOL_DATA_REV_KEY = 'st_data_rev';

export function notifySchoolDataChanged(prefixes = ['staff']) {
  const list = Array.isArray(prefixes) ? prefixes.filter(Boolean) : [prefixes].filter(Boolean);
  if (!list.length) invalidateCache();
  else list.forEach((prefix) => invalidateCache(prefix));
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(SCHOOL_DATA_EVENT, { detail: { prefixes: list } }));
  try {
    localStorage.setItem(SCHOOL_DATA_REV_KEY, JSON.stringify({ at: Date.now(), prefixes: list }));
  } catch {
    // private mode
  }
}

export function onSchoolDataChanged(handler) {
  if (typeof window === 'undefined' || typeof handler !== 'function') return () => {};
  const onEvent = (event) => handler(event.detail?.prefixes || []);
  const onStorage = (event) => {
    if (event.key !== SCHOOL_DATA_REV_KEY) return;
    try {
      const parsed = JSON.parse(event.newValue || '{}');
      handler(parsed.prefixes || []);
    } catch {
      handler([]);
    }
  };
  const onVisible = () => {
    if (document.visibilityState === 'visible') handler(['visible']);
  };
  window.addEventListener(SCHOOL_DATA_EVENT, onEvent);
  window.addEventListener('storage', onStorage);
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    window.removeEventListener(SCHOOL_DATA_EVENT, onEvent);
    window.removeEventListener('storage', onStorage);
    document.removeEventListener('visibilitychange', onVisible);
  };
}

export const DASHBOARD_CACHE_MS = 5 * 60 * 1000;
export const REPORT_CACHE_MS = 5 * 60 * 1000;
