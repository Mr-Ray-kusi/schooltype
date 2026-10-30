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

export function safeClientError(error, fallback = 'Request failed') {
  const status = Number(error?.status) || 500;
  if (status < 500 && error?.message && !looksLikeInternalError(error.message)) {
    return { status, error: String(error.message).slice(0, 180) };
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
    text.includes('stack') ||
    text.includes('econn') ||
    text.includes('enotfound')
  );
}
