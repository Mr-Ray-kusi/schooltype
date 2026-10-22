const store = new Map();
const MAX_ENTRIES = 80;

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

export function cacheInvalidate(prefix = '') {
  if (!prefix) {
    store.clear();
    return;
  }
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

export function cacheStats() {
  evictExpired();
  return { entries: store.size, max: MAX_ENTRIES };
}
