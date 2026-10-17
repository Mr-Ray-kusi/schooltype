export const SESSION_COOKIE = 'st_session';

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
  return parseCookies(req)[SESSION_COOKIE] || '';
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

export function setSessionCookie(res, token, maxAgeSec) {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    ...sessionCookieFlags(Math.max(60, Number(maxAgeSec) || 60 * 60 * 12)),
  ];
  res.append('Set-Cookie', parts.join('; '));
}

export function clearSessionCookie(res) {
  const parts = [`${SESSION_COOKIE}=`, ...sessionCookieFlags(0)];
  res.append('Set-Cookie', parts.join('; '));
}
