const DB_NAME = 'schootype-offline';
const DB_VERSION = 1;
const STORE_PENDING = 'pending';
const STORE_CACHE = 'getCache';

const listeners = new Set();

const notify = () => {
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      // ignore
    }
  });
};

export const subscribeOffline = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

const openDb = () =>
  new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_PENDING)) {
        db.createObjectStore(STORE_PENDING, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_CACHE)) {
        db.createObjectStore(STORE_CACHE, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

const withStore = async (storeName, mode, fn) => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const result = fn(store);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
  });
};

const uuid = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `off-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

export const OFFLINE_MUTATION_PREFIXES = [
  '/api/students',
  '/api/staff',
  '/api/non-staff',
  '/api/attendance',
  '/api/classes',
  '/api/subjects',
  '/api/scanner/mark',
];

export const isOfflineMutationUrl = (url = '') => {
  const path = String(url).split('?')[0];
  return OFFLINE_MUTATION_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
};

export async function enqueueMutation({ method, url, data, headers, label }) {
  const item = {
    id: uuid(),
    method: String(method || 'post').toLowerCase(),
    url,
    data: data ?? null,
    headers: headers || {},
    label: label || `${String(method || 'POST').toUpperCase()} ${url}`,
    createdAt: new Date().toISOString(),
  };
  await withStore(STORE_PENDING, 'readwrite', (store) => store.put(item));
  notify();
  return item;
}

export async function listPending() {
  try {
    return await withStore(
      STORE_PENDING,
      'readonly',
      (store) =>
        new Promise((resolve, reject) => {
          const req = store.getAll();
          req.onsuccess = () => resolve(req.result || []);
          req.onerror = () => reject(req.error);
        })
    );
  } catch {
    return [];
  }
}

export async function removePending(id) {
  await withStore(STORE_PENDING, 'readwrite', (store) => store.delete(id));
  notify();
}

export async function cacheGetResponse(key, data) {
  try {
    await withStore(STORE_CACHE, 'readwrite', (store) =>
      store.put({ key, data, at: Date.now() })
    );
  } catch {
    // ignore
  }
}

export async function readCachedGet(key) {
  try {
    return await withStore(
      STORE_CACHE,
      'readonly',
      (store) =>
        new Promise((resolve, reject) => {
          const req = store.get(key);
          req.onsuccess = () => resolve(req.result?.data ?? null);
          req.onerror = () => reject(req.error);
        })
    );
  } catch {
    return null;
  }
}

export async function syncPending(axios) {
  const pending = await listPending();
  const results = { synced: 0, failed: 0 };
  for (const item of pending.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))) {
    try {
      await axios({
        method: item.method,
        url: item.url,
        data: item.data,
        headers: item.headers,
        timeout: 25000,
        skipOfflineQueue: true,
      });
      await removePending(item.id);
      results.synced += 1;
    } catch (error) {
      if (!error?.response) {
        results.failed += 1;
        break;
      }
      await removePending(item.id);
      results.failed += 1;
    }
  }
  notify();
  return results;
}

export function mutationLabel(method, url, data) {
  const path = String(url).split('?')[0];
  const name = data?.name ? ` (${data.name})` : '';
  if (path.includes('/students')) return `Student${name}`;
  if (path.includes('/staff') && !path.includes('portal')) return `Staff${name}`;
  if (path.includes('/non-staff')) return `Non-staff${name}`;
  if (path.includes('/attendance')) return 'Attendance mark';
  if (path.includes('/classes')) return `Class${name}`;
  if (path.includes('/subjects')) return `Subject${name}`;
  return `${String(method || 'POST').toUpperCase()} ${path}`;
}
