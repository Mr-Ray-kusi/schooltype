export const STAFF_PORTAL_SESSION_KEY = 'staffPortalSession';

export function portalPathname(pathname = '') {
  const path = String(pathname || '').split('?')[0].split('#')[0];
  if (path.length > 1 && path.endsWith('/')) return path.slice(0, -1);
  return path || '/';
}

export function readStaffPortalSession(storage) {
  try {
    const parsed = JSON.parse(storage?.getItem?.(STAFF_PORTAL_SESSION_KEY) || 'null');
    if (!parsed || typeof parsed !== 'object' || !parsed.sessionToken) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Keep a refresh on the same portal link signed in. A different link does not reuse it. */
export function staffPortalSessionForPath(session, pathname) {
  if (!session?.sessionToken) return null;
  const path = portalPathname(pathname);
  const saved = portalPathname(session.portalPath || '');
  if (saved && saved === path) return session;

  const tokenMatch = path.match(/^\/staff-portal\/([^/]+)$/);
  if (tokenMatch && session.portalToken && decodeURIComponent(tokenMatch[1]) === String(session.portalToken)) {
    return session;
  }

  const slugMatch = path.match(/^\/([^/]+)\/staff-portal$/);
  if (slugMatch && slugMatch[1] !== 'staff-portal' && session.schoolSlug && decodeURIComponent(slugMatch[1]) === String(session.schoolSlug)) {
    return session;
  }

  return null;
}
