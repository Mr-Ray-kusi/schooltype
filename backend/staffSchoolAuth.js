import { isSchoolHeadRole } from './staffAdminRoutes.js';

const pathOnly = (req) => String(req.originalUrl || req.path || '').split('?')[0];

const starts = (path, prefix) => path === prefix || path.startsWith(`${prefix}/`);

const ACADEMIC_PREFIXES = [
  '/api/students',
  '/api/staff',
  '/api/non-staff',
  '/api/classes',
  '/api/subjects',
  '/api/academic-terms',
  '/api/attendance',
  '/api/scanner',
  '/api/report-cards',
  '/api/alumni',
  '/api/school/branding',
  '/api/staff-portal/session/admin',
  '/api/staff-portal/link',
  '/api/staff-portal/regenerate',
];

const isWalletMove = (path) =>
  starts(path, '/api/wallet/deposit') || starts(path, '/api/wallet/withdraw');

const isAcademicPath = (path) => ACADEMIC_PREFIXES.some((prefix) => starts(path, prefix));

const isAccountantPath = (path, method) => {
  if (isWalletMove(path)) return false;
  if (starts(path, '/api/staff-portal/session/fees')) return true;
  if (starts(path, '/api/fees')) return true;
  if (starts(path, '/api/academic-terms') && method === 'GET') return true;
  if (starts(path, '/api/classes') && method === 'GET') return true;
  if (starts(path, '/api/students') && method === 'GET') return true;
  if (path === '/api/wallet' && method === 'GET') return true;
  if (path === '/api/wallet/transactions' && method === 'GET') return true;
  if (path === '/api/wallet/accounts' && method === 'GET') return true;
  return false;
};

export function staffPortalApiAllowed(payload, req) {
  const path = pathOnly(req);
  const method = String(req.method || 'GET').toUpperCase();
  const role = payload?.role;

  if (isSchoolHeadRole(role)) {
    if (isAcademicPath(path)) return { ok: true };
    return {
      ok: false,
      status: 403,
      error: 'The administrator can manage academics here. Money stays with the accountant and the school account.',
    };
  }

  if (String(role || '').toLowerCase() === 'accountant') {
    if (isWalletMove(path)) {
      return {
        ok: false,
        status: 403,
        error: 'Only the school account can deposit or withdraw wallet money.',
      };
    }
    if (isAccountantPath(path, method)) return { ok: true };
    return {
      ok: false,
      status: 403,
      error: 'The accountant can manage fees and view the wallet, not academics or wallet transfers.',
    };
  }

  return {
    ok: false,
    status: 403,
    error: 'This staff role cannot use school admin APIs',
  };
}

export function staffPortalAsSchoolUser(payload) {
  return {
    schoolId: payload.schoolId,
    id: payload.staffId,
    email: payload.staffName || payload.role,
    role: 'school',
    staffPortal: true,
    staffRole: payload.role,
  };
}
