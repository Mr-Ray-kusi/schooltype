export const SESSION_COOKIE = 'st_session';
export const REFRESH_COOKIE = 'st_refresh';
export const STAFF_COOKIE = 'st_staff';
export const STAFF_REFRESH_COOKIE = 'st_staff_refresh';
export const STUDENT_COOKIE = 'st_student';
export const STUDENT_REFRESH_COOKIE = 'st_student_refresh';

export function parseCookies(req) {
  const header = String(req.headers?.cookie || '');
  const out = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(value);
    } catch {
      out[key] = value;
    }
  }
  return out;
}

export function readAccessToken(req) {
  const header = String(req.headers?.authorization || '');
  if (header.startsWith('Bearer ')) {
    const bearer = header.slice(7).trim();
    if (bearer) return bearer;
  }
  const cookies = parseCookies(req);
  return cookies[SESSION_COOKIE] || cookies[STAFF_COOKIE] || cookies[STUDENT_COOKIE] || '';
}

export function readStaffAccessToken(req) {
  const header = String(req.headers?.authorization || '');
  if (header.startsWith('Bearer ')) {
    const bearer = header.slice(7).trim();
    if (bearer) return bearer;
  }
  return parseCookies(req)[STAFF_COOKIE] || '';
}

export function readStudentAccessToken(req) {
  const header = String(req.headers['x-student-portal-token'] || '').trim();
  if (header) return header;
  return parseCookies(req)[STUDENT_COOKIE] || '';
}

export function readRefreshToken(req) {
  return parseCookies(req)[REFRESH_COOKIE] || '';
}

export function readStaffRefreshToken(req) {
  return parseCookies(req)[STAFF_REFRESH_COOKIE] || '';
}

export function readStudentRefreshToken(req) {
  return parseCookies(req)[STUDENT_REFRESH_COOKIE] || '';
}

function sessionCookieFlags(maxAgeSec) {
  // The site is on Vercel and the API is on Render, so the browser treats the
  // session as cross-site. SameSite=None is required for that cookie to be sent.
  // Local http://localhost stays Lax because None requires Secure.
  const production = Boolean(process.env.RENDER) || Boolean(process.env.VERCEL) || process.env.NODE_ENV === 'production';
  const parts = ['Path=/', 'HttpOnly'];
  if (production) {
    parts.push('SameSite=None', 'Secure');
  } else {
    parts.push('SameSite=Lax');
  }
  if (maxAgeSec !== undefined) {
    parts.push(`Max-Age=${Math.max(0, Number(maxAgeSec) || 0)}`);
  }
  return parts;
}

function setNamedCookie(res, name, token, maxAgeSec) {
  const parts = [
    `${name}=${encodeURIComponent(token)}`,
    ...sessionCookieFlags(Math.max(60, Number(maxAgeSec) || 60 * 60 * 12)),
  ];
  res.append('Set-Cookie', parts.join('; '));
}

function clearNamedCookie(res, name) {
  res.append('Set-Cookie', [`${name}=`, ...sessionCookieFlags(0)].join('; '));
}

export function setSessionCookie(res, token, maxAgeSec) {
  setNamedCookie(res, SESSION_COOKIE, token, maxAgeSec);
}

export function clearSessionCookie(res) {
  clearNamedCookie(res, SESSION_COOKIE);
}

export function setRefreshCookie(res, token, maxAgeSec) {
  setNamedCookie(res, REFRESH_COOKIE, token, maxAgeSec);
}

export function clearRefreshCookie(res) {
  clearNamedCookie(res, REFRESH_COOKIE);
}

export function setStaffSessionCookie(res, token, maxAgeSec) {
  setNamedCookie(res, STAFF_COOKIE, token, Math.min(Number(maxAgeSec) || 4 * 60 * 60, 4 * 60 * 60));
}

export function clearStaffSessionCookie(res) {
  clearNamedCookie(res, STAFF_COOKIE);
}

export function setStaffRefreshCookie(res, token, maxAgeSec) {
  setNamedCookie(res, STAFF_REFRESH_COOKIE, token, Math.min(Number(maxAgeSec) || 4 * 60 * 60, 4 * 60 * 60));
}

export function clearStaffRefreshCookie(res) {
  clearNamedCookie(res, STAFF_REFRESH_COOKIE);
}

export function setStudentSessionCookie(res, token, maxAgeSec) {
  setNamedCookie(res, STUDENT_COOKIE, token, Math.min(Number(maxAgeSec) || 4 * 60 * 60, 4 * 60 * 60));
}

export function clearStudentSessionCookie(res) {
  clearNamedCookie(res, STUDENT_COOKIE);
}

export function setStudentRefreshCookie(res, token, maxAgeSec) {
  setNamedCookie(res, STUDENT_REFRESH_COOKIE, token, Math.min(Number(maxAgeSec) || 4 * 60 * 60, 4 * 60 * 60));
}

export function clearStudentRefreshCookie(res) {
  clearNamedCookie(res, STUDENT_REFRESH_COOKIE);
}

export function clearAllAuthCookies(res) {
  clearSessionCookie(res);
  clearRefreshCookie(res);
  clearStaffSessionCookie(res);
  clearStaffRefreshCookie(res);
  clearStudentSessionCookie(res);
  clearStudentRefreshCookie(res);
}
