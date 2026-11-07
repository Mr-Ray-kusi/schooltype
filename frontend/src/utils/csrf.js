const CSRF_KEY = 'st_csrf';

let csrfToken = '';
try {
  csrfToken = sessionStorage.getItem(CSRF_KEY) || '';
} catch {
  csrfToken = '';
}

export function readCsrfToken() {
  return csrfToken;
}

export function writeCsrfToken(token) {
  csrfToken = String(token || '');
  try {
    if (csrfToken) sessionStorage.setItem(CSRF_KEY, csrfToken);
    else sessionStorage.removeItem(CSRF_KEY);
  } catch {
    // private mode
  }
}

export function applyCsrfHeader(headers = {}) {
  if (!csrfToken) return headers;
  return { ...headers, 'X-CSRF-Token': csrfToken };
}
