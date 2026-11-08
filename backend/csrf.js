import crypto from 'crypto';
import { parseCookies } from './cookieAuth.js';

export const CSRF_COOKIE = 'st_csrf';
export const CSRF_HEADER = 'x-csrf-token';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const PUBLIC_MUTATIONS = [
  /^\/api\/auth\/(login|signup|forgot-password|set-password|verify-email|resend-verification|complete-signup|signup-charge)/,
  /^\/api\/public\//,
  /^\/api\/webhooks\//,
  /^\/api\/cron\//,
  /^\/api\/student-portal\/(login|schools|logout)/,
  /^\/api\/staff-portal\/[^/]+\/login/,
  /^\/api\/public\/staff-portal\//,
  /^\/api\/scanner\/(mark|release)\//,
];

function csrfCookieFlags(maxAgeSec) {
  const production =
    Boolean(process.env.RENDER) || Boolean(process.env.VERCEL) || process.env.NODE_ENV === 'production';
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

export function createCsrfToken() {
  return crypto.randomBytes(32).toString('base64url');
}

export function setCsrfCookie(res, token, maxAgeSec) {
  const parts = [`${CSRF_COOKIE}=${encodeURIComponent(token)}`, ...csrfCookieFlags(Math.max(60, Number(maxAgeSec) || 60 * 60 * 12))];
  res.append('Set-Cookie', parts.join('; '));
  return token;
}

export function clearCsrfCookie(res) {
  res.append('Set-Cookie', [`${CSRF_COOKIE}=`, ...csrfCookieFlags(0)].join('; '));
}

export function readCsrfCookie(req) {
  return parseCookies(req)[CSRF_COOKIE] || '';
}

export function readCsrfHeader(req) {
  return String(req.headers?.[CSRF_HEADER] || req.headers?.['x-xsrf-token'] || '').trim();
}

export function csrfTokensMatch(cookieToken, headerToken) {
  const left = String(cookieToken || '');
  const right = String(headerToken || '');
  if (!left || !right || left.length !== right.length) return false;
  return crypto.timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

function isPublicMutation(path) {
  return PUBLIC_MUTATIONS.some((pattern) => pattern.test(path));
}

function hasCookieSession(req) {
  const cookies = parseCookies(req);
  return Boolean(cookies.st_session || cookies.st_staff || cookies.st_student);
}

export function issueCsrf(res, maxAgeSec) {
  return setCsrfCookie(res, createCsrfToken(), maxAgeSec);
}

export function requireCsrf(req, res, next) {
  if (SAFE_METHODS.has(String(req.method || '').toUpperCase())) return next();
  const path = String(req.path || req.originalUrl || '').split('?')[0];
  if (isPublicMutation(path)) return next();
  if (!hasCookieSession(req)) return next();
  if (csrfTokensMatch(readCsrfCookie(req), readCsrfHeader(req))) return next();
  return res.status(403).json({ error: 'This request could not be verified. Refresh the page and try again.' });
}
