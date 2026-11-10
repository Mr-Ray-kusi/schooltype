import { cacheGetResponse, readCachedGet } from './offlineQueue';

const LOGO_KEY = 'school-logo';
const memory = new Map();

function storageKey(schoolId) {
  return schoolId ? `${LOGO_KEY}:${schoolId}` : LOGO_KEY;
}

function remember(key, logoUrl) {
  memory.set(key, logoUrl);
  try {
    sessionStorage.setItem(key, logoUrl);
  } catch {
    // The image is larger than this tab can keep. IndexedDB still has it.
  }
}

export function peekSchoolLogo(schoolId) {
  const key = storageKey(schoolId);
  if (memory.has(key)) return memory.get(key) || '';
  try {
    const stored = sessionStorage.getItem(key);
    if (stored) {
      memory.set(key, stored);
      return stored;
    }
  } catch {
    // private mode
  }
  return '';
}

export async function readStoredSchoolLogo(schoolId) {
  const key = storageKey(schoolId);
  const peeked = peekSchoolLogo(schoolId);
  if (peeked) return peeked;
  try {
    const data = await readCachedGet(key);
    if (typeof data === 'string' && data) {
      remember(key, data);
      return data;
    }
  } catch {
    // ignore
  }
  if (schoolId) return readStoredSchoolLogo('');
  return null;
}

export function writeStoredSchoolLogo(logoUrl, schoolId) {
  if (!logoUrl || typeof logoUrl !== 'string') return;
  const key = storageKey(schoolId);
  remember(key, logoUrl);
  if (!schoolId) remember(LOGO_KEY, logoUrl);
  cacheGetResponse(key, logoUrl).catch(() => {});
}

export function clearStoredSchoolLogo() {
  memory.clear();
  try {
    const drop = [];
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const key = sessionStorage.key(i);
      if (key && key.startsWith(LOGO_KEY)) drop.push(key);
    }
    drop.forEach((key) => sessionStorage.removeItem(key));
  } catch {
    // private mode
  }
  cacheGetResponse(LOGO_KEY, null).catch(() => {});
}
