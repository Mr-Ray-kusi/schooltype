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

const DATABASE_LEAK = /postgres|supabase|pgrst|syntax error|violates|duplicate key|relation\b|column\b|econn|enotfound|service[_ ]role|sk_(?:live|test)_|password authentication|node_modules|\bat\s+\S+\s*\(/i;
const LOG_LEAK = /syntax error|violates|duplicate key|password authentication|service[_ ]role|node_modules|\n\s*at\s+/i;

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
    if (shouldHideServerError(redacted)) {
      next.error = 'Request failed';
    } else {
      next.error = redacted.slice(0, 240);
    }
  }
  if (statusCode >= 400) {
    delete next.details;
    delete next.hint;
    delete next.stack;
    delete next.query;
  }
  if (statusCode >= 500 || next.error === 'Request failed') {
    const code = String(next.code || '');
    if (/pgrst|postgres|^[0-9A-Z]{5}$/i.test(code)) delete next.code;
  }
  return next;
}

const LOG_METHODS = ['log', 'info', 'warn', 'error', 'debug'];

function logText(value) {
  const text = redactSecrets(String(value || '')).replace(/\s+at\s+\S+\s*\([^)]*\)/g, '').trim();
  if (!text) return 'Internal error';
  if (LOG_LEAK.test(text)) return 'Internal error';
  return text.slice(0, 500);
}

export function safeLogValue(value) {
  if (value instanceof Error) {
    return logText(`${value.name || 'Error'}: ${value.message || ''}`);
  }
  if (typeof value === 'string') return logText(value);
  if (value && typeof value === 'object') {
    const message = value.message || value.error || value.details;
    if (typeof message === 'string' && message.trim()) {
      const code = value.code && String(value.code).length <= 16 ? ` (${value.code})` : '';
      return logText(`${message}${code}`);
    }
    try {
      return logText(JSON.stringify(value));
    } catch {
      return 'Internal error';
    }
  }
  return value;
}

export function installSafeConsole() {
  if (globalThis.__schooltypeSafeConsole) return;
  const original = {};
  for (const method of LOG_METHODS) {
    original[method] = console[method].bind(console);
    console[method] = (...args) => original[method](...args.map(safeLogValue));
  }
  globalThis.__schooltypeSafeConsole = true;
}

const POLLUTION_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const KEY_NAME = /^[A-Za-z][A-Za-z0-9_]{0,48}$/;
const EMAIL_KEY = /email$/i;
const PHONE_KEY = /(^|_)(phone|momo_phone)$/i;
const NUMBER_KEY = /^(page|limit|offset)$/i;
const QUERY_TEXT = /^[\p{L}\p{N}\s.,_@+\-:'()/?=&%]*$/u;

const BODY_ATTACK = [
  /<\s*\/?\s*(script|iframe|object|embed|svg)\b/i,
  /javascript\s*:/i,
  /\bon(?:error|load|click|mouseover|focus)\s*=/i,
  /\bunion\b[\s/*]*\bselect\b/i,
  /\bdrop\b\s+\btable\b/i,
  /\binformation_schema\b/i,
  /\bpg_sleep\s*\(/i,
  /\bor\b\s+\d+\s*=\s*\d+/i,
  /'\s*or\s+'/i,
  /\.\.(?:\/|\\)/,
  /\0/,
];

const QUERY_ATTACK = [
  ...BODY_ATTACK,
  /\binsert\b\s+\binto\b/i,
  /\bdelete\b\s+\bfrom\b/i,
  /;\s*(?:drop|delete|insert|update|select)\b/i,
  /%2e%2e/i,
];

function looksDangerous(value, patterns) {
  const text = String(value || '');
  if (text.length > 4000) {
    const sample = text.slice(0, 200).toLowerCase();
    if (!/[<'\\]|union|select|script|javascript|\.\.\//i.test(sample) && !text.includes('\0')) return false;
  }
  return patterns.some((pattern) => pattern.test(text));
}

function checkString(key, value, where) {
  if (value.includes('\0')) return 'Request blocked';
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value)) return 'Request blocked';
  const largeField = /logo|photo|image|contentbase64|attachment/i.test(key);
  if (value.length > (largeField ? 500000 : 8000)) return 'Request blocked';
  const patterns = where === 'body' ? BODY_ATTACK : QUERY_ATTACK;
  if (looksDangerous(value, patterns)) return 'Request blocked';
  if (where === 'query') {
    if (NUMBER_KEY.test(key) && value && !/^\d{1,6}$/.test(value)) return 'Request blocked';
    if (value.length > 200) return 'Request blocked';
    if (!QUERY_TEXT.test(value)) return 'Request blocked';
  }
  if (EMAIL_KEY.test(key) && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return 'Request blocked';
  if (PHONE_KEY.test(key) && value && !/^[0-9+\-()\s]{6,20}$/.test(value)) return 'Request blocked';
  return '';
}

function checkNode(value, key, where, depth) {
  if (depth > 8) return 'Request blocked';
  if (value == null) return '';
  if (typeof value === 'string') return checkString(key, value, where);
  if (typeof value === 'number') return Number.isFinite(value) ? '' : 'Request blocked';
  if (typeof value === 'boolean') return '';
  if (Array.isArray(value)) {
    if (value.length > 2000) return 'Request blocked';
    for (const item of value) {
      const problem = checkNode(item, key, where, depth + 1);
      if (problem) return problem;
    }
    return '';
  }
  if (typeof value === 'object') {
    const names = Object.keys(value);
    if (names.length > 80) return 'Request blocked';
    for (const name of names) {
      if (POLLUTION_KEYS.has(name) || !KEY_NAME.test(name)) return 'Request blocked';
      const problem = checkNode(value[name], name, where, depth + 1);
      if (problem) return problem;
    }
  }
  return '';
}

/** Reject unexpected shapes and common attack text before a route runs. */
export function rejectUnsafeRequest(req) {
  const path = String(req.originalUrl || req.url || '');
  if (looksDangerous(decodeURIComponentSafe(path), QUERY_ATTACK)) return 'Request blocked';
  const query = req.query && typeof req.query === 'object' ? req.query : {};
  const queryProblem = checkNode(query, '', 'query', 0);
  if (queryProblem) return queryProblem;
  if (req.body && typeof req.body === 'object') {
    const bodyProblem = checkNode(req.body, '', 'body', 0);
    if (bodyProblem) return bodyProblem;
  }
  return '';
}

function decodeURIComponentSafe(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
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
