export function applyBaselineSecurityHeaders(res, { production = false } = {}) {
  res.removeHeader('X-Powered-By');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  if (production) {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  }
}

export function corsOriginAllowed(origin, allowedOrigins, { production = false } = {}) {
  if (!origin) return true;
  const list = (allowedOrigins || []).map((item) => String(item || '').replace(/\/$/, ''));
  if (production) {
    return list.filter((item) => item && item !== '*').includes(origin);
  }
  if (list.includes('*')) return true;
  return list.includes(origin);
}

export function sanitizePublicText(value, maxLen = 200, { multiline = false } = {}) {
  let text = String(value || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  text = multiline ? text.replace(/\r\n/g, '\n').trim() : text.replace(/\s+/g, ' ').trim();
  return text.slice(0, maxLen);
}

const SECRET_TEXT = /sk_(?:live|test)_[A-Za-z0-9]+|postgres(?:ql)?:\/\/\S+|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{8,}|Bearer\s+\S+/gi;

const DATABASE_LEAK = /postgres|supabase|pgrst|jwt|syntax error|violates|duplicate key|relation\b|column\b|econn|enotfound|service[_ ]role|sk_(?:live|test)_|password authentication|node_modules|\bat\s+\S+\s*\(/i;

export function redactSecrets(value) {
  return String(value || '').replace(SECRET_TEXT, '[redacted]');
}

/** Search text placed inside a PostgREST `.or()` filter. Dots, commas, and parentheses change the filter. */
export function sanitizeSearchTerm(value, maxLen = 80) {
  return String(value || '')
    .replace(/[^\p{L}\p{N}\s'-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

export function shouldHideServerError(message) {
  return DATABASE_LEAK.test(String(message || ''));
}

export function scrubErrorResponse(body, statusCode) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  if (typeof body.error !== 'string' && !Object.prototype.hasOwnProperty.call(body, 'details')) return body;
  const next = { ...body };
  if (typeof next.error === 'string') {
    const redacted = redactSecrets(next.error);
    if (statusCode >= 500 && shouldHideServerError(redacted)) {
      console.error('Hidden server error:', redacted.slice(0, 500));
      next.error = 'Request failed';
    } else {
      next.error = redacted.slice(0, 240);
    }
  }
  if (statusCode >= 400 && next.details && typeof next.details === 'object') {
    delete next.details;
  }
  return next;
}

export function safeClientError(error, fallback = 'Request failed') {
  const status = Number(error?.status) || 500;
  const message = redactSecrets(error?.message);
  if (status < 500 && message && !looksLikeInternalError(message)) {
    return { status, error: message.slice(0, 180) };
  }
  return { status: status >= 500 ? status : 500, error: fallback };
}

function looksLikeInternalError(message) {
  const text = String(message || '').toLowerCase();
  return (
    text.includes('password') ||
    text.includes('jwt') ||
    text.includes('supabase') ||
    text.includes('sql') ||
    /\bstack\b/.test(text) ||
    text.includes('econn') ||
    text.includes('enotfound') ||
    shouldHideServerError(message)
  );
}
