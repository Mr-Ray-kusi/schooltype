export function requestPath(req) {
  return String(req.originalUrl || req.path || '').split('?')[0];
}

export function isDownloadRequest(req) {
  const path = requestPath(req);
  return /\/export\b|\/download\b/i.test(path);
}

export function isFeeRecordingRequest(req) {
  const path = requestPath(req);
  const method = String(req.method || '').toUpperCase();
  if (method === 'POST' && /\/api\/fees\/manual$/.test(path)) return true;
  if (method === 'PATCH' && /\/api\/fees\/manual\/[^/]+$/.test(path)) return true;
  if (method === 'POST' && /\/api\/fees\/[^/]+\/checkout$/.test(path)) return true;
  if (method === 'POST' && /\/staff-portal\/session\/fees\/manual$/.test(path)) return true;
  if (method === 'PATCH' && /\/staff-portal\/session\/fees\/manual\/[^/]+$/.test(path)) return true;
  if (method === 'POST' && /\/staff-portal\/session\/fees\/checkout$/.test(path)) return true;
  return false;
}

export function isReadOnlyExemptRequest(req) {
  const method = String(req.method || '').toUpperCase();
  const path = requestPath(req);
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    return !isDownloadRequest(req);
  }
  if (/\/api\/auth\/logout/.test(path)) return true;
  if (/\/api\/telemetry$/.test(path)) return true;
  if (/\/api\/notifications\/[^/]+\/read$/.test(path)) return true;
  if (/\/api\/notifications\/read-all$/.test(path)) return true;
  if (/\/api\/school\/select-plan/.test(path)) return true;
  if (/\/staff-portal\/session\/telemetry$/.test(path)) return true;
  return isFeeRecordingRequest(req);
}

export const SUBSCRIPTION_READ_ONLY_MESSAGE =
  'Your term plan has ended. You can still view records and record school fees. Renew the plan to add results, change setup, download, pay staff, or move wallet money.';

export function readOnlyPayload(subscription) {
  return {
    error: SUBSCRIPTION_READ_ONLY_MESSAGE,
    code: 'SUBSCRIPTION_READ_ONLY',
    subscription,
  };
}
