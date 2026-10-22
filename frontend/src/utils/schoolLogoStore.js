import { cacheGetResponse, readCachedGet } from './offlineQueue';

const LOGO_KEY = 'school-logo';

export async function readStoredSchoolLogo() {
  try {
    const data = await readCachedGet(LOGO_KEY);
    return typeof data === 'string' && data ? data : null;
  } catch {
    return null;
  }
}

export function writeStoredSchoolLogo(logoUrl) {
  if (!logoUrl || typeof logoUrl !== 'string') return;
  cacheGetResponse(LOGO_KEY, logoUrl).catch(() => {});
}

export function clearStoredSchoolLogo() {
  cacheGetResponse(LOGO_KEY, null).catch(() => {});
}
