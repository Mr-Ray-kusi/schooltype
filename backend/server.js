import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { supabase, platformSupabase } from './supabaseClient.js';
import { createTenantClient, disableTenantJwt, runWithTenant } from './tenantContext.js';
import { isJwtAuthError, jwtClockOffsetSec, noteJwtClockRejection, syncJwtClock } from './jwtClock.js';
import { readAccessToken, setSessionCookie, clearSessionCookie } from './cookieAuth.js';
import {
  createAuthSession,
  getAuthSession,
  revokeAuthSession,
  revokeSchoolSessions,
  sessionTtlSeconds,
  trimSchoolAdminSessions,
  setStaffSession,
  isStaffSessionActive,
  claimScannerSlot,
  touchScannerSlot,
  releaseScannerSlot,
} from './sessionStore.js';
import { logPlatformAction } from './auditLog.js';
import {
  publicIdRateLimited,
  recordPublicIdFailure,
  gateProfile,
} from './publicIdGate.js';
import { formatParsedStudentId, parseStudentId, syncStudentIds } from './studentId.js';
import { buildHealthPayload } from './runtimeHealth.js';
import { pingDbPooler, ensureStudentProfileColumns } from './dbPooler.js';
import { mergeStudentFieldList, mergeStudentFields, writeStudentProfileFields } from './studentFieldStore.js';
import { purgePersonRelated } from './personPurge.js';
import nodemailer from 'nodemailer';
import { getPlan, getPlanFeatures, getPlansList, VALID_PLAN_IDS, hasPlanFeature, resolvePlanId } from './plans.js';
import {
  getSubscriptionInfo,
  initializeSubscription,
  toDateString,
  addMonths,
} from './subscription.js';
import {
  initSchoolPlanStore,
  mergeSchoolWithExtras,
  schoolHasPaidPlan,
  syncPaidPlanFromLedger,
  inferPlanIdFromAmount,
  upsertSchoolExtras,
  deleteSchoolExtras,
  ensureScannerToken,
  regenerateScannerToken,
  getSchoolIdByScannerToken,
  ensureStaffPortalToken,
  regenerateStaffPortalToken,
  getSchoolIdByStaffPortalToken,
  hydrateExtrasFromSchool,
  checkPlanSchemaReady,
} from './schoolPlanStore.js';
import {
  initStudentPhotoStore,
  deleteStudentPhoto,
  mergeStudentPhoto,
  mergeStudentPhotos,
  deletePersonPhoto,
  mergePersonPhoto,
  mergePersonPhotos,
} from './studentPhotoStore.js';
import {
  initAuthSecurityStore,
  getClientIp,
  validatePasswordStrength,
  checkLoginAllowed,
  recordLoginFailure,
  clearLoginFailures,
  checkSignupAllowed,
  recordSignupAttempt,
  checkAuthHitAllowed,
  recordAuthHit,
  checkResendAllowed,
  recordResendAttempt,
  parseJwtExpiresInSeconds,
} from './authSecurity.js';
import { initSchoolWalletStore, getWallet } from './schoolWalletStore.js';
import { registerWalletRoutes, getRecordedSubscriptionRevenueMinor, rebuildPlatformRevenueLedger } from './walletRoutes.js';
import {
  initSchoolSignupPayment,
  startSchoolSignupCheckout,
  startSchoolPlanCheckout,
  fulfillSchoolCheckout,
  resolveSignupCharge,
  authorizeSignupCharge,
  cancelSignupCharge,
} from './schoolSignupPayment.js';
import { getFeeOverviewPayload, registerFeeRoutes, registerStaffFeeRoutes } from './feeRoutes.js';
import { registerStaffAdminRoutes } from './staffAdminRoutes.js';
import { inspectScoreLock, loadScoreLocks } from './scorePublishStore.js';
import { isProtectedStaffRole, staffPortalApiAllowed, staffPortalAsSchoolUser } from './staffSchoolAuth.js';
import { parseRequiredGender, parseRequiredSalary } from './peopleCreate.js';
import { extraFeesJson } from './feePayments.js';
import { notifyParentsOfAbsence, sendAbsentParentSms } from './absentNotify.js';
import { registerAlumniRoutes } from './alumniRoutes.js';
import { applyTermPromotion } from './studentPromotion.js';
import { sortClasses } from './classHierarchy.js';
import { listAcademicTerms, resolveFeePeriod, resolveTeacherScoreTerm } from './academicTerms.js';
import { initPlatformSmsStore, claimDemoMoneyReset, getSchoolSmsBalance, resetSmsInventoryToZero } from './platformSmsStore.js';
import { registerSmsBillingRoutes, settleSmsPayment, refundSchoolAndPlatformUnits, findPlatformSchoolId } from './smsBilling.js';
import { sendSmsBatch, getSmsProviderStatus } from './smsProvider.js';
import {
  createEmailVerificationToken,
  hashEmailVerificationToken,
  buildVerifyEmailUrl,
  buildVerificationEmail,
  buildPasswordResetEmail,
  isSchoolEmailVerified,
  needsPasswordSetup,
  PASSWORD_SETUP_MARKER,
  getFrontendBaseUrl,
} from './emailVerification.js';
import {
  createPlatformNotification,
  createPlatformNotificationsBatch,
  createPublicSupportNotification,
  isPublicSupportNotification,
  parsePublicSupportContact,
  listSchoolNotifications,
  listPeerSchools,
  countUnreadSchoolNotifications,
  countUnreadSuperAdminNotifications,
  markNotificationRead,
  markAllSchoolNotificationsRead,
  listSuperAdminNotificationThreads,
  runSubscriptionDueReminders,
} from './platformNotifications.js';
import {
  initPlatformTelemetry,
  recordPlatformEvent,
  recordClientEvents,
  getPlatformAnalytics,
} from './platformTelemetry.js';
import { getSchoolAnalytics } from './schoolAnalytics.js';
import { getGoogleAuthConfig, verifyGoogleIdentity } from './googleAuth.js';
import { fromMinorUnits } from './paystack.js';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { cacheGet, cacheSet, cacheInvalidate } from './ttlCache.js';
import { isProduction, isVercel } from './runtime.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({
  path: path.join(__dirname, '.env'),
  // Render injects env vars. A .env file shipped with the image must not replace them.
  override: !process.env.RENDER && !process.env.VERCEL && process.env.NODE_ENV !== 'production',
});

let dummyPasswordHash = null;
const getDummyPasswordHash = () => {
  if (!dummyPasswordHash) {
    dummyPasswordHash = bcrypt.hashSync('__login_timing_dummy__', 10);
  }
  return dummyPasswordHash;
};
const IS_PRODUCTION = isProduction();

const app = express();
app.set('trust proxy', 1);

const allowedOrigins = (() => {
  const raw = String(
    process.env.CORS_ORIGINS ||
      'http://localhost:3000,http://localhost:3001,http://localhost:3002,https://schootype.vercel.app'
  );
  const list = raw
    .split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean);
  for (const extra of [process.env.FRONTEND_URL, process.env.APP_URL]) {
    const value = String(extra || '').trim().replace(/\/$/, '');
    if (value && !list.includes(value)) list.push(value);
  }
  return list;
})();

app.use(
  cors({
    credentials: true,
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(null, false);
    },
  })
);

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
  if (IS_PRODUCTION) {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  }
  next();
});

function sendAuthRateLimited(res, check) {
  const retryAfterSec = Number(check.retryAfterSec) || 60;
  res.setHeader('Retry-After', String(retryAfterSec));
  return res.status(429).json({
    error: check.message,
    retryAfter: retryAfterSec,
  });
}

app.use(
  express.json({
    limit: '2mb',
    verify: (req, _res, buf) => {
      if (req.originalUrl?.startsWith('/api/webhooks/paystack')) {
        req.rawBody = buf;
      }
    },
  })
);

const MAX_LOGO_SIZE = 2 * 1024 * 1024; // 2MB
const PAGE_SIZE = 50;
const DASHBOARD_TTL_MS = 5 * 60 * 1000;
const REPORTS_TTL_MS = 5 * 60 * 1000;

const parsePagination = (req) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(PAGE_SIZE, Math.max(1, parseInt(req.query.limit, 10) || PAGE_SIZE));
  const from = (page - 1) * limit;
  const to = from + limit - 1;
  return { page, limit, from, to };
};

const paginatedJson = (res, items, count, page, limit) => {
  res.json({
    items,
    total: count || 0,
    page,
    limit,
  });
};

const generateStrongPassword = (length = 16) => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*';
  const bytes = crypto.randomBytes(length);
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
};

const bumpSchoolCaches = (schoolId) => {
  if (!schoolId) return;
  cacheInvalidate(`dash:${schoolId}`);
  cacheInvalidate(`att-sum:${schoolId}`);
  cacheInvalidate(`att-people:${schoolId}`);
  cacheInvalidate(`att-fill:${schoolId}`);
  cacheInvalidate(`att-person-fill:${schoolId}`);
  cacheInvalidate(`reports:${schoolId}`);
  cacheInvalidate(`analytics:${schoolId}`);
  cacheInvalidate(`fee-dash:${schoolId}`);
};

const SCHOOL_PLAN_COLUMNS = [
  'id',
  'email',
  'role',
  'payment_plan',
  'plan_status',
  'next_payment_due',
  'last_payment_at',
  'subscription_frozen',
  'subscription_started_at',
  'email_verified',
  'logo_url',
];

const SCHOOL_AUTH_COLUMNS = [
  'id',
  'name',
  'email',
  'role',
  'payment_plan',
  'plan_status',
  'plan_selected_at',
  'next_payment_due',
  'last_payment_at',
  'subscription_frozen',
  'subscription_started_at',
  'total_paid',
  'email_verified',
];

const STUDENT_LIST_COLUMNS =
  'id, school_id, name, class, gender, extra_fees, roll_number, parent_name, parent_phone, parent_email, parent_relationship, house_address, date_of_birth, barcode, qr_code, created_at';
const STAFF_LIST_COLUMNS =
  'id, school_id, name, role, salary, barcode, qr_code, secret_code, subjects, class_names, created_at';
const NONSTAFF_LIST_COLUMNS = 'id, school_id, name, role, barcode, qr_code, created_at';

const wantsPhotos = (req) =>
  ['1', 'true', 'yes'].includes(String(req.query.includePhotos || '').toLowerCase());

const withoutPhotoUrl = (row) => {
  if (!row || typeof row !== 'object' || !('photo_url' in row)) return row;
  const { photo_url: _photoUrl, ...rest } = row;
  return rest;
};

const schoolMaster = () => platformSupabase || supabase;

const selectSchoolById = async (id, columns) => {
  const optional = [
    'role',
    'payment_plan',
    'plan_status',
    'plan_selected_at',
    'next_payment_due',
    'last_payment_at',
    'subscription_frozen',
    'subscription_started_at',
    'total_paid',
    'email_verified',
    'late_after_time',
    'logo_url',
  ];
  let cols = [...columns];
  for (let attempt = 0; attempt <= optional.length; attempt++) {
    const { data, error } = await schoolMaster()
      .from('schools')
      .select(cols.join(', '))
      .eq('id', id)
      .maybeSingle();
    if (!error) return { data, error: null };
    const missing = optional.find((column) => cols.includes(column) && isMissingColumnError(error, column));
    if (missing) {
      cols = cols.filter((column) => column !== missing);
      continue;
    }
    return { data: null, error };
  }
  return { data: null, error: { message: 'Failed to load school' } };
};

const queryPagedRows = async (table, { schoolId, from, to, q, orFilter, columns, includePhotos, eqFilters, isNullFilters }) => {
  void includePhotos;
  const selectColumns = columns;
  const applyFilters = (query, skipNulls = false) => {
    let next = query.eq('school_id', schoolId).order('created_at', { ascending: false }).range(from, to);
    if (eqFilters) {
      for (const [key, value] of Object.entries(eqFilters)) {
        if (value) next = next.eq(key, value);
      }
    }
    if (!skipNulls && isNullFilters) {
      for (const key of isNullFilters) next = next.is(key, null);
    }
    if (q && orFilter) next = next.or(orFilter);
    return next;
  };

  let result = await applyFilters(supabase.from(table).select(selectColumns, { count: 'exact' }));
  if (result.error && isNullFilters?.some((column) => isMissingColumnError(result.error, column))) {
    result = await applyFilters(supabase.from(table).select(selectColumns, { count: 'exact' }), true);
  }
  if (result.error && isMissingColumnError(result.error, 'extra_fees') && String(selectColumns).includes('extra_fees')) {
    result = await applyFilters(
      supabase.from(table).select(String(selectColumns).replace(/,?\s*extra_fees/, ''), { count: 'exact' })
    );
  }
  if (result.error && (noteJwtClockRejection(result.error.message) || isJwtAuthError(result.error))) {
    disableTenantJwt(result.error.message);
    result = await applyFilters(schoolMaster().from(table).select(selectColumns, { count: 'exact' }));
  }
  if (result.error) {
    result = await applyFilters(supabase.from(table).select('*', { count: 'exact' }));
  }
  if (result.error && isJwtAuthError(result.error)) {
    result = await applyFilters(schoolMaster().from(table).select('*', { count: 'exact' }));
  }
  if (result.error) return result;

  let rows = result.data || [];
  if (!includePhotos) rows = rows.map(withoutPhotoUrl);
  if (table === 'students') rows = await mergeStudentFieldList(rows, schoolId);
  return { ...result, data: rows };
};

const percentPresent = (present, total) => (total ? Number(((present / total) * 100).toFixed(2)) : 0);

const buildAttendanceSummaryPayload = (date, totals, attendanceRows) => {
  const presentStudents = attendanceRows?.filter((row) => row.user_type === 'student').length || 0;
  const presentStaff = attendanceRows?.filter((row) => row.user_type === 'staff').length || 0;
  const presentNonStaff = attendanceRows?.filter((row) => row.user_type === 'non-staff').length || 0;
  return {
    date,
    students: {
      total: totals.students || 0,
      present: presentStudents,
      percentage: percentPresent(presentStudents, totals.students),
    },
    staff: {
      total: totals.staff || 0,
      present: presentStaff,
      percentage: percentPresent(presentStaff, totals.staff),
    },
    nonStaff: {
      total: totals.nonStaff || 0,
      present: presentNonStaff,
      percentage: percentPresent(presentNonStaff, totals.nonStaff),
    },
  };
};

const formatSchool = (school, { includeCredentials = false, light = false } = {}) => {
  if (school?.id) hydrateExtrasFromSchool(school);
  const merged = mergeSchoolWithExtras(school);
  let paymentPlan = merged.payment_plan || null;
  const planApproved = schoolHasPaidPlan(merged);
  if (planApproved && !paymentPlan) {
    paymentPlan = inferPlanIdFromAmount(merged.total_paid) || 'small';
  }
  const planStatus = planApproved ? 'approved' : paymentPlan ? merged.plan_status || 'pending' : null;
  const plan = paymentPlan ? getPlan(paymentPlan) : null;
  const pendingPlanFeatures = paymentPlan ? getPlanFeatures(paymentPlan) : [];
  const subscription = getSubscriptionInfo({ ...merged, plan_status: planStatus });
  const featuresUnlocked = planApproved && subscription.subscription_active;

  // Persist approval when signup payment already landed but plan_status was left pending.
  if (school?.id && planApproved && (school.plan_status !== 'approved' || !school.payment_plan) && paymentPlan) {
    const repair = { payment_plan: paymentPlan, plan_status: 'approved' };
    if (!merged.subscription_started_at && !merged.next_payment_due) {
      Object.assign(repair, initializeSubscription());
    }
    updateSchoolRecord(school.id, repair).catch((err) => {
      console.warn('Failed to repair plan_status to approved:', err?.message || err);
    });
    upsertSchoolExtras(school.id, repair).catch(() => {});
  }

  const formatted = {
    id: merged.id,
    name: merged.name,
    email: merged.email,
    // Cap logo size in auth payloads — huge base64 logos slow every navigation verify.
    logo_url: light
      ? null
      : merged.logo_url && String(merged.logo_url).length < 400000
        ? merged.logo_url
        : null,
    role: getSchoolRole(merged),
    payment_plan: paymentPlan,
    plan_status: planStatus,
    plan_approved: planApproved,
    plan_name: plan?.name || null,
    plan_features: featuresUnlocked ? pendingPlanFeatures : [],
    pending_plan_features: pendingPlanFeatures,
    plan_selected_at: merged.plan_selected_at || null,
    subscription_active: subscription.subscription_active,
    subscription_frozen: subscription.subscription_frozen,
    subscription_started_at: subscription.subscription_started_at,
    next_payment_due: subscription.next_payment_due,
    last_payment_at: subscription.last_payment_at,
    subscription_in_grace: subscription.in_grace_period,
    subscription_days_past_due: subscription.days_past_due,
    subscription_status: subscription.reason,
    subscription_grace_days: subscription.grace_days,
    plan_price: plan?.price ?? null,
    total_paid: merged.total_paid || 0,
    // Cap payment history in auth payloads — full ledgers slow every verify/login.
    payment_records: light
      ? []
      : Array.isArray(merged.payment_records)
        ? merged.payment_records.slice(0, 20)
        : [],
    email_verified: isSchoolEmailVerified(merged),
  };

  // Never return plaintext passwords — includeCredentials kept for API compat only.
  void includeCredentials;

  return formatted;
};

const getSuperAdminEmails = () => {
  const emails = [
    process.env.DEV_SUPER_ADMIN_EMAIL,
    process.env.SUPER_ADMIN_EMAIL,
    ...(process.env.SUPER_ADMIN_EMAILS || '').split(','),
  ];
  // Local/dev convenience only — production must set SUPER_ADMIN_EMAIL(S) explicitly.
  if (!IS_PRODUCTION) {
    emails.push('superadmin@school.com');
  }
  return [...new Set(emails.filter(Boolean).map((e) => e.trim().toLowerCase()))];
};

const isSuperAdminEmail = (email) => getSuperAdminEmails().includes(email?.toLowerCase());

const getSchoolRole = (school) => {
  if (school?.role === 'super_admin') return 'super_admin';
  if (isSuperAdminEmail(school?.email)) return 'super_admin';
  return school?.role || 'admin';
};

const isMissingColumnError = (error, column) => {
  const msg = String(error?.message || error?.details || error?.hint || '');
  return (
    (msg.includes(column) &&
      (msg.includes('does not exist') ||
        msg.includes('Could not find') ||
        msg.includes('schema cache'))) ||
    error?.code === 'PGRST204'
  );
};

const isNotNullColumnError = (error, column) => {
  const msg = String(error?.message || error?.details || error?.hint || '').toLowerCase();
  const col = String(column || '').toLowerCase();
  return Boolean(col) && msg.includes(col) && (msg.includes('not-null') || msg.includes('not null') || error?.code === '23502');
};

const fillIdentityCodes = (payload) => {
  const code = payload.barcode || payload.qr_code;
  if (!code) return payload;
  if (!payload.barcode) payload.barcode = code;
  if (!payload.qr_code) payload.qr_code = code;
  return payload;
};

const findSchoolByEmail = async (email) => {
  const { data, error } = await schoolMaster()
    .from('schools')
    .select('*')
    .eq('email', email)
    .maybeSingle();

  if (error) throw error;
  return data;
};

const PLAN_SCHEMA_HELP =
  'Run database/supabase_core_billing.sql then database/supabase_backend_access.sql in the Supabase SQL editor, and set SUPABASE_SERVICE_ROLE_KEY on the server.';

const schoolNameSlug = (name) => {
  const slug = String(name || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || 'school';
};

const insertSchoolRecord = async (record) => {
  const payload = { ...record };
  if (payload.name && !payload.name_slug) {
    payload.name_slug = schoolNameSlug(payload.name);
  }
  const optionalColumns = [
    'role',
    'initial_password',
    'payment_plan',
    'plan_selected_at',
    'plan_status',
    'logo_url',
    'scanner_token',
    'staff_portal_token',
    'late_after_time',
    'last_due_reminder_at',
    'next_payment_due',
    'last_payment_at',
    'subscription_frozen',
    'subscription_started_at',
    'total_paid',
    'email_verified',
    'email_verification_token',
    'email_verification_expires_at',
    'name_slug',
  ];
  const requiredPlanFields = ['payment_plan', 'plan_status'].filter(
    (column) => record[column] !== undefined && record[column] !== null
  );
  const stripped = [];

  for (let attempt = 0; attempt <= optionalColumns.length; attempt++) {
    const { data, error } = await supabase.from('schools').insert([payload]).select().single();

    if (!error) {
      const missingPlan = requiredPlanFields.filter((column) => !data?.[column]);
      if (missingPlan.length) {
        // Roll back half-created accounts so they don't appear without approval state.
        await supabase.from('schools').delete().eq('id', data.id);
        return {
          data: null,
          error: {
            message: `Schools table is missing required plan columns (${missingPlan.join(', ')}). ${PLAN_SCHEMA_HELP}`,
            code: 'MISSING_PLAN_COLUMNS',
          },
        };
      }
      return { data, error: null, stripped };
    }

    if (error.code === '23505') {
      return { data: null, error: { ...error, duplicate: true }, stripped };
    }

    const missingColumn = optionalColumns.find(
      (column) => payload[column] !== undefined && isMissingColumnError(error, column)
    );

    if (missingColumn) {
      if (requiredPlanFields.includes(missingColumn)) {
        return {
          data: null,
          error: {
            message: `Schools table is missing ${missingColumn}. ${PLAN_SCHEMA_HELP}`,
            code: 'MISSING_PLAN_COLUMNS',
          },
          stripped,
        };
      }
      delete payload[missingColumn];
      stripped.push(missingColumn);
      continue;
    }

    return { data: null, error, stripped };
  }

  return { data: null, error: { message: 'Failed to create school record' }, stripped };
};

const updateSchoolRecord = async (id, updates) => {
  const payload = { ...updates };
  const optionalColumns = [
    'role',
    'initial_password',
    'payment_plan',
    'plan_selected_at',
    'plan_status',
    'logo_url',
    'scanner_token',
    'staff_portal_token',
    'late_after_time',
    'last_due_reminder_at',
    'next_payment_due',
    'last_payment_at',
    'subscription_frozen',
    'subscription_started_at',
    'total_paid',
    'email_verified',
    'email_verification_token',
    'email_verification_expires_at',
    'name_slug',
  ];

  for (let attempt = 0; attempt <= optionalColumns.length; attempt++) {
    if (!Object.keys(payload).length) {
      const { data, error } = await supabase.from('schools').select('*').eq('id', id).maybeSingle();
      return { data, error };
    }

    const { data, error } = await supabase
      .from('schools')
      .update(payload)
      .eq('id', id)
      .select('*')
      .maybeSingle();

    if (!error) {
      // RLS can "succeed" with 0 rows — treat as failure so callers can fall back.
      if (!data) {
        return {
          data: null,
          error: {
            message:
              'School update returned no row. Run database/supabase_backend_access.sql (disable RLS) or use SUPABASE_SERVICE_ROLE_KEY.',
            code: 'NO_ROW',
          },
        };
      }
      return { data, error: null };
    }

    const missingColumn = optionalColumns.find(
      (column) => payload[column] !== undefined && isMissingColumnError(error, column)
    );

    if (missingColumn) {
      delete payload[missingColumn];
      continue;
    }

    return { data: null, error };
  }

  return { data: null, error: { message: 'Failed to update school record' } };
};

const SCHOOL_OPTIONAL_COLUMNS = [
  'role',
  'initial_password',
  'payment_plan',
  'plan_selected_at',
  'plan_status',
  'logo_url',
  'scanner_token',
  'staff_portal_token',
  'late_after_time',
  'last_due_reminder_at',
  'next_payment_due',
  'last_payment_at',
  'subscription_frozen',
  'subscription_started_at',
  'total_paid',
];

const fetchSchoolAccounts = async ({ orderBy = 'created_at', ascending = false } = {}) => {
  const baseColumns = ['id', 'name', 'email', 'created_at'];
  let columns = [...baseColumns, ...SCHOOL_OPTIONAL_COLUMNS];

  for (let attempt = 0; attempt <= SCHOOL_OPTIONAL_COLUMNS.length; attempt++) {
    let query = supabase.from('schools').select(columns.join(', '));
    if (orderBy) {
      query = query.order(orderBy, { ascending });
    }

    const { data, error } = await query;

    if (!error) {
      const accounts = (data || []).filter((school) => getSchoolRole(school) !== 'super_admin');
      return { data: accounts, error: null };
    }

    const missingColumn = SCHOOL_OPTIONAL_COLUMNS.find(
      (column) => columns.includes(column) && isMissingColumnError(error, column)
    );

    if (missingColumn) {
      columns = columns.filter((col) => col !== missingColumn);
      continue;
    }

    return { data: null, error };
  }

  return { data: null, error: { message: 'Failed to fetch school accounts' } };
};

const requireSuperAdmin = async (req, res, next) => {
  try {
    if (!supabase) {
      return res.status(503).json({ error: 'Service unavailable' });
    }

    let { data: school, error } = await supabase
      .from('schools')
      .select('id, email, role')
      .eq('id', req.user.schoolId)
      .maybeSingle();

    // Older schemas may not have role — still allow via SUPER_ADMIN_EMAIL allowlist.
    if (error && isMissingColumnError(error, 'role')) {
      ({ data: school, error } = await supabase
        .from('schools')
        .select('id, email')
        .eq('id', req.user.schoolId)
        .maybeSingle());
    }

    if (error || !school || getSchoolRole(school) !== 'super_admin') {
      return res.status(403).json({ error: 'Super admin access required' });
    }
    req.user.role = 'super_admin';
    next();
  } catch (err) {
    console.error('Super admin auth check failed:', err.message);
    return res.status(503).json({ error: 'Service unavailable' });
  }
};

const enforcePlanApproval = async (req, res, next) => {
  if (req.user.role === 'super_admin') {
    return next();
  }

  try {
    const { data: school, error } = await selectSchoolById(req.user.schoolId, SCHOOL_PLAN_COLUMNS);

    if (error || !school) {
      return res.status(403).json({ error: 'School account not found' });
    }

    let merged = mergeSchoolWithExtras(school);
    if (!schoolHasPaidPlan(merged)) {
      merged = mergeSchoolWithExtras(await syncPaidPlanFromLedger(school));
    }

    if (!merged.payment_plan) {
      return res.status(403).json({ error: 'Please select a payment plan first' });
    }

    if (!schoolHasPaidPlan(merged)) {
      return res.status(403).json({ error: 'Complete payment to unlock your plan features' });
    }

    const subscription = getSubscriptionInfo(merged);
    if (!subscription.subscription_active) {
      if (subscription.reason === 'frozen') {
        return res.status(403).json({
          error: 'Your account has been frozen by the administrator. Contact support to restore access.',
          subscription,
        });
      }
      if (subscription.reason === 'overdue') {
        return res.status(403).json({
          error: `Subscription payment is ${subscription.days_past_due} days overdue. Features are locked until payment is recorded.`,
          subscription,
        });
      }
    }

    next();
  } catch (err) {
    res.status(500).json({ error: 'Failed to verify plan status' });
  }
};

const validateLogo = (logo) => {
  if (!logo) return null;
  if (typeof logo !== 'string' || !logo.startsWith('data:image/')) {
    return 'Logo must be a valid image file';
  }
  const base64Data = logo.split(',')[1];
  if (!base64Data) return 'Invalid logo format';
  const sizeInBytes = Buffer.byteLength(base64Data, 'base64');
  if (sizeInBytes > MAX_LOGO_SIZE) {
    return 'Logo must be smaller than 2MB';
  }
  return null;
};

const validateImage = validateLogo;

const insertStudentRecord = async (record) => {
  const payload = fillIdentityCodes({ ...record });
  const optionalColumns = [
    'photo_url',
    'gender',
    'extra_fees',
    'parent_phone',
    'parent_name',
    'parent_relationship',
    'house_address',
    'date_of_birth',
    'parent_email',
    'roll_number',
    'barcode',
    'qr_code',
  ];

  for (let attempt = 0; attempt <= optionalColumns.length + 4; attempt++) {
    const { data, error } = await supabase.from('students').insert([payload]).select().single();

    if (!error) {
      return { data, error: null };
    }

    if (payload.extra_fees != null && Array.isArray(payload.extra_fees) && String(error.message || '').toLowerCase().includes('extra_fees')) {
      payload.extra_fees = JSON.stringify(payload.extra_fees);
      continue;
    }

    const missingColumn = optionalColumns.find(
      (column) => payload[column] !== undefined && isMissingColumnError(error, column)
    );

    if (missingColumn) {
      delete payload[missingColumn];
      continue;
    }

    if (isNotNullColumnError(error, 'qr_code') && payload.barcode && payload.qr_code !== payload.barcode) {
      payload.qr_code = payload.barcode;
      continue;
    }
    if (isNotNullColumnError(error, 'barcode') && payload.qr_code && payload.barcode !== payload.qr_code) {
      payload.barcode = payload.qr_code;
      continue;
    }

    return { data: null, error };
  }

  return { data: null, error: { message: 'Failed to create student record' } };
};

const updateStudentRecord = async (id, schoolId, updates) => {
  const payload = { ...updates };
  const optionalColumns = [
    'photo_url',
    'gender',
    'extra_fees',
    'parent_phone',
    'parent_name',
    'parent_relationship',
    'house_address',
    'date_of_birth',
    'parent_email',
    'roll_number',
  ];

  for (let attempt = 0; attempt <= optionalColumns.length; attempt++) {
    const { data, error } = await supabase
      .from('students')
      .update(payload)
      .eq('id', id)
      .eq('school_id', schoolId)
      .select()
      .single();

    if (!error) {
      return { data, error: null };
    }

    if (payload.extra_fees != null && Array.isArray(payload.extra_fees) && String(error.message || '').toLowerCase().includes('extra_fees')) {
      payload.extra_fees = JSON.stringify(payload.extra_fees);
      continue;
    }

    const missingColumn = optionalColumns.find(
      (column) => payload[column] !== undefined && isMissingColumnError(error, column)
    );

    if (missingColumn) {
      delete payload[missingColumn];
      continue;
    }

    return { data: null, error };
  }

  return { data: null, error: { message: 'Failed to update student record' } };
};

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';
const JWT_SECRET_IS_WEAK =
  !process.env.JWT_SECRET || JWT_SECRET === 'your-secret-key-change-this' || JWT_SECRET.length < 32;

if (JWT_SECRET_IS_WEAK) {
  const message =
    'JWT_SECRET is missing or too weak. Set a strong JWT_SECRET (32+ chars) in backend/.env or the Render service env.';
  if (IS_PRODUCTION) {
    console.error(message);
  } else {
    console.warn(`WARNING: ${message}`);
  }
}

const signAuthToken = (school, { remember = false, expiresIn } = {}) => {
  const role = getSchoolRole(school);
  const ttl = expiresIn || (remember ? '30d' : JWT_EXPIRES_IN);
  return jwt.sign({ schoolId: school.id, email: school.email, role, remember: Boolean(remember) }, JWT_SECRET, {
    expiresIn: ttl,
  });
};

const authTokenPayload = (remember = false) => ({
  expiresIn: remember ? sessionTtlSeconds(true) : parseJwtExpiresInSeconds(JWT_EXPIRES_IN),
});

async function issueSchoolSession(res, school, { remember = false } = {}) {
  const ttlSec = sessionTtlSeconds(remember);
  const token = signAuthToken(school, { remember, expiresIn: ttlSec });
  await createAuthSession({
    schoolId: school.id,
    token,
    remember,
    expiresAt: Date.now() + ttlSec * 1000,
  });
  if (getSchoolRole(school) !== 'super_admin') {
    await trimSchoolAdminSessions(school.id, token);
  }
  setSessionCookie(res, token, ttlSec);
  return { token, expiresIn: ttlSec, school: formatSchool(school, { light: true }) };
}

// Email transporter configuration - uses Gmail SMTP or custom SMTP
let emailTransporter = null;
let emailReady = false;

const PLACEHOLDER_EMAIL_USERS = new Set([
  'your-email@gmail.com',
  'your-kusiraymond208@gmail.com',
]);

const getEmailUser = () => {
  const candidates = [process.env.EMAIL_USER, process.env.BROADCAST_EMAIL];
  for (const raw of candidates) {
    const email = String(raw || '')
      .trim()
      .toLowerCase();
    if (email && email.includes('@') && !PLACEHOLDER_EMAIL_USERS.has(email)) {
      return email;
    }
  }
  return '';
};

const getEmailPassword = () =>
  // Gmail app passwords are often copied with spaces — strip them
  String(process.env.EMAIL_PASSWORD || '').replace(/\s+/g, '').trim();

const hasValidEmailConfig = () => {
  const emailUser = getEmailUser();
  const emailPass = getEmailPassword();
  return Boolean(
    emailUser && emailPass && emailPass !== 'your-app-password' && emailUser.includes('@')
  );
};

const initEmailTransporter = () => {
  emailTransporter = null;
  emailReady = false;

  if (!hasValidEmailConfig()) {
    console.warn(
      'Email credentials not configured. Set EMAIL_USER and EMAIL_PASSWORD in backend/.env to enable email delivery.'
    );
    return;
  }

  const emailUser = getEmailUser();
  const emailPass = getEmailPassword();

  const emailTransportOptions = process.env.EMAIL_HOST
    ? {
        host: process.env.EMAIL_HOST,
        port: Number(process.env.EMAIL_PORT || 587),
        secure: process.env.EMAIL_SECURE === 'true',
        auth: {
          user: emailUser,
          pass: emailPass,
        },
      }
    : {
        service: process.env.EMAIL_SERVICE || 'gmail',
        auth: {
          user: emailUser,
          pass: emailPass,
        },
      };

  emailTransporter = nodemailer.createTransport(emailTransportOptions);
  // Allow sends once credentials exist; SMTP verify can be slow or flaky.
  emailReady = true;
  console.log(`Email transporter configured (${emailUser})`);

  // Confirm SMTP once on the long-running server. A serverless boot used to skip this.
  if (!isVercel()) {
    console.log(`Email transporter verifying SMTP for ${emailUser}…`);
    emailTransporter.verify((error) => {
      if (error) {
        emailReady = false;
        console.warn('Email SMTP verify failed:', error.message);
        console.warn('Broadcast email will stay disabled until EMAIL_USER / EMAIL_PASSWORD are valid.');
      } else {
        emailReady = true;
        console.log(`Email service ready (${emailUser})`);
      }
    });
  }
};

initEmailTransporter();

/**
 * Auth emails (signup verify / resend) must go to the user's address — never BROADCAST_EMAIL.
 */
async function sendAuthEmail({ to, subject, text, html }) {
  const recipient = String(to || '')
    .trim()
    .toLowerCase();
  if (!recipient || !recipient.includes('@')) {
    const err = new Error('Missing recipient email for auth message');
    err.code = 'INVALID_RECIPIENT';
    throw err;
  }
  if (!emailReady || !emailTransporter) {
    const err = new Error('Email is not configured on the server.');
    err.code = 'EMAIL_NOT_CONFIGURED';
    throw err;
  }

  const fromUser = getEmailUser();
  const info = await emailTransporter.sendMail({
    from: `"Schooltype" <${fromUser}>`,
    to: recipient,
    subject,
    text,
    html,
    // Force SMTP envelope so providers cannot redirect to the authenticated mailbox.
    envelope: {
      from: fromUser,
      to: recipient,
    },
  });

  const accepted = (info.accepted || []).map((a) => String(a).toLowerCase());
  console.log(
    `[auth] Mail queued to=${recipient} from=${fromUser} accepted=${accepted.join(',') || 'n/a'} id=${info.messageId || 'n/a'}`
  );

  if (accepted.length && !accepted.some((a) => a.includes(recipient))) {
    console.warn(`[auth] Warning: SMTP accepted list did not include ${recipient}:`, accepted);
  }

  return info;
}

// Middleware to verify JWT
const authenticateToken = (req, res, next) => {
  const token = readAccessToken(req);

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }, async (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    if (user?.purpose === 'staff_portal') {
      if (!isStaffSessionActive(user.staffId, token)) {
        return res.status(401).json({
          error: 'This staff login is already used on another device. Sign in here to continue.',
        });
      }
      const gate = staffPortalApiAllowed(user, req);
      if (!gate.ok) {
        return res.status(gate.status || 403).json({ error: gate.error });
      }
      req.user = staffPortalAsSchoolUser(user);
      req.staffPortal = user;
      req.accessToken = token;
      const tenantDb = createTenantClient(user.schoolId, 'school');
      return runWithTenant({ db: tenantDb, schoolId: user.schoolId }, () => next());
    }
    try {
      const session = await getAuthSession(token);
      if (session.status === 'revoked' || session.status === 'expired') {
        return res.status(403).json({ error: 'Session ended. Sign in again.' });
      }
      if (session.status === 'ok' && session.session?.school_id && session.session.school_id !== user.schoolId) {
        return res.status(403).json({ error: 'Session ended. Sign in again.' });
      }
      if (session.status === 'missing' && process.env.REQUIRE_AUTH_SESSIONS === 'true') {
        return res.status(403).json({ error: 'Session ended. Sign in again.' });
      }
    } catch {
      // Session table may not exist yet; JWT still authenticates.
    }
    req.user = user;
    req.accessToken = token;
    const tenantDb =
      user.role === 'super_admin' ? null : createTenantClient(user.schoolId, user.role);
    runWithTenant({ db: tenantDb, schoolId: user.schoolId }, () => next());
  });
};

initSchoolSignupPayment({
  insertSchoolRecord,
  updateSchoolRecord,
  findSchoolByEmail,
  formatSchool,
  signAuthToken,
  authTokenPayload,
  sendAuthEmail,
  recordPlatformEvent,
  recordSignupAttempt,
});

// ============ PAYMENT PLANS ============

app.get('/api/plans', (req, res) => {
  res.json(getPlansList());
});

// ============ AUTHENTICATION ROUTES ============

// Signup — Paystack first; the school row is created only after payment succeeds
app.post('/api/auth/signup', async (req, res) => {
  try {
    const email = req.body.email?.trim().toLowerCase();
    const { schoolName, logo, paymentPlan, method, phone, provider } = req.body;
    const clientIp = getClientIp(req);

    if (!schoolName?.trim() || !email) {
      return res.status(400).json({ error: 'School name and email are required' });
    }

    if (req.body.privacyAccepted !== true) {
      return res.status(400).json({
        error: 'Please review and accept the privacy notice to create an account.',
      });
    }

    const signupCheck = await checkSignupAllowed(clientIp);
    if (!signupCheck.allowed) {
      return res.status(429).json({ error: signupCheck.message });
    }

    if (isSuperAdminEmail(email)) {
      return res.status(400).json({ error: 'This email is reserved. Please use Login instead.' });
    }

    if (!emailReady || !emailTransporter) {
      return res.status(503).json({
        error:
          'Email verification is not configured on the server. Set EMAIL_USER and EMAIL_PASSWORD, then try again.',
        code: 'EMAIL_NOT_CONFIGURED',
      });
    }

    const logoError = validateLogo(logo);
    if (logoError) {
      return res.status(400).json({ error: logoError });
    }

    if (!paymentPlan || !VALID_PLAN_IDS.includes(paymentPlan)) {
      return res.status(400).json({ error: 'A valid payment plan is required to create an account' });
    }

    const existingSchool = await findSchoolByEmail(email);
    if (existingSchool) {
      await recordSignupAttempt(clientIp);
      if (!isSchoolEmailVerified(existingSchool) && getSchoolRole(existingSchool) !== 'super_admin') {
        return res.status(409).json({
          error:
            'An account with this email already exists but is not verified. Resend the verification email from the sign-in page.',
          code: 'EMAIL_NOT_VERIFIED',
          email,
        });
      }
      if (needsPasswordSetup(existingSchool)) {
        return res.status(409).json({
          error:
            'An account with this email already exists. Open the link we emailed you to finish setup, or resend it from sign-in.',
          code: 'PASSWORD_NOT_SET',
          email,
        });
      }
      return res.status(409).json({ error: 'An account with this email already exists. Please log in instead.' });
    }

    await recordSignupAttempt(clientIp);
    const checkout = await startSchoolSignupCheckout({
      email,
      schoolName: schoolName.trim(),
      logo,
      paymentPlan,
      googleSignup: false,
      method,
      phone,
      provider,
    });

    res.json({
      ...checkout,
      email,
      message: 'Complete payment to create your school account. Features unlock after a successful charge.',
    });
  } catch (error) {
    const status = error.status || 500;
    if (status >= 500 && error.code !== 'PAYSTACK_NOT_CONFIGURED') console.error('Signup error:', error);
    res.status(status).json({ error: error.message || 'Internal server error', code: error.code });
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const email = req.body.email?.trim().toLowerCase();
    const { password, remember } = req.body;
    const clientIp = getClientIp(req);

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const [hitCheck, loginCheck, exactSchool] = await Promise.all([
      checkAuthHitAllowed('login', clientIp),
      checkLoginAllowed(email, clientIp),
      schoolMaster().from('schools').select('*').eq('email', email).maybeSingle(),
    ]);
    if (!hitCheck.allowed) {
      recordPlatformEvent({
        eventType: 'login_failed',
        email,
        path: '/login',
        meta: { reason: 'rate_limited', message: 'Too many login attempts' },
      }).catch(() => {});
      return sendAuthRateLimited(res, hitCheck);
    }
    if (!loginCheck.allowed) {
      recordPlatformEvent({
        eventType: 'login_failed',
        email,
        path: '/login',
        meta: { reason: 'rate_limited', message: 'Too many login attempts' },
      }).catch(() => {});
      return sendAuthRateLimited(res, loginCheck);
    }
    recordAuthHit('login', clientIp, email).catch(() => {});

    let school = exactSchool.data;
    let schoolError = exactSchool.error;

    if (!school && !schoolError) {
      const fallback = await schoolMaster()
        .from('schools')
        .select('*')
        .ilike('email', email)
        .maybeSingle();
      school = fallback.data;
      schoolError = fallback.error;
    }

    if (schoolError) {
      console.error('Login lookup error:', schoolError);
      recordPlatformEvent({
        eventType: 'login_failed',
        email,
        path: '/login',
        meta: { reason: 'system_failure', message: 'System failure during login' },
      }).catch(() => {});
      return res.status(500).json({ error: 'Login failed. Please try again.' });
    }

    let isValidPassword = false;
    try {
      // Always compare to keep response timing similar for unknown emails.
      isValidPassword = await bcrypt.compare(password, school?.password_hash || getDummyPasswordHash());
    } catch (compareErr) {
      console.warn('bcrypt compare failed, will try initial_password fallback:', compareErr.message);
      isValidPassword = false;
    }

    // One-time repair for legacy rows that only stored plaintext initial_password.
    if (!isValidPassword && school?.initial_password && String(school.initial_password) === String(password)) {
      isValidPassword = true;
      try {
        const repairedHash = await bcrypt.hash(password, 10);
        await schoolMaster()
          .from('schools')
          .update({ password_hash: repairedHash, initial_password: null })
          .eq('id', school.id);
        school = { ...school, password_hash: repairedHash, initial_password: null };
      } catch (repairErr) {
        console.warn('Failed to repair password_hash:', repairErr.message);
      }
    }

    if (!school || !isValidPassword) {
      await recordLoginFailure(email, clientIp);
      recordPlatformEvent({
        eventType: 'login_failed',
        email,
        schoolId: school?.id || null,
        schoolName: school?.name || null,
        role: school ? getSchoolRole(school) : null,
        path: '/login',
        meta: {
          reason: school ? 'wrong_password' : 'unknown_email',
          message: school ? 'Wrong password' : 'Email not found',
        },
      }).catch(() => {});
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (getSchoolRole(school) !== 'super_admin' && !isSchoolEmailVerified(school)) {
      await clearLoginFailures(email);
      return res.status(403).json({
        error: 'Please verify your email before signing in. Check your inbox or resend the link.',
        code: 'EMAIL_NOT_VERIFIED',
        email: school.email,
      });
    }

    if (needsPasswordSetup(school)) {
      await clearLoginFailures(email);
      return res.status(403).json({
        error: 'Finish creating your account from the email link, then choose a password.',
        code: 'PASSWORD_NOT_SET',
        email: school.email,
      });
    }

    clearLoginFailures(email).catch(() => {});

    if (!schoolHasPaidPlan(school) || school.plan_status !== 'approved') {
      school = await syncPaidPlanFromLedger(school);
    }
    const session = await issueSchoolSession(res, school, { remember: Boolean(remember) });
    if (getSchoolRole(school) !== 'super_admin') {
      recordPlatformEvent({
        eventType: 'login',
        schoolId: school.id,
        schoolName: school.name,
        email: school.email,
        role: getSchoolRole(school),
        path: '/login',
      }).catch(() => {});
    }

    res.json(session);
  } catch (error) {
    console.error('Login error:', error);
    recordPlatformEvent({
      eventType: 'login_failed',
      email: req.body?.email?.trim?.().toLowerCase?.() || null,
      path: '/login',
      meta: { reason: 'system_failure', message: 'System failure during login' },
    }).catch(() => {});
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/auth/google-config', (req, res) => {
  res.json(getGoogleAuthConfig());
});

app.post('/api/auth/google', async (req, res) => {
  try {
    const { idToken, accessToken, schoolName, logo, paymentPlan, privacyAccepted, method, phone, provider } =
      req.body || {};
    const clientIp = getClientIp(req);
    const hitCheck = await checkAuthHitAllowed('google', clientIp);
    if (!hitCheck.allowed) return sendAuthRateLimited(res, hitCheck);
    await recordAuthHit('google', clientIp);

    const profile = await verifyGoogleIdentity({ idToken, accessToken });
    const email = profile.email;

    if (isSuperAdminEmail(email)) {
      return res.status(400).json({
        error: 'This email is reserved. Please use the email sign-in form instead.',
      });
    }

    const logoError = validateLogo(logo);
    if (logoError) {
      return res.status(400).json({ error: logoError });
    }

    let school = await findSchoolByEmail(email);

    if (!school) {
      if (!paymentPlan || !VALID_PLAN_IDS.includes(paymentPlan)) {
        return res.status(404).json({
          error: 'No school account exists for this Google email. Choose a plan to create one.',
          code: 'ACCOUNT_NOT_FOUND',
        });
      }

      if (privacyAccepted !== true) {
        return res.status(400).json({
          error: 'Please review and accept the privacy notice to create an account.',
        });
      }

      const signupCheck = await checkSignupAllowed(clientIp);
      if (!signupCheck.allowed) {
        return res.status(429).json({ error: signupCheck.message });
      }

      const name = String(schoolName || profile.name || '').trim();
      if (!name) {
        return res.status(400).json({ error: 'School name is required to create an account with Google.' });
      }

      await recordSignupAttempt(clientIp);
      const checkout = await startSchoolSignupCheckout({
        email,
        schoolName: name,
        logo,
        paymentPlan,
        googleSignup: true,
        method,
        phone,
        provider,
      });
      return res.json({
        ...checkout,
        email,
        message: 'Complete payment to create your school account. Features unlock after a successful charge.',
      });
    } else {
      const repairs = {};
      if (school.email_verified !== true) repairs.email_verified = true;
      if (needsPasswordSetup(school)) repairs.initial_password = null;
      if (Object.keys(repairs).length) {
        const { data: updated } = await schoolMaster().from('schools').update(repairs).eq('id', school.id).select().single();
        if (updated) school = updated;
      }
    }

    await clearLoginFailures(email);
    school = await syncPaidPlanFromLedger(school);
    const session = await issueSchoolSession(res, school, { remember: Boolean(req.body?.remember) });
    if (getSchoolRole(school) !== 'super_admin') {
      recordPlatformEvent({
        eventType: 'login',
        schoolId: school.id,
        schoolName: school.name,
        email: school.email,
        role: getSchoolRole(school),
        path: '/login',
      }).catch(() => {});
    }

    res.json(session);
  } catch (error) {
    const status = error.status || 500;
    if (status >= 500) console.error('Google auth error:', error);
    res.status(status).json({ error: error.message || 'Google sign-in failed', code: error.code });
  }
});

app.get('/api/auth/signup-charge/:reference', async (req, res) => {
  try {
    const resolved = await resolveSignupCharge(req.params.reference);
    res.json(resolved);
  } catch (error) {
    const status = error.status || 500;
    if (status >= 500) console.error('Signup charge status error:', error);
    res.status(status).json({ error: error.message || 'Failed to check payment status', code: error.code });
  }
});

app.post('/api/auth/signup-charge/authorize', async (req, res) => {
  try {
    const resolved = await authorizeSignupCharge({
      reference: req.body?.reference,
      otp: req.body?.otp || req.body?.pin || req.body?.code,
      codeType: req.body?.code_type || req.body?.type,
    });
    res.json(resolved);
  } catch (error) {
    const status = error.status || 500;
    if (status >= 500) console.error('Signup charge authorize error:', error);
    res.status(status).json({ error: error.message || 'Could not submit that code', code: error.code });
  }
});

app.post('/api/auth/signup-charge/cancel', async (req, res) => {
  try {
    const resolved = await cancelSignupCharge(req.body?.reference);
    res.json(resolved);
  } catch (error) {
    const status = error.status || 500;
    if (status >= 500) console.error('Signup charge cancel error:', error);
    res.status(status).json({ error: error.message || 'Could not cancel this payment', code: error.code });
  }
});

app.post('/api/auth/complete-signup', async (req, res) => {
  try {
    const reference = String(req.body?.reference || req.query?.reference || '').trim();
    const result = await fulfillSchoolCheckout(reference);
    if (result.ignored) {
      return res.status(400).json({ error: 'This payment is not a school signup checkout.' });
    }
    if (!result.ok) {
      return res.status(400).json({
        error: result.error || 'Payment has not been completed yet.',
        pending: Boolean(result.pending),
        status: result.status || null,
      });
    }
    if (result.school && !result.requiresEmailVerification) {
      const session = await issueSchoolSession(res, result.school, { remember: false });
      result.token = session.token;
      result.expiresIn = session.expiresIn;
    }
    res.json({
      ...result,
      message: result.requiresEmailVerification
        ? result.emailSendFailed
          ? 'Payment received and account created. We could not send the email — use Resend on the sign-in page.'
          : 'Payment received. Check your email to verify and choose a password. All plan features are unlocked.'
        : 'Payment received. Your school account is ready and all plan features are unlocked.',
    });
  } catch (error) {
    const status = error.status || 500;
    if (status >= 500) console.error('Complete signup error:', error);
    res.status(status).json({ error: error.message || 'Could not finish signup after payment', code: error.code });
  }
});

// Confirm email via magic link token
app.get('/api/auth/verify-email', async (req, res) => {
  try {
    const rawToken = String(req.query.token || '').trim();
    if (!rawToken || rawToken.length < 32) {
      return res.status(400).json({ error: 'Invalid or missing verification token', code: 'INVALID_TOKEN' });
    }

    const tokenHash = hashEmailVerificationToken(rawToken);
    const { data: school, error } = await supabase
      .from('schools')
      .select('*')
      .eq('email_verification_token', tokenHash)
      .maybeSingle();

    if (error) {
      console.error('Verify email lookup error:', error);
      if (isMissingColumnError(error, 'email_verification_token')) {
        return res.status(500).json({
          error: 'Email verification is not set up in the database yet. Run the email verification migration in Supabase.',
        });
      }
      return res.status(500).json({ error: 'Verification failed. Please try again.' });
    }

    if (!school) {
      return res.status(400).json({
        error: 'This verification link is invalid or has already been used.',
        code: 'INVALID_TOKEN',
      });
    }

    const alreadyHasPassword = Boolean(school.password_hash) && !needsPasswordSetup(school);
    const tokenPurpose = alreadyHasPassword ? 'reset_password' : 'set_password';
    const issueSetupToken = (schoolRow) =>
      jwt.sign({ schoolId: schoolRow.id, email: schoolRow.email, purpose: tokenPurpose }, JWT_SECRET, {
        expiresIn: '2h',
      });

    const expiresAt = school.email_verification_expires_at
      ? new Date(school.email_verification_expires_at).getTime()
      : 0;
    if (!expiresAt || expiresAt < Date.now()) {
      return res.status(400).json({
        error: 'This verification link has expired. Please request a new one.',
        code: 'TOKEN_EXPIRED',
        email: school.email,
      });
    }

    // Signup still needs a first password. A reset must not lock the current password
    // until the new one is saved.
    const { data: updated, error: updateError } = await updateSchoolRecord(school.id, {
      email_verified: true,
      ...(alreadyHasPassword ? {} : { initial_password: PASSWORD_SETUP_MARKER }),
    });

    if (updateError) {
      console.error('Verify email update error:', updateError);
      return res.status(500).json({ error: 'Could not complete email verification.' });
    }

    const verifiedSchool = updated || {
      ...school,
      email_verified: true,
      initial_password: PASSWORD_SETUP_MARKER,
    };

    res.json({
      verified: true,
      alreadyVerified: school.email_verified === true,
      needsPasswordSetup: true,
      reset: alreadyHasPassword,
      purpose: tokenPurpose,
      setupToken: issueSetupToken(verifiedSchool),
      email: verifiedSchool.email || school.email,
      message: alreadyHasPassword
        ? 'Email confirmed. Choose a new password for this school.'
        : 'Email verified. Choose a password to finish creating your account.',
    });
  } catch (error) {
    console.error('Verify email error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Finish email-first signup: set password after magic-link verify
app.post('/api/auth/set-password', async (req, res) => {
  try {
    const setupToken = String(req.body.setupToken || req.body.token || '').trim();
    const password = req.body.password;

    if (!setupToken || !password) {
      return res.status(400).json({ error: 'Setup token and password are required' });
    }

    const passwordError = validatePasswordStrength(password);
    if (passwordError) {
      return res.status(400).json({ error: passwordError });
    }

    let payload;
    try {
      payload = jwt.verify(setupToken, JWT_SECRET, { algorithms: ['HS256'] });
    } catch {
      return res.status(400).json({
        error: 'This setup link has expired. Resend the email and try again.',
        code: 'SETUP_TOKEN_EXPIRED',
      });
    }

    const isReset = payload?.purpose === 'reset_password';
    if ((payload?.purpose !== 'set_password' && !isReset) || !payload?.schoolId) {
      return res.status(400).json({ error: 'Invalid setup token', code: 'INVALID_TOKEN' });
    }

    const { data: school, error } = await supabase
      .from('schools')
      .select('*')
      .eq('id', payload.schoolId)
      .maybeSingle();

    if (error || !school) {
      return res.status(404).json({ error: 'Account not found' });
    }

    if (!isSchoolEmailVerified(school)) {
      return res.status(403).json({
        error: 'Verify your email before setting a password.',
        code: 'EMAIL_NOT_VERIFIED',
        email: school.email,
      });
    }

    // Signup tokens cannot overwrite a finished account. Reset tokens can.
    const setupFinished =
      !needsPasswordSetup(school) &&
      !school.email_verification_token &&
      school.email_verified === true;
    if (!isReset && setupFinished) {
      return res.status(400).json({
        error: 'Password is already set. Please sign in.',
        code: 'PASSWORD_ALREADY_SET',
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const { data: updated, error: updateError } = await updateSchoolRecord(school.id, {
      password_hash: hashedPassword,
      initial_password: null,
      email_verification_token: null,
      email_verification_expires_at: null,
      email_verified: true,
    });

    if (updateError) {
      console.error('Set password update error:', updateError);
      return res.status(500).json({ error: 'Could not save password. Please try again.' });
    }

    if (isReset) {
      try {
        await revokeSchoolSessions(school.id);
      } catch {
        // Session table may not exist yet.
      }
    }

    const ready = await syncPaidPlanFromLedger(
      updated || { ...school, password_hash: hashedPassword, initial_password: null }
    );
    const session = await issueSchoolSession(res, ready, { remember: false });

    res.json({
      token: session.token,
      expiresIn: session.expiresIn,
      school: formatSchool(ready),
      message: isReset ? 'Password updated. You are signed in.' : 'Password saved. You are signed in.',
    });
  } catch (error) {
    console.error('Set password error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Resend verification magic link
app.post('/api/auth/resend-verification', async (req, res) => {
  try {
    const email = req.body.email?.trim().toLowerCase();
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const clientIp = getClientIp(req);
    const resendCheck = await checkResendAllowed(email, clientIp);
    if (!resendCheck.allowed) return sendAuthRateLimited(res, resendCheck);
    await recordResendAttempt(email, clientIp);

    if (!emailReady || !emailTransporter) {
      return res.status(503).json({
        error: 'Email is not configured on the server.',
        code: 'EMAIL_NOT_CONFIGURED',
      });
    }

    const school = await findSchoolByEmail(email);
    // Always return a generic success to avoid email enumeration
    const generic = {
      ok: true,
      message: 'If that account needs verification, a new link has been sent.',
    };

    if (!school || getSchoolRole(school) === 'super_admin') {
      return res.json(generic);
    }

    // Allow resend when unverified OR when verified but password not chosen yet
    if (isSchoolEmailVerified(school) && !needsPasswordSetup(school)) {
      return res.json(generic);
    }

    const { rawToken, tokenHash, expiresAt } = createEmailVerificationToken();
    const keepVerified = isSchoolEmailVerified(school) && needsPasswordSetup(school);
    const { error: updateError } = await updateSchoolRecord(school.id, {
      email_verification_token: tokenHash,
      email_verification_expires_at: expiresAt,
      email_verified: keepVerified,
      ...(needsPasswordSetup(school) ? { initial_password: PASSWORD_SETUP_MARKER } : {}),
    });

    if (updateError) {
      console.error('Resend verification update failed:', updateError);
      return res.status(500).json({ error: 'Could not resend verification email.' });
    }

    const verifyUrl = buildVerifyEmailUrl(rawToken);
    const recipientEmail = String(school.email || email)
      .trim()
      .toLowerCase();
    const mail = buildVerificationEmail({
      schoolName: school.name,
      email: recipientEmail,
      verifyUrl,
    });

    try {
      await sendAuthEmail({
        to: recipientEmail,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
      });
    } catch (mailError) {
      console.error('Resend verification email failed:', mailError.message);
      return res.status(500).json({ error: 'Failed to send verification email. Try again later.' });
    }

    res.json(generic);
  } catch (error) {
    console.error('Resend verification error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const email = req.body.email?.trim().toLowerCase();
    if (!email) {
      return res.status(400).json({ error: 'Enter the school email used to create this account.' });
    }

    const clientIp = getClientIp(req);
    const resendCheck = await checkResendAllowed(email, clientIp);
    if (!resendCheck.allowed) return sendAuthRateLimited(res, resendCheck);
    await recordResendAttempt(email, clientIp);

    const school = await findSchoolByEmail(email);
    if (!school || getSchoolRole(school) === 'super_admin' || String(school.email || '').trim().toLowerCase() !== email) {
      return res.status(404).json({
        error: 'No school account uses that email. Enter the exact school email from signup.',
        code: 'SCHOOL_EMAIL_NOT_FOUND',
      });
    }

    if (!emailReady || !emailTransporter) {
      return res.status(503).json({
        error: 'Email is not configured on the server.',
        code: 'EMAIL_NOT_CONFIGURED',
      });
    }

    const { rawToken, tokenHash, expiresAt } = createEmailVerificationToken();
    const { error: updateError } = await updateSchoolRecord(school.id, {
      email_verification_token: tokenHash,
      email_verification_expires_at: expiresAt,
    });
    if (updateError) {
      console.error('Forgot password update failed:', updateError);
      return res.status(500).json({ error: 'Could not start a password reset. Try again.' });
    }

    const resetUrl = buildVerifyEmailUrl(rawToken);
    const recipientEmail = String(school.email || email).trim().toLowerCase();
    const mail = needsPasswordSetup(school)
      ? buildVerificationEmail({
          schoolName: school.name,
          email: recipientEmail,
          verifyUrl: resetUrl,
        })
      : buildPasswordResetEmail({
          schoolName: school.name,
          email: recipientEmail,
          resetUrl,
        });

    try {
      await sendAuthEmail({
        to: recipientEmail,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
      });
    } catch (mailError) {
      console.error('Forgot password email failed:', mailError.message);
      return res.status(500).json({ error: 'Failed to send the reset email. Try again later.' });
    }

    res.json({
      ok: true,
      sent: true,
      email: recipientEmail,
      message: 'A reset link was sent to that school email.',
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/auth/logout', authenticateToken, async (req, res) => {
  await revokeAuthSession(req.accessToken || readAccessToken(req));
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.post('/api/auth/logout-all', authenticateToken, async (req, res) => {
  await revokeSchoolSessions(req.user.schoolId);
  clearSessionCookie(res);
  res.json({ ok: true });
});

// Verify token - check if token is still valid
app.get('/api/auth/verify', authenticateToken, async (req, res) => {
  try {
    // Token is valid if we reach here (authenticateToken middleware verified it)
    let { data: school, error } = await selectSchoolById(req.user.schoolId, SCHOOL_AUTH_COLUMNS);

    if (error || !school) {
      return res.status(401).json({ error: 'School not found' });
    }

    school = await syncPaidPlanFromLedger(school);

    if (getSchoolRole(school) !== 'super_admin' && !isSchoolEmailVerified(school)) {
      return res.status(403).json({
        error: 'Email not verified',
        code: 'EMAIL_NOT_VERIFIED',
        email: school.email,
      });
    }

    res.json({
      valid: true,
      school: formatSchool(school, { light: true }),
      role: getSchoolRole(school),
    });
  } catch (error) {
    console.error('Token verification error:', error);
    res.status(403).json({ error: 'Invalid token' });
  }
});

// Select payment plan — Paystack checkout; features unlock only after payment
app.post('/api/school/select-plan', authenticateToken, async (req, res) => {
  try {
    if (req.user.role === 'super_admin') {
      return res.status(400).json({ error: 'Super admin does not require a plan' });
    }

    const { paymentPlan, method, phone, provider } = req.body;
    if (!paymentPlan || !VALID_PLAN_IDS.includes(paymentPlan)) {
      return res.status(400).json({ error: 'Invalid payment plan' });
    }

    const { data: currentSchool, error: fetchError } = await schoolMaster()
      .from('schools')
      .select('*')
      .eq('id', req.user.schoolId)
      .maybeSingle();

    if (fetchError || !currentSchool) {
      return res.status(404).json({ error: 'School not found' });
    }

    const merged = mergeSchoolWithExtras(currentSchool);
    if (schoolHasPaidPlan(merged)) {
      return res.json({ school: formatSchool(currentSchool), alreadyPaid: true });
    }

    const checkout = await startSchoolPlanCheckout({
      schoolId: currentSchool.id,
      email: currentSchool.email,
      schoolName: currentSchool.name,
      paymentPlan,
      method,
      phone,
      provider,
    });

    res.json({
      ...checkout,
      school: formatSchool(currentSchool),
    });
  } catch (error) {
    const status = error.status || 500;
    if (status >= 500 && error.code !== 'PAYSTACK_NOT_CONFIGURED') console.error('Select plan error:', error);
    res.status(status).json({ error: error.message || 'Internal server error', code: error.code });
  }
});

app.get('/api/school/branding', authenticateToken, async (req, res) => {
  try {
    if (req.user.role === 'super_admin') {
      return res.json({ logo_url: null });
    }
    const { data: school, error } = await selectSchoolById(req.user.schoolId, SCHOOL_PLAN_COLUMNS);
    if (error || !school) {
      return res.status(404).json({ error: 'School not found' });
    }
    const merged = mergeSchoolWithExtras(school);
    res.json({ logo_url: merged.logo_url || null });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to load school image' });
  }
});

app.put('/api/school/branding', authenticateToken, async (req, res) => {
  try {
    if (req.user.role === 'super_admin') {
      return res.status(400).json({ error: 'Super admin does not have a school dashboard image' });
    }
    const logo = req.body?.logo ?? req.body?.logo_url ?? null;
    if (logo) {
      const logoError = validateLogo(logo);
      if (logoError) return res.status(400).json({ error: logoError });
    }

    const { data: current, error: fetchError } = await selectSchoolById(req.user.schoolId, SCHOOL_PLAN_COLUMNS);
    if (fetchError || !current) {
      return res.status(404).json({ error: 'School not found' });
    }

    const nextLogo = logo || null;
    const { data: updated, error: updateError } = await updateSchoolRecord(current.id, { logo_url: nextLogo });
    if (updateError) {
      return res.status(500).json({ error: updateError.message || 'Failed to save school image' });
    }
    await upsertSchoolExtras(current.id, { logo_url: nextLogo });
    const merged = mergeSchoolWithExtras(updated || current);
    res.json({
      logo_url: nextLogo,
      school: { ...formatSchool(merged), logo_url: nextLogo },
    });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to save school image' });
  }
});

// ============ SUPER ADMIN ROUTES ============

const buildSchoolWithStats = async (school, countMaps = null) => {
  school = await syncPaidPlanFromLedger(school);
  let studentsCount = 0;
  let staffCount = 0;
  let nonStaffCount = 0;

  if (countMaps) {
    studentsCount = countMaps.students[school.id] || 0;
    staffCount = countMaps.staff[school.id] || 0;
    nonStaffCount = countMaps.nonStaff[school.id] || 0;
  } else {
    const [students, staff, nonStaff] = await Promise.all([
      supabase.from('students').select('id', { count: 'exact', head: true }).eq('school_id', school.id),
      supabase.from('staffs').select('id', { count: 'exact', head: true }).eq('school_id', school.id),
      supabase.from('nonstaffs').select('id', { count: 'exact', head: true }).eq('school_id', school.id),
    ]);
    studentsCount = students.count || 0;
    staffCount = staff.count || 0;
    nonStaffCount = nonStaff.count || 0;
  }

  return {
    ...formatSchool(school),
    created_at: school.created_at,
    stats: {
      students: studentsCount,
      staff: staffCount,
      nonStaff: nonStaffCount,
    },
  };
};

const countRowsBySchoolId = async (table, schoolIds) => {
  const counts = Object.create(null);
  if (!schoolIds.length) return counts;

  // Prefer cheap per-school COUNT queries over downloading every row.
  const chunkSize = 25;
  for (let i = 0; i < schoolIds.length; i += chunkSize) {
    const chunk = schoolIds.slice(i, i + chunkSize);
    await Promise.all(
      chunk.map(async (schoolId) => {
        const { count, error } = await supabase
          .from(table)
          .select('id', { count: 'exact', head: true })
          .eq('school_id', schoolId);
        if (error) {
          console.warn(`countRowsBySchoolId(${table}, ${schoolId}):`, error.message);
          counts[schoolId] = 0;
          return;
        }
        counts[schoolId] = count || 0;
      })
    );
  }
  return counts;
};

app.get('/api/super-admin/schools', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const { data: schools, error } = await fetchSchoolAccounts({ orderBy: 'created_at', ascending: false });

    if (error) {
      console.error('Super admin schools fetch error:', error.message || error);
      return res.status(500).json({ error: 'Failed to fetch schools' });
    }

    const list = schools || [];
    const schoolIds = list.map((school) => school.id);
    const [students, staff, nonStaff] = await Promise.all([
      countRowsBySchoolId('students', schoolIds),
      countRowsBySchoolId('staffs', schoolIds),
      countRowsBySchoolId('nonstaffs', schoolIds),
    ]);
    const countMaps = { students, staff, nonStaff };
    const schoolsWithStats = await Promise.all(list.map((school) => buildSchoolWithStats(school, countMaps)));

    logPlatformAction({
      actor: req.user,
      action: 'super_admin.list_schools',
      detail: { count: schoolsWithStats.length },
    }).catch(() => {});

    res.json(schoolsWithStats);
  } catch (error) {
    console.error('Super admin schools error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/super-admin/email-status', authenticateToken, requireSuperAdmin, (req, res) => {
  res.json({
    configured: hasValidEmailConfig(),
    ready: Boolean(emailReady && emailTransporter),
    from: hasValidEmailConfig() ? getEmailUser() : null,
  });
});

const escapeHtml = (value = '') =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

app.post('/api/super-admin/broadcast-email', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    if (!emailReady || !emailTransporter) {
      return res.status(503).json({
        error:
          'Email is not configured or ready. Set EMAIL_USER and EMAIL_PASSWORD (app password) in backend/.env, then restart the server.',
      });
    }

    const {
      subject,
      message,
      schoolIds,
      selectAll,
      attachment,
    } = req.body || {};

    const cleanSubject = String(subject || '').trim();
    const cleanMessage = String(message || '').trim();

    if (!cleanSubject) {
      return res.status(400).json({ error: 'Subject is required' });
    }
    if (!cleanMessage && !attachment?.contentBase64) {
      return res.status(400).json({ error: 'Provide a message and/or attach a file' });
    }

    let mailAttachment = null;
    if (attachment?.contentBase64) {
      const filename = String(attachment.filename || 'attachment').slice(0, 180);
      const contentType = String(attachment.contentType || 'application/octet-stream');
      const base64 = String(attachment.contentBase64).replace(/^data:[^;]+;base64,/, '');
      const buffer = Buffer.from(base64, 'base64');
      if (!buffer.length) {
        return res.status(400).json({ error: 'Attachment file is empty or invalid' });
      }
      if (buffer.length > 3 * 1024 * 1024) {
        return res.status(400).json({ error: 'Attachment must be 3MB or smaller' });
      }
      mailAttachment = {
        filename,
        contentType,
        content: buffer,
      };
    }

    const { data: schoolAccounts, error } = await fetchSchoolAccounts({
      orderBy: 'name',
      ascending: true,
    });
    if (error) {
      return res.status(500).json({ error: error.message || 'Failed to load schools' });
    }

    let recipients = schoolAccounts || [];
    if (!selectAll) {
      const ids = Array.isArray(schoolIds) ? schoolIds.map(String) : [];
      if (!ids.length) {
        return res.status(400).json({ error: 'Select at least one school, or choose all schools' });
      }
      recipients = recipients.filter((school) => ids.includes(String(school.id)));
    }

    recipients = recipients.filter((school) => school?.email && getSchoolRole(school) !== 'super_admin');

    if (!recipients.length) {
      return res.status(400).json({ error: 'No school admin emails found for the selection' });
    }

    const fromAddress = getEmailUser();
    const htmlBody = `
      <div style="font-family: Arial, sans-serif; padding: 20px; background-color: #f5f5f5;">
        <div style="background-color: white; padding: 24px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.08);">
          <h2 style="color: #111827; margin-top: 0;">Message from SCHOOLTYPE Platform Admin</h2>
          <p style="color: #6b7280; margin-top: 0;">This email was sent to your school admin account.</p>
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
          <div style="color: #374151; line-height: 1.6; white-space: pre-wrap;">${escapeHtml(cleanMessage).replace(/\n/g, '<br>')}</div>
          ${
            mailAttachment
              ? `<p style="margin-top: 20px; color: #6b7280; font-size: 13px;">A file is attached: <strong>${escapeHtml(mailAttachment.filename)}</strong></p>`
              : ''
          }
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
          <p style="color: #9ca3af; font-size: 12px; margin-bottom: 0;">SCHOOLTYPE · Platform notification</p>
        </div>
      </div>
    `;

    const results = [];
    for (const school of recipients) {
      try {
        await emailTransporter.sendMail({
          from: fromAddress,
          to: school.email,
          subject: cleanSubject,
          text: cleanMessage || `(See attached file: ${mailAttachment?.filename || 'attachment'})`,
          html: htmlBody,
          attachments: mailAttachment
            ? [
                {
                  filename: mailAttachment.filename,
                  content: mailAttachment.content,
                  contentType: mailAttachment.contentType,
                },
              ]
            : undefined,
        });
        results.push({ schoolId: school.id, email: school.email, name: school.name, status: 'sent' });
      } catch (emailError) {
        console.error(`Broadcast email failed for ${school.email}:`, emailError.message);
        results.push({
          schoolId: school.id,
          email: school.email,
          name: school.name,
          status: 'failed',
          error: emailError.message,
        });
      }
    }

    const sent = results.filter((r) => r.status === 'sent').length;
    const failed = results.filter((r) => r.status === 'failed').length;

    logPlatformAction({
      actor: req.user,
      action: 'super_admin.broadcast',
      detail: { subject: cleanSubject, sent, failed, total: results.length },
    }).catch(() => {});

    res.json({
      sent,
      failed,
      total: results.length,
      results,
    });
  } catch (error) {
    console.error('Broadcast email error:', error);
    res.status(500).json({ error: error.message || 'Failed to send broadcast email' });
  }
});

app.get('/api/super-admin/schools/:id', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const { data: school, error } = await schoolMaster()
      .from('schools')
      .select('*')
      .eq('id', req.params.id)
      .maybeSingle();

    if (error || !school) {
      return res.status(404).json({ error: 'School not found' });
    }

    if (getSchoolRole(school) === 'super_admin') {
      return res.status(404).json({ error: 'School not found' });
    }

    res.json(await buildSchoolWithStats(school));
  } catch (error) {
    console.error('Super admin school detail error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

const schoolNameMap = async (schoolIds) => {
  if (!schoolIds.length) return new Map();
  const { data } = await supabase.from('schools').select('id, name').in('id', schoolIds);
  return new Map((data || []).map((s) => [s.id, s.name]));
};

const enrichAttendanceRows = async (attendance, lateAfterTime = '08:00') => {
  const rows = attendance || [];
  if (!rows.length) return [];

  const byType = {
    student: new Set(),
    staff: new Set(),
    'non-staff': new Set(),
  };
  for (const record of rows) {
    const type =
      record.user_type === 'nonstaff' || record.user_type === 'non_staff' ? 'non-staff' : record.user_type;
    if (record.user_id && byType[type]) {
      byType[type].add(record.user_id);
    }
  }

  const loadMap = async (table, ids, columns) => {
    const map = new Map();
    const idList = [...ids];
    if (!idList.length) return map;
    const { data, error } = await supabase.from(table).select(columns).in('id', idList);
    if (error) {
      console.warn(`Attendance batch lookup failed (${table}):`, error.message);
      return map;
    }
    for (const row of data || []) map.set(row.id, row);
    return map;
  };

  const [students, staff, nonStaff] = await Promise.all([
    loadMap('students', byType.student, 'id, name, class, roll_number, barcode'),
    loadMap('staffs', byType.staff, 'id, name, role'),
    loadMap('nonstaffs', byType['non-staff'], 'id, name, role'),
  ]);

  return rows.map((record) => {
    const userType =
      record.user_type === 'nonstaff' || record.user_type === 'non_staff'
        ? 'non-staff'
        : record.user_type;
    let user = null;
    if (record.user_name) {
      const extra = userType === 'student' ? students.get(record.user_id) : null;
      user = {
        name: record.user_name,
        role: userType === 'student' ? null : record.user_label || null,
        class: userType === 'student' ? record.user_label || extra?.class || null : null,
        roll_number: extra?.roll_number || null,
        barcode: extra?.barcode || null,
      };
    } else if (userType === 'student') {
      user = students.get(record.user_id) || null;
    } else if (userType === 'staff') {
      user = staff.get(record.user_id) || null;
    } else if (userType === 'non-staff') {
      user = nonStaff.get(record.user_id) || null;
    }

    const punctuality =
      record.status === 'absent' || record.status === 'early' || record.status === 'late'
        ? record.status
        : getAttendancePunctuality(record.timestamp, lateAfterTime);

    return {
      ...record,
      date: String(record.date || '').slice(0, 10) || record.date,
      user_type: userType,
      user,
      punctuality,
      status: punctuality,
    };
  });
};

const ATTENDANCE_TIMEZONE = process.env.ATTENDANCE_TIMEZONE || 'Africa/Accra';

const schoolNow = (date = new Date()) => {
  const offsetMs = Number(jwtClockOffsetSec() || 0) * 1000;
  return new Date(date.getTime() + offsetMs);
};

const schoolLocalDate = (date = schoolNow()) => {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: ATTENDANCE_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const year = parts.find((part) => part.type === 'year')?.value;
    const month = parts.find((part) => part.type === 'month')?.value;
    const day = parts.find((part) => part.type === 'day')?.value;
    if (year && month && day) return `${year}-${month}-${day}`;
  } catch {
    // fall back to UTC
  }
  return date.toISOString().split('T')[0];
};

const addCalendarDays = (ymd, days) => {
  const cursor = new Date(`${ymd}T12:00:00.000Z`);
  cursor.setUTCDate(cursor.getUTCDate() + Number(days || 0));
  return cursor.toISOString().slice(0, 10);
};

const enrollmentLocalDate = (createdAt) => {
  if (!createdAt) return null;
  const parsed = createdAt instanceof Date ? createdAt : new Date(createdAt);
  if (Number.isNaN(parsed.getTime())) return null;
  return schoolLocalDate(parsed);
};

const firstAttendanceDate = (createdAt) => {
  const enrolledOn = enrollmentLocalDate(createdAt);
  return enrolledOn ? addCalendarDays(enrolledOn, 1) : null;
};

const canHaveAttendanceOn = (createdAt, ymd) => {
  const start = firstAttendanceDate(createdAt);
  if (!start || !/^\d{4}-\d{2}-\d{2}$/.test(String(ymd || ''))) return true;
  return String(ymd).slice(0, 10) >= start;
};

const attendanceDayKey = (value) => {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : '';
};

const filterAttendanceForDate = (rows, ymd) => {
  const day = String(ymd || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return rows || [];
  return (rows || []).filter((row) => {
    const stored = attendanceDayKey(row.date);
    if (stored === day) return true;
    if (row.timestamp) return schoolLocalDate(new Date(row.timestamp)) === day;
    return false;
  });
};

const applyAttendanceDateFilter = (query, ymd) => {
  const day = String(ymd || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return query;
  const prev = addCalendarDays(day, -1);
  const next = addCalendarDays(day, 1);
  return query.gte('date', prev).lte('date', next);
};

const pruneAttendanceBeforeEnrollment = async (schoolId, rows, people, { persist = true } = {}) => {
  const startByKey = new Map();
  for (const person of people || []) {
    const start = firstAttendanceDate(person.created_at);
    if (start) startByKey.set(`${person.user_type}:${person.id}`, start);
  }
  const keep = [];
  const dropIds = [];
  for (const row of rows || []) {
    const start = startByKey.get(`${normalizeAttendanceUserType(row.user_type)}:${row.user_id}`);
    const ymd = String(row.date || '').slice(0, 10);
    if (start && ymd && ymd < start) {
      if (row.id) dropIds.push(row.id);
      continue;
    }
    keep.push(row);
  }
  if (persist && dropIds.length) {
    for (let i = 0; i < dropIds.length; i += 80) {
      await supabase.from('attendance').delete().eq('school_id', schoolId).in('id', dropIds.slice(i, i + 80));
    }
    bumpSchoolCaches(schoolId);
  }
  return keep;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const selectPersonForScan = async (table, schoolId, field, attendanceCode, columnSets) => {
  for (const columns of columnSets) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .eq('school_id', schoolId)
      .eq(field, attendanceCode)
      .maybeSingle();

    if (error) {
      const missingOptional = ['photo_url', 'parent_phone', 'parent_name', 'created_at'].some(
        (column) => columns.includes(column) && isMissingColumnError(error, column)
      );
      if (missingOptional) continue;
      return null;
    }
    return data || null;
  }
  return null;
};

const findPersonByAttendanceCode = async (schoolId, attendanceCode) => {
  if (!attendanceCode) return null;

  const fields = ['barcode', 'qr_code'];
  if (UUID_RE.test(attendanceCode)) fields.push('id');

  const lookups = [
    {
      table: 'students',
      type: 'student',
      columnSets: [
        'id, name, class, photo_url, parent_phone, parent_name, created_at',
        'id, name, class, created_at',
        'id, name, class',
      ],
    },
    {
      table: 'staffs',
      type: 'staff',
      columnSets: ['id, name, role, created_at', 'id, name, role'],
    },
    {
      table: 'nonstaffs',
      type: 'non-staff',
      columnSets: ['id, name, role, created_at', 'id, name, role'],
    },
  ];

  for (const lookup of lookups) {
    for (const field of fields) {
      const data = await selectPersonForScan(
        lookup.table,
        schoolId,
        field,
        attendanceCode,
        lookup.columnSets
      );
      if (!data) continue;

      const withPhoto = mergePersonPhoto(data);
      return {
        userId: withPhoto.id,
        userName: withPhoto.name,
        userLabel: withPhoto.class || withPhoto.role || null,
        userType: lookup.type,
        photoUrl: withPhoto.photo_url || null,
        parentPhone: withPhoto.parent_phone || null,
        parentName: withPhoto.parent_name || null,
        createdAt: withPhoto.created_at || null,
      };
    }
  }

  return null;
};

const getSchoolNameById = async (schoolId) => {
  if (!schoolId) return null;
  const { data } = await supabase.from('schools').select('name').eq('id', schoolId).maybeSingle();
  return data?.name || null;
};

const buildScanIdentity = (person, schoolName, punctuality = null) => {
  if (!person) return null;
  const isStudent = person.userType === 'student';
  return {
    name: person.userName,
    type: person.userType,
    label: person.userLabel,
    class: isStudent ? person.userLabel : null,
    photo_url: person.photoUrl || null,
    school_name: schoolName || null,
    parent_phone: isStudent ? person.parentPhone || null : null,
    parent_name: isStudent ? person.parentName || null : null,
    punctuality: punctuality || null,
  };
};

const toCsvField = (value) => {
  if (value == null || value === '') return null;
  const parts = Array.isArray(value)
    ? value.map((item) => String(item || '').trim()).filter(Boolean)
    : String(value)
        .split(/[,;\n]+/)
        .map((item) => item.trim())
        .filter(Boolean);
  return parts.length ? parts.join(', ') : null;
};

const normalizeLateAfterTime = (value) => {
  const raw = String(value || '').trim();
  if (/^\d{1,2}:\d{2}$/.test(raw)) {
    const [h, m] = raw.split(':').map(Number);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }
  }
  return '08:00';
};

const SCANNER_OPEN_BEFORE_MINUTES = 4 * 60;
const SCANNER_CLOSE_AFTER_MINUTES = 30;

const clockToMinutes = (hhmm) => {
  const [hour, minute] = normalizeLateAfterTime(hhmm).split(':').map(Number);
  return hour * 60 + minute;
};

const minutesToClock = (total) => {
  const wrapped = ((Number(total) % 1440) + 1440) % 1440;
  const hour = Math.floor(wrapped / 60);
  const minute = wrapped % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
};

const formatSchoolClock = (hhmm) => {
  const [hour, minute] = normalizeLateAfterTime(hhmm).split(':').map(Number);
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const hour12 = ((hour + 11) % 12) + 1;
  return `${hour12}:${String(minute).padStart(2, '0')} ${suffix}`;
};

const schoolLocalHms = (date = new Date()) => {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: ATTENDANCE_TIMEZONE,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(date);
    return {
      hour: Number(parts.find((part) => part.type === 'hour')?.value || 0),
      minute: Number(parts.find((part) => part.type === 'minute')?.value || 0),
      second: Number(parts.find((part) => part.type === 'second')?.value || 0),
    };
  } catch {
    return { hour: date.getUTCHours(), minute: date.getUTCMinutes(), second: date.getUTCSeconds() };
  }
};

const describeScannerWindow = (lateAfterTime, now = new Date()) => {
  const late = normalizeLateAfterTime(lateAfterTime);
  const lateMinutes = clockToMinutes(late);
  const opensAt = minutesToClock(lateMinutes - SCANNER_OPEN_BEFORE_MINUTES);
  const closesAt = minutesToClock(lateMinutes + SCANNER_CLOSE_AFTER_MINUTES);
  const clock = schoolLocalHms(now);
  const nowSeconds = clock.hour * 3600 + clock.minute * 60 + clock.second;
  const openMinutes = lateMinutes - SCANNER_OPEN_BEFORE_MINUTES;
  const closeMinutes = lateMinutes + SCANNER_CLOSE_AFTER_MINUTES;
  const openSeconds = openMinutes * 60;
  const closeSeconds = closeMinutes * 60;
  const daySeconds = 24 * 3600;
  let open = false;
  if (openSeconds >= 0 && closeSeconds < daySeconds) {
    open = nowSeconds >= openSeconds && nowSeconds <= closeSeconds;
  } else if (openSeconds < 0) {
    open = nowSeconds >= openSeconds + daySeconds || nowSeconds <= closeSeconds;
  } else {
    open = nowSeconds >= openSeconds || nowSeconds <= closeSeconds - daySeconds;
  }
  return {
    lateAfterTime: late,
    opensAt,
    closesAt,
    open,
    timezone: ATTENDANCE_TIMEZONE,
    message: open
      ? `Scanner is open until ${formatSchoolClock(closesAt)}.`
      : `Scanner is closed. It takes attendance from ${formatSchoolClock(opensAt)} to ${formatSchoolClock(closesAt)}.`,
  };
};

const assertScannerOpen = (lateAfterTime, now = new Date()) => {
  const window = describeScannerWindow(lateAfterTime, now);
  if (window.open) return window;
  const err = new Error(window.message);
  err.status = 403;
  err.code = 'SCANNER_CLOSED';
  throw err;
};

const getAttendancePunctuality = (timestamp, lateAfterTime = '08:00') => {
  const when = timestamp ? new Date(timestamp) : new Date();
  if (Number.isNaN(when.getTime())) return 'early';

  const cutoff = normalizeLateAfterTime(lateAfterTime);
  const [cutH, cutM] = cutoff.split(':').map(Number);

  let hour = when.getUTCHours();
  let minute = when.getUTCMinutes();
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: ATTENDANCE_TIMEZONE,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(when);
    hour = Number(parts.find((p) => p.type === 'hour')?.value ?? hour);
    minute = Number(parts.find((p) => p.type === 'minute')?.value ?? minute);
  } catch {
    // fall back to UTC
  }

  const scannedMinutes = hour * 60 + minute;
  const cutoffMinutes = cutH * 60 + cutM;
  return scannedMinutes > cutoffMinutes ? 'late' : 'early';
};

const getSchoolLateAfterTime = async (schoolId) => {
  const { data: school } = await selectSchoolById(schoolId, ['id', 'late_after_time']);
  if (!school) return '08:00';
  const merged = mergeSchoolWithExtras(school);
  return normalizeLateAfterTime(merged.late_after_time);
};

const isSchoolWeekday = (ymd) => {
  const sample = new Date(`${ymd}T12:00:00.000Z`);
  if (Number.isNaN(sample.getTime())) return false;
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: ATTENDANCE_TIMEZONE,
    weekday: 'short',
  }).format(sample);
  return weekday !== 'Sat' && weekday !== 'Sun';
};

const dateInAcademicTerm = (ymd, terms) => {
  const rows = (terms || []).filter((term) =>
    /^\d{4}-\d{2}-\d{2}$/.test(String(term?.starts_on || '').slice(0, 10))
  );
  if (!rows.length) return true;
  for (const term of rows) {
    const start = String(term.starts_on).slice(0, 10);
    const end = String(term.ends_on || '').slice(0, 10);
    if (ymd < start) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(end) || ymd <= end) return true;
  }
  const lastEnd = rows
    .map((term) => String(term.ends_on || '').slice(0, 10))
    .filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(day))
    .sort()
    .at(-1);
  const nextStart = rows
    .map((term) => String(term.starts_on).slice(0, 10))
    .filter((day) => lastEnd && day > lastEnd)
    .sort()[0];
  return Boolean(lastEnd && ymd > lastEnd && (!nextStart || ymd < nextStart));
};

const attendanceWindow = (period, today) => {
  const monthStart = `${String(today).slice(0, 7)}-01`;
  const start = /^\d{4}-\d{2}-\d{2}$/.test(String(period?.starts_on || ''))
    ? String(period.starts_on).slice(0, 10)
    : monthStart;
  const from = start <= today ? start : monthStart;
  return { from, to: today };
};

const fetchAllQueryRows = async (buildQuery, pageSize = 1000) => {
  const rows = [];
  for (let from = 0; from < 50000; from += pageSize) {
    const { data, error } = await buildQuery().range(from, from + pageSize - 1);
    if (error) throw error;
    const chunk = data || [];
    rows.push(...chunk);
    if (chunk.length < pageSize) break;
  }
  return rows;
};

const ABSENT_AFTER_LATE_MINUTES = 120;

const lateCutoffReached = (ymd, lateAfterTime, now = schoolNow()) => {
  const today = schoolLocalDate(now);
  if (ymd > today) return false;
  if (ymd < today) return true;
  return getAttendancePunctuality(now, lateAfterTime) === 'late';
};

const absentCutoffReached = (ymd, lateAfterTime, now = schoolNow()) => {
  const today = schoolLocalDate(now);
  if (ymd > today) return false;
  if (ymd < today) return lateCutoffReached(ymd, lateAfterTime, now);
  const [cutH, cutM] = normalizeLateAfterTime(lateAfterTime).split(':').map(Number);
  const clock = schoolLocalHms(now);
  return clock.hour * 60 + clock.minute >= cutH * 60 + cutM + ABSENT_AFTER_LATE_MINUTES;
};

const autoAttendanceStatus = (ymd, lateAfterTime, userType, now = schoolNow()) => {
  if (normalizeAttendanceUserType(userType) === 'student' && absentCutoffReached(ymd, lateAfterTime, now)) {
    return 'absent';
  }
  if (lateCutoffReached(ymd, lateAfterTime, now)) return 'late';
  return null;
};

const isAutoAttendanceStamp = (timestamp, ymd, lateAfterTime) => {
  const expected = `${ymd}T${normalizeLateAfterTime(lateAfterTime)}:00.000Z`;
  return String(timestamp || '') === expected;
};

const normalizeAttendanceUserType = (value) => {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'nonstaff' || raw === 'non_staff' || raw === 'non-staff') return 'non-staff';
  if (raw === 'staff') return 'staff';
  return 'student';
};

const loadEnrolledStudents = async (schoolId) => {
  let { data, error } = await supabase
    .from('students')
    .select('id, name, class, roll_number, alumni_year, created_at')
    .eq('school_id', schoolId);
  if (error && isMissingColumnError(error, 'roll_number')) {
    const retry = await supabase
      .from('students')
      .select('id, name, class, alumni_year, created_at')
      .eq('school_id', schoolId);
    data = retry.data;
    error = retry.error;
  }
  if (error && (isMissingColumnError(error, 'alumni_year') || String(error.message || '').includes('alumni_year'))) {
    const retry = await supabase.from('students').select('id, name, class, created_at').eq('school_id', schoolId);
    data = retry.data;
    error = retry.error;
  }
  if (error && isMissingColumnError(error, 'created_at')) {
    const retry = await supabase.from('students').select('id, name, class, alumni_year').eq('school_id', schoolId);
    data = retry.data;
    error = retry.error;
  }
  if (error || !data?.length) return [];
  return data
    .filter((row) => row.alumni_year == null || Number(row.alumni_year) <= 0)
    .map((row) => ({
      id: row.id,
      name: row.name,
      label: row.class,
      roll_number: row.roll_number || null,
      user_type: 'student',
      created_at: row.created_at || null,
    }));
};

const loadSchoolPeopleForAttendance = async (schoolId) => {
  const cacheKey = `att-people:${schoolId}`;
  const cached = cacheGet(cacheKey);
  if (Array.isArray(cached) && cached.length) return cached;

  const [students, staffRes, nonStaffRes] = await Promise.all([
    loadEnrolledStudents(schoolId),
    supabase.from('staffs').select('id, name, role, created_at').eq('school_id', schoolId),
    supabase.from('nonstaffs').select('id, name, role, created_at').eq('school_id', schoolId),
  ]);
  const staff = (staffRes.data || []).map((row) => ({
    id: row.id,
    name: row.name,
    label: row.role,
    user_type: 'staff',
    created_at: row.created_at || null,
  }));
  const nonStaff = (nonStaffRes.data || []).map((row) => ({
    id: row.id,
    name: row.name,
    label: row.role,
    user_type: 'non-staff',
    created_at: row.created_at || null,
  }));
  const people = [...students, ...staff, ...nonStaff];
  cacheSet(cacheKey, people, 45000);
  return people;
};

const insertAttendanceChunks = async (rows) => {
  let inserted = 0;
  for (let i = 0; i < rows.length; i += 80) {
    const chunk = rows.slice(i, i + 80);
    let { data, error } = await supabase.from('attendance').insert(chunk).select('id');
    if (error && (isMissingColumnError(error, 'user_name') || isMissingColumnError(error, 'user_label'))) {
      const stripped = chunk.map(({ user_name, user_label, ...rest }) => rest);
      const retry = await supabase.from('attendance').insert(stripped).select('id');
      data = retry.data;
      error = retry.error;
    }
    if (error) {
      console.warn('Auto attendance insert failed:', error.message);
      continue;
    }
    inserted += (data || []).length || chunk.length;
  }
  return inserted;
};

const notifyNewAbsences = async (schoolId, studentIds) => {
  const ids = [...new Set((studentIds || []).filter(Boolean))];
  if (!ids.length) return;
  const today = schoolLocalDate();
  const { data: school } = await supabase.from('schools').select('id, name').eq('id', schoolId).maybeSingle();
  let { data: students, error } = await supabase
    .from('students')
    .select('id, name, class, parent_phone, parent_email')
    .eq('school_id', schoolId)
    .in('id', ids);
  if (error && (isMissingColumnError(error, 'parent_phone') || isMissingColumnError(error, 'parent_email'))) {
    const retry = await supabase.from('students').select('id, name, class, parent_phone, parent_email').eq('school_id', schoolId).in('id', ids);
    students = retry.data;
    error = retry.error;
  }
  if (error) {
    console.warn('Absence notify lookup failed:', error.message);
    return;
  }
  await notifyParentsOfAbsence({
    schoolId,
    schoolName: school?.name,
    students: (students || []).filter((row) => ids.includes(row.id)),
    sendEmail: async ({ to, subject, text, html }) => sendAuthEmail({ to, subject, text, html }),
  }).catch((err) => console.warn('Absence parent notify failed:', err.message));
  void today;
};

const lateFillInflight = new Map();

const ensureUnscannedStudentsMarkedLate = async (schoolId, ymd, { people: givenPeople } = {}) => {
  const date = String(ymd || '').slice(0, 10);
  if (!schoolId || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !isSchoolWeekday(date)) return 0;
  const fillKey = `att-fill:${schoolId}:${date}`;
  if (cacheGet(fillKey)) return 0;
  if (lateFillInflight.has(fillKey)) return lateFillInflight.get(fillKey);

  const run = (async () => {
  const terms = await listAcademicTerms(schoolId).catch(() => []);
  if (!dateInAcademicTerm(date, terms)) {
    cacheSet(fillKey, 1, 60000);
    return 0;
  }

  const lateAfterTime = await getSchoolLateAfterTime(schoolId);
  if (!lateCutoffReached(date, lateAfterTime)) return 0;
  const markAbsent = absentCutoffReached(date, lateAfterTime);

  const [people, markedRows] = await Promise.all([
    givenPeople?.length ? Promise.resolve(givenPeople) : loadSchoolPeopleForAttendance(schoolId),
    fetchAllQueryRows(() =>
      applyAttendanceDateFilter(
        supabase
          .from('attendance')
          .select('id, user_id, user_type, status, timestamp')
          .eq('school_id', schoolId),
        date
      )
    ),
  ]);
  if (!people.length) return 0;

  const marked = new Map(
    filterAttendanceForDate(markedRows, date).map((row) => [
      `${normalizeAttendanceUserType(row.user_type)}:${row.user_id}`,
      row,
    ])
  );
  const stamp = `${date}T${lateAfterTime}:00.000Z`;
  const toInsert = [];
  const convertIds = [];
  const insertAbsentIds = [];
  const convertStudentIds = [];

  for (const person of people) {
    if (!person.id || !canHaveAttendanceOn(person.created_at, date)) continue;
    const key = `${person.user_type}:${person.id}`;
    const existing = marked.get(key);
    const wanted = autoAttendanceStatus(date, lateAfterTime, person.user_type);
    if (!wanted) continue;

    if (!existing) {
      toInsert.push({
        school_id: schoolId,
        user_type: person.user_type,
        user_id: person.id,
        date,
        timestamp: stamp,
        status: wanted,
        user_name: person.name || null,
        user_label: person.label || null,
      });
      if (wanted === 'absent' && person.user_type === 'student') insertAbsentIds.push(person.id);
      continue;
    }

    if (
      markAbsent &&
      person.user_type === 'student' &&
      String(existing.status || '').toLowerCase() === 'late' &&
      isAutoAttendanceStamp(existing.timestamp, date, lateAfterTime)
    ) {
      convertIds.push(existing.id);
      convertStudentIds.push(person.id);
    }
  }

  if (convertIds.length) {
    const { error } = await supabase
      .from('attendance')
      .update({ status: 'absent' })
      .eq('school_id', schoolId)
      .in('id', convertIds);
    if (error) {
      console.warn('Auto-absent update failed:', error.message);
      convertStudentIds.length = 0;
    }
  }

  const inserted = toInsert.length ? await insertAttendanceChunks(toInsert) : 0;
  const newlyAbsentIds = [...insertAbsentIds, ...convertStudentIds];
  if (inserted || convertIds.length) bumpSchoolCaches(schoolId);
  if (newlyAbsentIds.length && date === schoolLocalDate()) {
    await notifyNewAbsences(schoolId, newlyAbsentIds);
  }
  cacheSet(fillKey, 1, 90000);
  return inserted + newlyAbsentIds.length;
  })();

  lateFillInflight.set(fillKey, run);
  try {
    return await run;
  } finally {
    lateFillInflight.delete(fillKey);
  }
};

const eachSchoolDay = (from, to) => {
  const days = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) return days;
  const cursor = new Date(`${from}T12:00:00.000Z`);
  const end = new Date(`${to}T12:00:00.000Z`);
  while (cursor.getTime() <= end.getTime()) {
    const ymd = cursor.toISOString().slice(0, 10);
    if (isSchoolWeekday(ymd)) days.push(ymd);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
};

const fillPersonTermLateDays = async (schoolId, userId, userType, from, to) => {
  const lateAfterTime = await getSchoolLateAfterTime(schoolId);
  const today = schoolLocalDate();
  const last = to < today ? to : today;
  const days = eachSchoolDay(from, last).filter((day) => lateCutoffReached(day, lateAfterTime));
  if (!days.length) return 0;

  const existing = await fetchAllQueryRows(() =>
    supabase
      .from('attendance')
      .select('date')
      .eq('school_id', schoolId)
      .eq('user_id', userId)
      .eq('user_type', userType)
      .gte('date', from)
      .lte('date', last)
  );
  const have = new Set((existing || []).map((row) => String(row.date).slice(0, 10)));
  const missingDays = days.filter((day) => !have.has(day));
  if (!missingDays.length) return 0;

  const personRows = await loadSchoolPeopleForAttendance(schoolId);
  const person = personRows.find((row) => row.id === userId && row.user_type === userType);
  const startOn = firstAttendanceDate(person?.created_at);
  const eligibleDays = missingDays.filter((day) => !startOn || day >= startOn);
  if (!eligibleDays.length) return 0;
  const rows = eligibleDays.map((day) => ({
    school_id: schoolId,
    user_type: userType,
    user_id: userId,
    date: day,
    timestamp: `${day}T${lateAfterTime}:00.000Z`,
    status: autoAttendanceStatus(day, lateAfterTime, userType) || 'late',
    user_name: person?.name || null,
    user_label: person?.label || null,
  }));

  let inserted = 0;
  for (let i = 0; i < rows.length; i += 80) {
    const chunk = rows.slice(i, i + 80);
    let { error } = await supabase.from('attendance').insert(chunk);
    if (error && (isMissingColumnError(error, 'user_name') || isMissingColumnError(error, 'user_label'))) {
      const stripped = chunk.map(({ user_name, user_label, ...rest }) => rest);
      const retry = await supabase.from('attendance').insert(stripped);
      error = retry.error;
    }
    if (error) {
      console.warn('Person term late fill failed:', error.message);
      continue;
    }
    inserted += chunk.length;
  }
  if (inserted) bumpSchoolCaches(schoolId);
  return inserted;
};

const fillSchoolTermAttendance = async (schoolId, from, to, people) => {
  const roster = Array.isArray(people) ? people : [];
  if (!schoolId || !roster.length) return 0;
  const lateAfterTime = await getSchoolLateAfterTime(schoolId);
  const today = schoolLocalDate();
  const last = to < today ? to : today;
  const days = eachSchoolDay(from, last).filter((day) => lateCutoffReached(day, lateAfterTime));
  if (!days.length) return 0;

  const existing = await fetchAllQueryRows(() =>
    supabase
      .from('attendance')
      .select('user_id, user_type, date')
      .eq('school_id', schoolId)
      .gte('date', from)
      .lte('date', last)
  );
  const have = new Set(
    (existing || []).map(
      (row) =>
        `${normalizeAttendanceUserType(row.user_type)}:${row.user_id}:${String(row.date).slice(0, 10)}`
    )
  );

  const rows = [];
  for (const person of roster) {
    if (!person?.id) continue;
    const startOn = firstAttendanceDate(person.created_at);
    const userType = normalizeAttendanceUserType(person.user_type);
    for (const day of days) {
      if (startOn && day < startOn) continue;
      if (have.has(`${userType}:${person.id}:${day}`)) continue;
      rows.push({
        school_id: schoolId,
        user_type: userType,
        user_id: person.id,
        date: day,
        timestamp: `${day}T${lateAfterTime}:00.000Z`,
        status: autoAttendanceStatus(day, lateAfterTime, userType) || 'late',
        user_name: person.name || null,
        user_label: person.label || null,
      });
    }
  }
  if (!rows.length) return 0;

  let inserted = 0;
  for (let i = 0; i < rows.length; i += 80) {
    const chunk = rows.slice(i, i + 80);
    let { error } = await supabase.from('attendance').insert(chunk);
    if (error && (isMissingColumnError(error, 'user_name') || isMissingColumnError(error, 'user_label'))) {
      const stripped = chunk.map(({ user_name, user_label, ...rest }) => rest);
      const retry = await supabase.from('attendance').insert(stripped);
      error = retry.error;
    }
    if (error) {
      console.warn('School term late fill failed:', error.message);
      continue;
    }
    inserted += chunk.length;
  }
  if (inserted) bumpSchoolCaches(schoolId);
  return inserted;
};

app.post('/api/telemetry', authenticateToken, async (req, res) => {
  try {
    if (req.user.role === 'super_admin') {
      return res.json({ ok: true, skipped: true });
    }
    const payload = req.body || {};
    const events = Array.isArray(payload.events) ? payload.events : [payload];
    await recordClientEvents(
      {
        schoolId: req.user.schoolId,
        email: req.user.email,
        role: req.user.role,
      },
      events.map((event) => ({
        ...event,
        schoolName: event.schoolName || payload.schoolName || null,
      }))
    );
    res.json({ ok: true });
  } catch (error) {
    console.warn('Telemetry ingest error:', error.message || error);
    res.json({ ok: false });
  }
});

app.get('/api/super-admin/analytics', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const analytics = await getPlatformAnalytics({ range: req.query.range });
    res.json(analytics);
  } catch (error) {
    console.error('Super admin analytics error:', error);
    res.status(500).json({ error: error.message || 'Failed to load analytics' });
  }
});

app.get('/api/super-admin/overview', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    try {
      await rebuildPlatformRevenueLedger();
    } catch (ledgerErr) {
      console.warn('Platform ledger rebuild skipped:', ledgerErr.message || ledgerErr);
    }
    const { data: schoolAccounts, error: schoolsError } = await fetchSchoolAccounts();

    if (schoolsError) {
      return res.status(500).json({ error: schoolsError.message || 'Failed to fetch schools' });
    }

    const schoolIds = (schoolAccounts || []).map((s) => s.id);

    const [students, staff, nonStaff] = await Promise.all([
      schoolIds.length
        ? supabase.from('students').select('id', { count: 'exact', head: true }).in('school_id', schoolIds)
        : Promise.resolve({ count: 0 }),
      schoolIds.length
        ? supabase.from('staffs').select('id', { count: 'exact', head: true }).in('school_id', schoolIds)
        : Promise.resolve({ count: 0 }),
      schoolIds.length
        ? supabase.from('nonstaffs').select('id', { count: 'exact', head: true }).in('school_id', schoolIds)
        : Promise.resolve({ count: 0 }),
    ]);

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    let totalRevenue = 0;
    let revenueThisMonth = 0;
    let activeSubscriptions = 0;
    let pendingApprovals = 0;

    for (const school of schoolAccounts || []) {
      const merged = mergeSchoolWithExtras(school);
      totalRevenue += merged.total_paid || 0;

      const paid = schoolHasPaidPlan(merged);
      const status = paid ? 'approved' : merged.payment_plan ? merged.plan_status || 'pending' : 'none';
      if (status === 'approved') {
        activeSubscriptions += 1;
      } else if (status === 'pending' || status === 'none') {
        pendingApprovals += 1;
      }

      for (const record of merged.payment_records || []) {
        if (record.source && record.source !== 'paystack') continue;
        if (record.recorded_at && new Date(record.recorded_at) >= monthStart) {
          revenueThisMonth += Number(record.amount) || 0;
        }
      }
    }

    res.json({
      totalSchools: schoolAccounts?.length || 0,
      totalStudents: students.count || 0,
      totalStaff: staff.count || 0,
      totalNonStaff: nonStaff.count || 0,
      totalRevenue,
      revenueThisMonth,
      activeSubscriptions,
      pendingApprovals,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/super-admin/schools/:id/plan', authenticateToken, requireSuperAdmin, async (req, res) => {
  res.status(403).json({
    error: 'Payment plans are chosen by each school and cannot be changed by the platform admin.',
  });
});

app.patch('/api/super-admin/schools/:id/approval', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const { status } = req.body;
    if (!['approved', 'pending', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Invalid approval status' });
    }

    const { data: existingSchool, error: fetchError } = await supabase
      .from('schools')
      .select('*')
      .eq('id', req.params.id)
      .maybeSingle();

    if (fetchError || !existingSchool) {
      return res.status(404).json({ error: 'School not found' });
    }

    const merged = mergeSchoolWithExtras(existingSchool);

    if (status === 'approved' && !merged.payment_plan) {
      merged.payment_plan = inferPlanIdFromAmount(merged.total_paid) || (schoolHasPaidPlan(merged) ? 'small' : null);
    }
    if (status === 'approved' && !merged.payment_plan) {
      return res.status(400).json({ error: 'The school must select a payment plan before you can approve their account' });
    }

    const extrasUpdate = { plan_status: status };
    if (status === 'approved' && merged.payment_plan) extrasUpdate.payment_plan = merged.payment_plan;
    if (status === 'approved' && !merged.subscription_started_at) {
      if (merged.next_payment_due && merged.last_payment_at) {
        Object.assign(extrasUpdate, {
          subscription_started_at: merged.last_payment_at,
        });
      } else if (merged.next_payment_due) {
        const started = toDateString(addMonths(merged.next_payment_due, -1));
        Object.assign(extrasUpdate, {
          subscription_started_at: started,
          last_payment_at: started,
        });
      } else {
        Object.assign(extrasUpdate, initializeSubscription());
      }
    }
    const { data: statusRow, error: statusError } = await updateSchoolRecord(req.params.id, {
      plan_status: status,
      ...(status === 'approved' && merged.payment_plan ? { payment_plan: merged.payment_plan } : {}),
    });

    if (statusError || !statusRow || statusRow.plan_status !== status) {
      return res.status(500).json({
        error: `Failed to update approval status in database. ${PLAN_SCHEMA_HELP}`,
        detail: statusError?.message || null,
      });
    }

    try {
      await upsertSchoolExtras(req.params.id, extrasUpdate);
    } catch (persistError) {
      return res.status(500).json({
        error: persistError.message || `Failed to update approval status. ${PLAN_SCHEMA_HELP}`,
      });
    }

    const { data: updatedSchool } = await supabase
      .from('schools')
      .select('*')
      .eq('id', req.params.id)
      .maybeSingle();

    if (!updatedSchool || updatedSchool.plan_status !== status) {
      return res.status(500).json({
        error: `Approval status did not persist. ${PLAN_SCHEMA_HELP}`,
      });
    }

    bumpSchoolCaches(req.params.id);
    logPlatformAction({
      actor: req.user,
      action: 'super_admin.plan_status',
      targetSchoolId: req.params.id,
      detail: { status },
    }).catch(() => {});
    res.json(await buildSchoolWithStats(updatedSchool));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/super-admin/schools/:id/record-payment', authenticateToken, requireSuperAdmin, async (_req, res) => {
  res.status(410).json({
    error: 'Manual payment recording was removed. Revenue updates when Paystack signup or renewal payment succeeds.',
  });
});

app.patch('/api/super-admin/schools/:id/subscription', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const { frozen, nextPaymentDue } = req.body;

    const { data: existingSchool, error: fetchError } = await supabase
      .from('schools')
      .select('*')
      .eq('id', req.params.id)
      .maybeSingle();

    if (fetchError || !existingSchool) {
      return res.status(404).json({ error: 'School not found' });
    }

    if (getSchoolRole(existingSchool) === 'super_admin') {
      return res.status(404).json({ error: 'School not found' });
    }

    const updates = {};
    if (typeof frozen === 'boolean') {
      updates.subscription_frozen = frozen;
    }
    if (nextPaymentDue) {
      updates.next_payment_due = nextPaymentDue;
    }

    if (!Object.keys(updates).length) {
      return res.status(400).json({ error: 'No subscription updates provided' });
    }

    await upsertSchoolExtras(req.params.id, updates);

    res.json(await buildSchoolWithStats(existingSchool));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/super-admin/schools/:id', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const { confirmName } = req.body;

    const { data: existingSchool, error: fetchError } = await supabase
      .from('schools')
      .select('*')
      .eq('id', req.params.id)
      .maybeSingle();

    if (fetchError || !existingSchool) {
      return res.status(404).json({ error: 'School not found' });
    }

    if (getSchoolRole(existingSchool) === 'super_admin') {
      return res.status(403).json({ error: 'Cannot delete super admin account' });
    }

    if (!confirmName || confirmName.trim() !== existingSchool.name) {
      return res.status(400).json({
        error: 'Type the exact school name to confirm deletion',
      });
    }

    const schoolId = req.params.id;
    const schoolEmail = String(existingSchool.email || '')
      .trim()
      .toLowerCase();

    // Delete dependents first (covers tables without ON DELETE CASCADE).
    const relatedTables = [
      'attendance',
      'messages',
      'report_cards',
      'students',
      'staffs',
      'nonstaffs',
      'classes',
      'fees',
      'fee_payments',
      'academic_terms',
      'wallet_transactions',
      'wallet_accounts',
      'school_wallets',
      'subscription_payments',
      'platform_sms_sales',
      'school_sms_balances',
    ];

    for (const table of relatedTables) {
      const { error: deleteError } = await supabase.from(table).delete().eq('school_id', schoolId);
      if (deleteError) {
        const msg = String(deleteError.message || '').toLowerCase();
        if (
          deleteError.code !== '42P01' &&
          !msg.includes('does not exist') &&
          !msg.includes('could not find')
        ) {
          console.error(`Failed to delete ${table} for school ${schoolId}:`, deleteError.message);
        }
      }
    }

    const { error: schoolDeleteError } = await supabase.from('schools').delete().eq('id', schoolId);
    if (schoolDeleteError) {
      return res.status(500).json({
        error: schoolDeleteError.message || 'Failed to delete school account',
      });
    }

    await deleteSchoolExtras(schoolId);

    // Guarantee the email is free for immediate re-registration.
    if (schoolEmail) {
      const leftover = await findSchoolByEmail(schoolEmail);
      if (leftover) {
        await supabase.from('schools').delete().eq('email', schoolEmail);
        const stillThere = await findSchoolByEmail(schoolEmail);
        if (stillThere) {
          return res.status(500).json({
            error:
              'School was removed but the email is still reserved. Delete any remaining row with that email in Supabase, then try signup again.',
          });
        }
      }
    }

    res.json({
      message: `School "${existingSchool.name}" has been permanently deleted`,
      email_released: schoolEmail || null,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Health check endpoint
registerWalletRoutes(app, {
  authenticateToken,
  enforcePlanApproval,
  onSchoolCheckoutPaid: fulfillSchoolCheckout,
});
registerFeeRoutes(app, { authenticateToken, enforcePlanApproval });
registerAlumniRoutes(app, { authenticateToken, enforcePlanApproval });
registerSmsBillingRoutes(app, {
  authenticateToken,
  enforcePlanApproval,
  requireSuperAdmin,
  supabase,
});

app.get('/api/health', async (req, res) => {
  const checkDb = String(req.query.db || '') === '1';
  try {
    const payload = await buildHealthPayload({ checkDb });
    if (checkDb) {
      payload.db_pooler = await pingDbPooler();
      if (payload.db_pooler.configured && !payload.db_pooler.ok) payload.status = 'degraded';
      const dbHealth = await supabase
        .from('schools')
        .select('id', { count: 'exact', head: true })
        .limit(1);
      if (dbHealth.error) payload.status = 'degraded';
    }
    res.status(payload.status === 'error' ? 500 : 200).json(payload);
  } catch (error) {
    res.status(500).json({
      status: 'error',
      timestamp: new Date().toISOString(),
    });
  }
});

const supportHits = new Map();
const supportPhone = () =>
  String(process.env.SUPPORT_PHONE || process.env.VITE_SUPPORT_PHONE || '').trim();

function supportRateLimited(ip) {
  const key = String(ip || 'unknown');
  const now = Date.now();
  const windowMs = 60 * 60 * 1000;
  const row = supportHits.get(key) || { count: 0, start: now };
  if (now - row.start > windowMs) {
    supportHits.set(key, { count: 1, start: now });
    return false;
  }
  if (row.count >= 5) return true;
  row.count += 1;
  return false;
}

app.get('/api/public/support', (_req, res) => {
  res.json({ phone: supportPhone() });
});

app.post('/api/public/support', async (req, res) => {
  try {
    const ip = getClientIp(req);
    if (supportRateLimited(ip)) {
      return res.status(429).json({ error: 'Too many support requests. Try again later.' });
    }

    const fullName = String(req.body.fullName || req.body.name || '').trim();
    const email = String(req.body.email || '').trim();
    const contact = String(req.body.contact || '').trim();
    const country = String(req.body.country || '').trim();
    const location = String(req.body.location || '').trim();
    const message = String(req.body.message || '').trim();

    if (!fullName || !email || !contact || !country || !location || !message) {
      return res.status(400).json({ error: 'Fill name, email, contact, country, location, and message.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Enter a valid email address.' });
    }

    const schoolId = await findPlatformSchoolId(supabase);
    if (!schoolId) {
      return res.status(503).json({ error: 'Support inbox is not ready. Try again later.' });
    }

    const item = await createPublicSupportNotification({
      schoolId,
      fullName,
      email,
      contact,
      country,
      location,
      message,
    });
    res.json({ ok: true, id: item?.id || null });
  } catch (error) {
    console.warn('Public support insert failed:', error.code || '', error.message || error);
    res.status(error.status || 500).json({ error: error.message || 'Could not send that request.' });
  }
});

// ============ PUBLIC STUDENT ID (phone camera QR) ============

app.get('/api/public/id/:barcode', async (req, res) => {
  try {
    const ip = getClientIp(req);
    if (publicIdRateLimited(ip)) {
      return res.status(429).json({ error: 'Too many ID lookups. Try again later.' });
    }

    let barcode = req.params.barcode || '';
    try {
      barcode = decodeURIComponent(barcode);
    } catch {
      // already decoded
    }
    barcode = barcode.trim();
    if (!barcode) {
      return res.status(400).json({ error: 'Invalid ID code' });
    }

    let { data: student, error: studentError } = await supabase
      .from('students')
      .select('id, school_id, name, class, roll_number, barcode, parent_name, parent_phone')
      .eq('barcode', barcode)
      .maybeSingle();
    if (studentError && isMissingColumnError(studentError, 'roll_number')) {
      const retry = await supabase
        .from('students')
        .select('id, school_id, name, class, barcode, parent_name, parent_phone')
        .eq('barcode', barcode)
        .maybeSingle();
      student = retry.data;
      studentError = retry.error;
    }
    if (studentError) throw studentError;

    if (student) {
      const { data: school } = await supabase
        .from('schools')
        .select('name, logo_url')
        .eq('id', student.school_id)
        .maybeSingle();
      return res.json(
        gateProfile({
          type: 'student',
          name: student.name,
          class: student.class,
          roll_number: student.roll_number || null,
          parent_name: student.parent_name || null,
          parent_phone: student.parent_phone || null,
          school_name: school?.name || 'School',
          school_logo_url: school?.logo_url || null,
        })
      );
    }

    const { data: staff } = await supabase
      .from('staffs')
      .select('id, school_id, name, role, barcode, photo_url')
      .eq('barcode', barcode)
      .maybeSingle();

    if (staff) {
      const { data: school } = await supabase
        .from('schools')
        .select('name, logo_url')
        .eq('id', staff.school_id)
        .maybeSingle();
      return res.json(
        gateProfile({
          type: 'staff',
          name: staff.name,
          role: staff.role || 'Staff',
          school_name: school?.name || 'School',
          school_logo_url: school?.logo_url || null,
        })
      );
    }

    const { data: nonStaff } = await supabase
      .from('nonstaffs')
      .select('id, school_id, name, role, barcode, photo_url')
      .eq('barcode', barcode)
      .maybeSingle();

    if (nonStaff) {
      const { data: school } = await supabase
        .from('schools')
        .select('name, logo_url')
        .eq('id', nonStaff.school_id)
        .maybeSingle();
      return res.json(
        gateProfile({
          type: 'non-staff',
          name: nonStaff.name,
          role: nonStaff.role || 'Non-staff',
          school_name: school?.name || 'School',
          school_logo_url: school?.logo_url || null,
        })
      );
    }

    recordPublicIdFailure(ip);
    return res.status(404).json({ error: 'Person not found' });
  } catch (error) {
    console.error('Public ID error:', error);
    res.status(500).json({ error: 'Failed to load ID' });
  }
});

// ============ STUDENT ROUTES ============

// Get all students for a school
const loadSchoolForStudentIds = async (schoolId) => {
  const { data, error } = await supabase.from('schools').select('id, name').eq('id', schoolId).maybeSingle();
  if (error) throw error;
  return data;
};

app.get('/api/students', authenticateToken, enforcePlanApproval, async (req, res) => {
  try {
    try {
      const school = await loadSchoolForStudentIds(req.user.schoolId);
      if (school?.name) {
        const synced = await syncStudentIds(supabase, school, { fillOnly: true });
        if (synced.assigned.length) bumpSchoolCaches(req.user.schoolId);
      }
    } catch (idError) {
      console.warn('Student ID fill skipped:', idError.message || idError);
    }

    const { page, limit, from, to } = parsePagination(req);
    const q = String(req.query.q || '').trim();
    const classFilter = String(req.query.class || '').trim();
    const includePhotos = wantsPhotos(req);
    const safe = q.replace(/[%*,]/g, '');

    const { data: students, error, count } = await queryPagedRows('students', {
      schoolId: req.user.schoolId,
      from,
      to,
      q,
      orFilter: q ? `name.ilike.%${safe}%,roll_number.ilike.%${safe}%,barcode.ilike.%${safe}%` : '',
      columns: STUDENT_LIST_COLUMNS,
      includePhotos,
      eqFilters: classFilter && classFilter !== 'all' ? { class: classFilter } : undefined,
      isNullFilters: ['alumni_year'],
    });
    if (error) throw error;
    paginatedJson(res, includePhotos ? mergeStudentPhotos(students) : students, count, page, limit);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add new student
app.post('/api/students', authenticateToken, enforcePlanApproval, async (req, res) => {
  try {
    const {
      name,
      class: className,
      parentEmail,
      parentPhone,
      parentName,
      parentRelationship,
      houseAddress,
      dateOfBirth,
      gender,
      extraFees,
      extra_fees,
      rollNumber,
      photo,
    } = req.body;

    if (!name?.trim()) {
      return res.status(400).json({ error: 'Student name is required' });
    }
    if (!className?.trim()) {
      return res.status(400).json({ error: 'Class is required' });
    }
    if (!parentPhone?.trim()) {
      return res.status(400).json({ error: 'Parent phone number is required for SMS' });
    }
    const studentGender = parseRequiredGender(gender);

    void photo;
    void rollNumber;

    const barcode = `${req.user.schoolId}-STU-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const school = await loadSchoolForStudentIds(req.user.schoolId);
    const studentId = school?.name
      ? (await syncStudentIds(supabase, school, { className })).nextId
      : null;

    const record = {
      school_id: req.user.schoolId,
      name: name.trim(),
      class: className,
      gender: studentGender,
      extra_fees: extraFeesJson(extraFees || extra_fees),
      parent_name: parentName?.trim() || null,
      parent_relationship: parentRelationship?.trim() || null,
      parent_email: parentEmail?.trim() || null,
      parent_phone: parentPhone.trim(),
      house_address: houseAddress?.trim() || null,
      date_of_birth: dateOfBirth || null,
      roll_number: studentId,
      barcode,
      qr_code: barcode,
      created_at: new Date(),
    };

    const { data: student, error } = await insertStudentRecord(record);

    if (error) throw error;

    await writeStudentProfileFields(req.user.schoolId, student.id, {
      gender: studentGender,
      extra_fees: extraFeesJson(extraFees || extra_fees),
    });
    bumpSchoolCaches(req.user.schoolId);
    res.status(201).json(mergeStudentPhoto(await mergeStudentFields(student, req.user.schoolId)));
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

app.get('/api/students/:id', authenticateToken, enforcePlanApproval, async (req, res) => {
  try {
    const { data: student, error } = await supabase
      .from('students')
      .select('*')
      .eq('id', req.params.id)
      .eq('school_id', req.user.schoolId)
      .maybeSingle();
    if (error) throw error;
    if (!student) return res.status(404).json({ error: 'Student not found' });
    res.json(mergeStudentPhoto(await mergeStudentFields(student, req.user.schoolId)));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update student
app.put('/api/students/:id', authenticateToken, enforcePlanApproval, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      class: className,
      parentEmail,
      parent_email,
      parentPhone,
      parent_phone,
      parentName,
      parent_name,
      parentRelationship,
      parent_relationship,
      houseAddress,
      house_address,
      dateOfBirth,
      date_of_birth,
      gender,
      extraFees,
      extra_fees,
      rollNumber,
      roll_number,
    } = req.body;

    const updates = {};
    if (name !== undefined) updates.name = name;
    if (className !== undefined) updates.class = className;
    const nextParentEmail = parentEmail !== undefined ? parentEmail : parent_email;
    if (nextParentEmail !== undefined) updates.parent_email = nextParentEmail;
    const nextParentPhone = parentPhone !== undefined ? parentPhone : parent_phone;
    if (nextParentPhone !== undefined) updates.parent_phone = nextParentPhone;
    const nextParentName = parentName !== undefined ? parentName : parent_name;
    if (nextParentName !== undefined) updates.parent_name = nextParentName?.trim?.() || nextParentName || null;
    const nextParentRelationship =
      parentRelationship !== undefined ? parentRelationship : parent_relationship;
    if (nextParentRelationship !== undefined) {
      updates.parent_relationship = nextParentRelationship?.trim?.() || nextParentRelationship || null;
    }
    const nextHouse = houseAddress !== undefined ? houseAddress : house_address;
    if (nextHouse !== undefined) updates.house_address = nextHouse;
    const nextDob = dateOfBirth !== undefined ? dateOfBirth : date_of_birth;
    if (nextDob !== undefined) updates.date_of_birth = nextDob || null;
    if (gender !== undefined) updates.gender = parseRequiredGender(gender);
    if (extraFees !== undefined || extra_fees !== undefined) {
      updates.extra_fees = extraFeesJson(extraFees !== undefined ? extraFees : extra_fees);
    }
    const nextRoll = rollNumber !== undefined ? rollNumber : roll_number;
    const parsedRoll = parseStudentId(nextRoll);
    if (parsedRoll) updates.roll_number = formatParsedStudentId(parsedRoll);

    const { data: student, error } = await updateStudentRecord(id, req.user.schoolId, updates);

    if (error) throw error;

    await writeStudentProfileFields(req.user.schoolId, id, {
      gender: updates.gender,
      extra_fees: updates.extra_fees,
    });
    bumpSchoolCaches(req.user.schoolId);
    res.json(mergeStudentPhoto(await mergeStudentFields(student, req.user.schoolId)));
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

// Delete student
app.delete('/api/students/:id', authenticateToken, enforcePlanApproval, async (req, res) => {
  try {
    const { id } = req.params;
    await purgePersonRelated(supabase, {
      schoolId: req.user.schoolId,
      personId: id,
      kind: 'student',
    });

    const { error } = await supabase
      .from('students')
      .delete()
      .eq('id', id)
      .eq('school_id', req.user.schoolId);

    if (error) throw error;
    await deleteStudentPhoto(id);
    bumpSchoolCaches(req.user.schoolId);
    res.json({ message: 'Student and related records deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ STAFF ROUTES ============

// helper to normalize DB records for the frontend
const normalizeStaffRecord = (rec) => {
  if (!rec) return rec;
  return {
    ...rec,
    secretCode: rec.secret_code || null,
    subjects: rec.subjects || '',
    classNames: rec.class_names || '',
  };
};

const parseCsvList = (value) =>
  String(value || '')
    .split(/[,;\n]+/)
    .map((part) => part.trim())
    .filter(Boolean);

const labelsEqual = (left, right) =>
  String(left || '').trim().toLowerCase() === String(right || '').trim().toLowerCase();

const replaceCsvLabel = (csv, fromName, toName) => {
  const parts = parseCsvList(csv);
  if (!parts.length) return { next: csv || null, changed: false };
  let changed = false;
  const next = parts.map((part) => {
    if (!labelsEqual(part, fromName)) return part;
    changed = true;
    return toName;
  });
  return { next: toCsvField(next), changed };
};

const settleRename = async (promise) => {
  try {
    const result = await promise;
    if (result?.error) return;
  } catch {
    // Table or column may not exist on older schools.
  }
};

const rewriteStaffCsvColumn = async (schoolId, column, fromName, toName) => {
  const { data: rows, error } = await supabase
    .from('staffs')
    .select(`id, ${column}`)
    .eq('school_id', schoolId);
  if (error || !rows?.length) return;
  await Promise.all(
    rows.map(async (row) => {
      const { next, changed } = replaceCsvLabel(row[column], fromName, toName);
      if (!changed) return;
      await supabase.from('staffs').update({ [column]: next }).eq('id', row.id).eq('school_id', schoolId);
    })
  );
};

const renameStoredClassName = async (schoolId, fromName, toName) => {
  const from = String(fromName || '').trim();
  const to = String(toName || '').trim();
  if (!schoolId || !from || !to || from === to) return;

  await Promise.all([
    settleRename(supabase.from('students').update({ class: to }).eq('school_id', schoolId).eq('class', from)),
    settleRename(
      supabase.from('student_scores').update({ class_name: to }).eq('school_id', schoolId).eq('class_name', from)
    ),
    settleRename(
      supabase.from('report_cards').update({ class_name: to }).eq('school_id', schoolId).eq('class_name', from)
    ),
    settleRename(
      supabase.from('fee_payments').update({ payer_class: to }).eq('school_id', schoolId).eq('payer_class', from)
    ),
    settleRename(
      supabase.from('class_fees').update({ class_name: to }).eq('school_id', schoolId).eq('class_name', from)
    ),
    settleRename(
      supabase
        .from('attendance')
        .update({ user_label: to })
        .eq('school_id', schoolId)
        .eq('user_type', 'student')
        .eq('user_label', from)
    ),
    rewriteStaffCsvColumn(schoolId, 'class_names', from, to),
  ]);
};

const renameStoredSubjectName = async (schoolId, fromName, toName) => {
  const from = String(fromName || '').trim();
  const to = String(toName || '').trim();
  if (!schoolId || !from || !to || from === to) return;

  await Promise.all([
    settleRename(
      supabase.from('student_scores').update({ subject: to }).eq('school_id', schoolId).eq('subject', from)
    ),
    settleRename(supabase.from('report_cards').update({ course: to }).eq('school_id', schoolId).eq('course', from)),
    rewriteStaffCsvColumn(schoolId, 'subjects', from, to),
  ]);
};

/** Normalize class labels so "CLASS 1", "Class-1", and "class 1" match. */
const normalizeClassKey = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');

const listsOverlap = (left, right) => {
  const rightSet = new Set(right.map((item) => normalizeClassKey(item)));
  return left.some((item) => rightSet.has(normalizeClassKey(item)));
};

const slugifySchoolName = schoolNameSlug;

const insertStaffRecord = async (record) => {
  const payload = fillIdentityCodes({ ...record });
  const optionalColumns = ['secret_code', 'subjects', 'class_names', 'photo_url', 'barcode', 'qr_code'];

  for (let attempt = 0; attempt <= optionalColumns.length + 4; attempt++) {
    const { data, error } = await supabase.from('staffs').insert([payload]).select().single();
    if (!error) return { data, error: null };

    const missingColumn = optionalColumns.find(
      (column) => payload[column] !== undefined && isMissingColumnError(error, column)
    );
    if (missingColumn) {
      delete payload[missingColumn];
      continue;
    }
    if (isNotNullColumnError(error, 'qr_code') && payload.barcode && payload.qr_code !== payload.barcode) {
      payload.qr_code = payload.barcode;
      continue;
    }
    return { data: null, error };
  }

  return { data: null, error: { message: 'Failed to create staff record' } };
};

const updateStaffRecord = async (id, schoolId, updates) => {
  const payload = { ...updates };
  const optionalColumns = ['secret_code', 'subjects', 'class_names', 'photo_url'];

  for (let attempt = 0; attempt <= optionalColumns.length; attempt++) {
    const { data, error } = await supabase
      .from('staffs')
      .update(payload)
      .eq('id', id)
      .eq('school_id', schoolId)
      .select()
      .single();

    if (!error) return { data, error: null };

    const missingColumn = optionalColumns.find(
      (column) => payload[column] !== undefined && isMissingColumnError(error, column)
    );
    if (missingColumn) {
      delete payload[missingColumn];
      continue;
    }
    return { data: null, error };
  }

  return { data: null, error: { message: 'Failed to update staff record' } };
};

app.get('/api/staff', authenticateToken, enforcePlanApproval, async (req, res) => {
  try {
    const { page, limit, from, to } = parsePagination(req);
    const q = String(req.query.q || '').trim();
    const includePhotos = wantsPhotos(req);
    const safe = q.replace(/[%*,]/g, '');

    const { data: staff, error, count } = await queryPagedRows('staffs', {
      schoolId: req.user.schoolId,
      from,
      to,
      q,
      orFilter: q ? `name.ilike.%${safe}%,role.ilike.%${safe}%` : '',
      columns: STAFF_LIST_COLUMNS,
      includePhotos,
    });
    if (error) throw error;

    paginatedJson(
      res,
      (staff || []).map((member) =>
        includePhotos ? mergePersonPhoto(normalizeStaffRecord(member)) : normalizeStaffRecord(member)
      ),
      count,
      page,
      limit
    );
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/staff', authenticateToken, enforcePlanApproval, async (req, res) => {
  try {
    const { name, role, secretCode, subjects, classNames, class_names, salary } = req.body;

    if (!name?.trim()) {
      return res.status(400).json({ error: 'Staff name is required' });
    }
    if (!role?.trim()) {
      return res.status(400).json({ error: 'Staff role is required' });
    }
    const salaryAmount = parseRequiredSalary(salary);

    const barcode = `${req.user.schoolId}-STAFF-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const accessCode = String(secretCode || '').trim() || generateStrongPassword(16);
    const subjectsValue = toCsvField(subjects);
    const classesValue = toCsvField(classNames !== undefined ? classNames : class_names);

    const insertObj = {
      school_id: req.user.schoolId,
      name: name.trim(),
      role: role.trim(),
      salary: salaryAmount,
      barcode,
      qr_code: barcode,
      secret_code: accessCode,
      subjects: subjectsValue,
      class_names: classesValue,
      created_at: new Date(),
    };

    const { data: staff, error } = await insertStaffRecord(insertObj);
    if (error) throw error;

    const saved = staff;
    const response = normalizeStaffRecord({ ...saved, photo_url: null });
    if (!response.secretCode) response.secretCode = accessCode;

    bumpSchoolCaches(req.user.schoolId);
    res.json(mergePersonPhoto(response));
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

app.put('/api/staff/:id', authenticateToken, enforcePlanApproval, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      role,
      secretCode,
      subjects,
      classNames,
      class_names,
      salary,
    } = req.body;

    const { data: currentStaff, error: fetchError } = await supabase
      .from('staffs')
      .select('*')
      .eq('id', id)
      .eq('school_id', req.user.schoolId)
      .single();

    if (fetchError || !currentStaff) {
      return res.status(404).json({ error: 'Staff member not found' });
    }
    if (req.user.staffPortal && isProtectedStaffRole(currentStaff.role)) {
      return res.status(403).json({
        error: 'Only the school account can edit the administrator or accountant.',
      });
    }
    if (req.user.staffPortal && role && isProtectedStaffRole(role)) {
      return res.status(403).json({
        error: 'Only the school account can assign the administrator or accountant role.',
      });
    }

    const generateSecretCode = () => generateStrongPassword(16);
    const updates = {};
    if (name) updates.name = name.trim();
    if (role) updates.role = role.trim();
    updates.salary = parseRequiredSalary(salary);
    if (subjects !== undefined) updates.subjects = toCsvField(subjects);
    if (classNames !== undefined || class_names !== undefined) {
      updates.class_names = toCsvField(classNames !== undefined ? classNames : class_names);
    }

    if (secretCode !== undefined) {
      updates.secret_code = String(secretCode || '').trim() || generateSecretCode();
    } else if (!currentStaff.secret_code) {
      updates.secret_code = generateSecretCode();
    }

    const { data: staff, error } = await updateStaffRecord(id, req.user.schoolId, updates);
    if (error) throw error;

    bumpSchoolCaches(req.user.schoolId);
    res.json(mergePersonPhoto(normalizeStaffRecord(staff)));
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

app.get('/api/staff/:id', authenticateToken, enforcePlanApproval, async (req, res) => {
  try {
    const { data: staff, error } = await supabase
      .from('staffs')
      .select('*')
      .eq('id', req.params.id)
      .eq('school_id', req.user.schoolId)
      .maybeSingle();
    if (error) throw error;
    if (!staff) return res.status(404).json({ error: 'Staff member not found' });
    res.json(mergePersonPhoto(normalizeStaffRecord(staff)));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/staff/:id', authenticateToken, enforcePlanApproval, async (req, res) => {
  try {
    const { id } = req.params;
    if (req.user.staffPortal) {
      const { data: currentStaff } = await supabase
        .from('staffs')
        .select('role')
        .eq('id', id)
        .eq('school_id', req.user.schoolId)
        .maybeSingle();
      if (isProtectedStaffRole(currentStaff?.role)) {
        return res.status(403).json({
          error: 'Only the school account can delete the administrator or accountant.',
        });
      }
    }
    await purgePersonRelated(supabase, {
      schoolId: req.user.schoolId,
      personId: id,
      kind: 'staff',
    });

    const { error } = await supabase
      .from('staffs')
      .delete()
      .eq('id', id)
      .eq('school_id', req.user.schoolId);

    if (error) throw error;
    await deletePersonPhoto(id);
    bumpSchoolCaches(req.user.schoolId);
    res.json({ message: 'Staff member and related records deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ NON-STAFF ROUTES ============

app.get('/api/non-staff', authenticateToken, enforcePlanApproval, async (req, res) => {
  try {
    const { page, limit, from, to } = parsePagination(req);
    const q = String(req.query.q || '').trim();
    const includePhotos = wantsPhotos(req);
    const safe = q.replace(/[%*,]/g, '');

    const { data: nonStaff, error, count } = await queryPagedRows('nonstaffs', {
      schoolId: req.user.schoolId,
      from,
      to,
      q,
      orFilter: q ? `name.ilike.%${safe}%,role.ilike.%${safe}%` : '',
      columns: NONSTAFF_LIST_COLUMNS,
      includePhotos,
    });
    if (error) throw error;
    paginatedJson(res, includePhotos ? mergePersonPhotos(nonStaff) : nonStaff, count, page, limit);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/non-staff', authenticateToken, enforcePlanApproval, async (req, res) => {
  try {
    const { name, role } = req.body;

    if (!name?.trim()) {
      return res.status(400).json({ error: 'Name is required' });
    }

    const barcode = `${req.user.schoolId}-NONSTAFF-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const payload = fillIdentityCodes({
      school_id: req.user.schoolId,
      name: name.trim(),
      role: role?.trim() || null,
      barcode,
      qr_code: barcode,
      created_at: new Date(),
    });

    const optionalColumns = ['photo_url', 'barcode', 'qr_code'];
    let nonStaff = null;
    let error = null;
    for (let attempt = 0; attempt <= optionalColumns.length + 4; attempt++) {
      const result = await supabase.from('nonstaffs').insert([payload]).select().single();
      error = result.error;
      if (!error) {
        nonStaff = result.data;
        break;
      }
      const missingColumn = optionalColumns.find(
        (column) => payload[column] !== undefined && isMissingColumnError(error, column)
      );
      if (missingColumn) {
        delete payload[missingColumn];
        continue;
      }
      if (isNotNullColumnError(error, 'qr_code') && payload.barcode && payload.qr_code !== payload.barcode) {
        payload.qr_code = payload.barcode;
        continue;
      }
      break;
    }

    if (error || !nonStaff) throw error || new Error('Failed to create non-staff record');

    bumpSchoolCaches(req.user.schoolId);
    res.json(mergePersonPhoto(nonStaff));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/non-staff/:id', authenticateToken, enforcePlanApproval, async (req, res) => {
  try {
    const { data: person, error } = await supabase
      .from('nonstaffs')
      .select('*')
      .eq('id', req.params.id)
      .eq('school_id', req.user.schoolId)
      .maybeSingle();
    if (error) throw error;
    if (!person) return res.status(404).json({ error: 'Non-staff member not found' });
    res.json(mergePersonPhoto(person));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/non-staff/:id', authenticateToken, enforcePlanApproval, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, role } = req.body;

    const updates = {};
    if (name !== undefined) updates.name = name;
    if (role !== undefined) updates.role = role;

    const optionalColumns = ['photo_url'];
    let nonStaff = null;
    let error = null;
    const payload = { ...updates };
    for (let attempt = 0; attempt <= optionalColumns.length; attempt++) {
      const result = await supabase
        .from('nonstaffs')
        .update(payload)
        .eq('id', id)
        .eq('school_id', req.user.schoolId)
        .select()
        .single();
      error = result.error;
      if (!error) {
        nonStaff = result.data;
        break;
      }
      const missingColumn = optionalColumns.find(
        (column) => payload[column] !== undefined && isMissingColumnError(error, column)
      );
      if (missingColumn) {
        delete payload[missingColumn];
        continue;
      }
      break;
    }

    if (error || !nonStaff) throw error || new Error('Failed to update non-staff');

    bumpSchoolCaches(req.user.schoolId);
    res.json(mergePersonPhoto(nonStaff));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/non-staff/:id', authenticateToken, enforcePlanApproval, async (req, res) => {
  try {
    const { id } = req.params;
    await purgePersonRelated(supabase, {
      schoolId: req.user.schoolId,
      personId: id,
      kind: 'non-staff',
    });

    const { error } = await supabase
      .from('nonstaffs')
      .delete()
      .eq('id', id)
      .eq('school_id', req.user.schoolId);

    if (error) throw error;
    await deletePersonPhoto(id);
    bumpSchoolCaches(req.user.schoolId);
    res.json({ message: 'Non-staff member and related records deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ CLASSES & SUBJECTS (Setup) ============

const insertClassRecord = async (record) => {
  const payload = { ...record };
  const optionalColumns = ['capacity', 'form', 'fee_amount', 'subjects'];

  for (let attempt = 0; attempt <= optionalColumns.length; attempt++) {
    const { data, error } = await supabase.from('classes').insert([payload]).select().single();
    if (!error) return { data, error: null };
    const missingColumn = optionalColumns.find(
      (column) => payload[column] !== undefined && isMissingColumnError(error, column)
    );
    if (missingColumn) {
      delete payload[missingColumn];
      continue;
    }
    return { data: null, error };
  }
  return { data: null, error: { message: 'Failed to create class' } };
};

const updateClassRecord = async (id, schoolId, updates) => {
  const payload = { ...updates };
  const optionalColumns = ['capacity', 'form', 'fee_amount', 'subjects'];

  for (let attempt = 0; attempt <= optionalColumns.length; attempt++) {
    const { data, error } = await supabase
      .from('classes')
      .update(payload)
      .eq('id', id)
      .eq('school_id', schoolId)
      .select()
      .single();
    if (!error) return { data, error: null };
    const missingColumn = optionalColumns.find(
      (column) => payload[column] !== undefined && isMissingColumnError(error, column)
    );
    if (missingColumn) {
      delete payload[missingColumn];
      continue;
    }
    return { data: null, error };
  }
  return { data: null, error: { message: 'Failed to update class' } };
};

app.get('/api/classes', authenticateToken, enforcePlanApproval, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('classes')
      .select('*')
      .eq('school_id', req.user.schoolId)
      .order('created_at', { ascending: true });

    if (error) throw error;
    res.json(sortClasses(data || []));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/classes', authenticateToken, enforcePlanApproval, async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Class name is required' });

    const capacityRaw = req.body.capacity;
    const capacity =
      capacityRaw === '' || capacityRaw === null || capacityRaw === undefined
        ? null
        : Number(capacityRaw);

    const record = {
      id: uuidv4(),
      school_id: req.user.schoolId,
      name,
      created_at: new Date(),
    };
    if (capacity != null && !Number.isNaN(capacity)) record.capacity = capacity;
    const feeRaw = req.body.fee_amount ?? req.body.feeAmount;
    if (feeRaw !== undefined && feeRaw !== '' && feeRaw !== null) {
      const feeAmount = Number(feeRaw);
      if (Number.isFinite(feeAmount) && feeAmount >= 0) record.fee_amount = feeAmount;
    }
    const subjectsValue = toCsvField(req.body.subjects);
    if (subjectsValue) record.subjects = subjectsValue;

    const { data, error } = await insertClassRecord(record);
    if (error) throw error;
    bumpSchoolCaches(req.user.schoolId);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/classes/:id', authenticateToken, enforcePlanApproval, async (req, res) => {
  try {
    const updates = {};
    if (req.body.name !== undefined) {
      const name = String(req.body.name || '').trim();
      if (!name) return res.status(400).json({ error: 'Class name is required' });
      updates.name = name;
    }
    if (req.body.capacity !== undefined) {
      const capacityRaw = req.body.capacity;
      updates.capacity =
        capacityRaw === '' || capacityRaw === null ? null : Number(capacityRaw) || null;
    }
    if (req.body.fee_amount !== undefined || req.body.feeAmount !== undefined) {
      const feeRaw = req.body.fee_amount ?? req.body.feeAmount;
      updates.fee_amount = feeRaw === '' || feeRaw === null ? 0 : Number(feeRaw) || 0;
    }
    if (req.body.subjects !== undefined) {
      updates.subjects = toCsvField(req.body.subjects);
    }

    const { data: existing } = await supabase
      .from('classes')
      .select('name')
      .eq('id', req.params.id)
      .eq('school_id', req.user.schoolId)
      .maybeSingle();

    const { data, error } = await updateClassRecord(req.params.id, req.user.schoolId, updates);
    if (error) throw error;
    if (updates.name && existing?.name && updates.name !== existing.name) {
      await renameStoredClassName(req.user.schoolId, existing.name, updates.name);
    }
    bumpSchoolCaches(req.user.schoolId);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/classes/:id', authenticateToken, enforcePlanApproval, async (req, res) => {
  try {
    const { error } = await supabase
      .from('classes')
      .delete()
      .eq('id', req.params.id)
      .eq('school_id', req.user.schoolId);
    if (error) throw error;
    bumpSchoolCaches(req.user.schoolId);
    res.json({ message: 'Class deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const truthyFlag = (value) =>
  value === true || value === 1 || String(value || '').trim().toLowerCase() === 'true';

const stripSubjectFromClasses = async (schoolId, subjectName) => {
  const target = String(subjectName || '').trim().toLowerCase();
  if (!schoolId || !target) return;
  const { data, error } = await supabase
    .from('classes')
    .select('id, subjects')
    .eq('school_id', schoolId);
  if (error || !data?.length) return;
  await Promise.all(
    data.map(async (row) => {
      const current = parseCsvList(row.subjects);
      const next = current.filter((item) => item.toLowerCase() !== target);
      if (next.length === current.length) return;
      await supabase
        .from('classes')
        .update({ subjects: toCsvField(next) })
        .eq('id', row.id)
        .eq('school_id', schoolId);
    })
  );
};

const insertSubjectRecord = async (record) => {
  const payload = { ...record };
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, error } = await supabase.from('subjects').insert([payload]).select().single();
    if (!error) return { data, error: null };
    if (payload.is_core !== undefined && isMissingColumnError(error, 'is_core')) {
      delete payload.is_core;
      continue;
    }
    return { data: null, error };
  }
  return { data: null, error: { message: 'Failed to create subject' } };
};

app.get('/api/subjects', authenticateToken, enforcePlanApproval, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('subjects')
      .select('*')
      .eq('school_id', req.user.schoolId)
      .order('created_at', { ascending: true });

    if (error) {
      if (error.code === '42P01' || isMissingColumnError(error, 'subjects')) {
        return res.json([]);
      }
      throw error;
    }
    res.json(
      (data || []).map((row) => ({
        ...row,
        is_core: Boolean(row.is_core),
      }))
    );
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/subjects', authenticateToken, enforcePlanApproval, async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Subject name is required' });

    const record = {
      id: uuidv4(),
      school_id: req.user.schoolId,
      name,
      is_core: truthyFlag(req.body.is_core ?? req.body.core),
      created_at: new Date(),
    };
    const { data, error } = await insertSubjectRecord(record);
    if (error) throw error;
    bumpSchoolCaches(req.user.schoolId);
    res.json({ ...data, is_core: Boolean(data?.is_core) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/subjects/:id', authenticateToken, enforcePlanApproval, async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Subject name is required' });
    const isCore =
      req.body.is_core !== undefined || req.body.core !== undefined
        ? truthyFlag(req.body.is_core ?? req.body.core)
        : undefined;

    const { data: existing } = await supabase
      .from('subjects')
      .select('name')
      .eq('id', req.params.id)
      .eq('school_id', req.user.schoolId)
      .maybeSingle();

    const updates = { name };
    if (isCore !== undefined) updates.is_core = isCore;

    let { data, error } = await supabase
      .from('subjects')
      .update(updates)
      .eq('id', req.params.id)
      .eq('school_id', req.user.schoolId)
      .select()
      .single();
    if (error && updates.is_core !== undefined && isMissingColumnError(error, 'is_core')) {
      delete updates.is_core;
      const retry = await supabase
        .from('subjects')
        .update(updates)
        .eq('id', req.params.id)
        .eq('school_id', req.user.schoolId)
        .select()
        .single();
      data = retry.data;
      error = retry.error;
    }
    if (error) throw error;
    if (existing?.name && existing.name !== name) {
      await renameStoredSubjectName(req.user.schoolId, existing.name, name);
    }
    if (isCore) {
      await stripSubjectFromClasses(req.user.schoolId, name);
    }
    bumpSchoolCaches(req.user.schoolId);
    res.json({ ...data, is_core: Boolean(data?.is_core || isCore) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/subjects/:id', authenticateToken, enforcePlanApproval, async (req, res) => {
  try {
    const { error } = await supabase
      .from('subjects')
      .delete()
      .eq('id', req.params.id)
      .eq('school_id', req.user.schoolId);
    if (error) throw error;
    res.json({ message: 'Subject deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ ATTENDANCE ROUTES ============

const getAttendanceCode = (body) => {
  const raw = (body?.qrCode || body?.barcode || '').trim();
  if (!raw) return null;

  try {
    const url = new URL(raw);
    const match = url.pathname.match(/\/(?:id|pay)\/([^/]+)\/?$/);
    if (match?.[1]) return decodeURIComponent(match[1]);
  } catch {
    // not a URL
  }

  const pathMatch = raw.match(/\/(?:id|pay)\/([^/?#\s]+)/);
  if (pathMatch?.[1]) {
    try {
      return decodeURIComponent(pathMatch[1]);
    } catch {
      return pathMatch[1];
    }
  }

  return raw;
};

const markAttendanceForSchool = async (schoolId, attendanceCode) => {
  const person = await findPersonByAttendanceCode(schoolId, attendanceCode);
  if (!person) {
    const err = new Error('Invalid QR code');
    err.status = 404;
    throw err;
  }

  const { userId, userName, userLabel, userType } = person;
  const schoolName = await getSchoolNameById(schoolId);
  const now = schoolNow();
  const today = schoolLocalDate(now);
  if (!canHaveAttendanceOn(person.createdAt, today)) {
    const err = new Error('Attendance starts the day after enrollment');
    err.status = 400;
    err.user = buildScanIdentity(person, schoolName, null);
    throw err;
  }
  const lateAfterTime = await getSchoolLateAfterTime(schoolId);
  assertScannerOpen(lateAfterTime, now);
  const punctuality = getAttendancePunctuality(now, lateAfterTime);
  const identity = buildScanIdentity(person, schoolName, punctuality);

  const { data: existingAttendance } = await supabase
    .from('attendance')
    .select('id, status')
    .eq('school_id', schoolId)
    .eq('user_type', userType)
    .eq('user_id', userId)
    .eq('date', today)
    .maybeSingle();

  if (existingAttendance) {
    if (['late', 'absent'].includes(String(existingAttendance.status || '').toLowerCase())) {
      const updates = { timestamp: now.toISOString(), status: punctuality, user_name: userName || null, user_label: userLabel || null };
      let { error: updateError } = await supabase
        .from('attendance')
        .update(updates)
        .eq('id', existingAttendance.id)
        .eq('school_id', schoolId);
      if (updateError && (isMissingColumnError(updateError, 'user_name') || isMissingColumnError(updateError, 'user_label'))) {
        delete updates.user_name;
        delete updates.user_label;
        const retry = await supabase
          .from('attendance')
          .update(updates)
          .eq('id', existingAttendance.id)
          .eq('school_id', schoolId);
        updateError = retry.error;
      }
      if (!updateError) {
        bumpSchoolCaches(schoolId);
        return {
          message: `Attendance marked for ${userName} (${punctuality === 'late' ? 'Late' : 'Early'})`,
          attendance: { ...existingAttendance, ...updates },
          user: identity,
        };
      }
    }
    const err = new Error('Attendance already marked for today');
    err.status = 400;
    err.user = identity;
    throw err;
  }

  const insertPayload = {
    school_id: schoolId,
    user_type: userType,
    user_id: userId,
    date: today,
    timestamp: now.toISOString(),
    status: punctuality,
    user_name: userName || null,
    user_label: userLabel || null,
  };

  let attendance = null;
  let error = null;
  {
    const result = await supabase.from('attendance').insert([insertPayload]).select().single();
    attendance = result.data;
    error = result.error;
  }

  if (error && (isMissingColumnError(error, 'user_name') || isMissingColumnError(error, 'user_label'))) {
    delete insertPayload.user_name;
    delete insertPayload.user_label;
    const retry = await supabase.from('attendance').insert([insertPayload]).select().single();
    attendance = retry.data;
    error = retry.error;
  }

  if (error) throw error;
  bumpSchoolCaches(schoolId);

  return {
    message: `Attendance marked for ${userName} (${punctuality === 'late' ? 'Late' : 'Early'})`,
    attendance,
    user: identity,
  };
};

const resolveScannerSchool = async (token) => {
  const schoolId = await getSchoolIdByScannerToken(token);
  if (!schoolId) return null;

  const { data: school, error } = await supabase
    .from('schools')
    .select('*')
    .eq('id', schoolId)
    .maybeSingle();

  if (error || !school) return null;

  const merged = mergeSchoolWithExtras(school);
  if (!merged.payment_plan) return null;
  if ((merged.plan_status || 'pending') !== 'approved') return null;
  if (!hasPlanFeature(merged.payment_plan, 'scanner')) return null;
  if (!getSubscriptionInfo(merged).subscription_active) return null;

  return { schoolId, schoolName: merged.name };
};

// Mobile scanner link (admin dashboard)
app.get('/api/scanner/link', authenticateToken, enforcePlanApproval, async (req, res) => {
  try {
    const { data: school } = await supabase
      .from('schools')
      .select('*')
      .eq('id', req.user.schoolId)
      .maybeSingle();
    if (!school) {
      return res.status(404).json({ error: 'School not found' });
    }
    const merged = mergeSchoolWithExtras(school);
    if (school?.id) hydrateExtrasFromSchool(school);

    if (!hasPlanFeature(merged.payment_plan, 'scanner')) {
      return res.status(403).json({ error: 'Scanner is not included in your plan' });
    }

    // Stable: returns existing token; only POST /api/scanner/regenerate creates a new one.
    const token = await ensureScannerToken(req.user.schoolId);
    res.json({ token, schoolName: merged.name });
  } catch (error) {
    console.error('Scanner link error:', error);
    res.status(500).json({ error: 'Failed to load scanner link' });
  }
});

app.post('/api/scanner/regenerate', authenticateToken, enforcePlanApproval, async (req, res) => {
  try {
    const { data: school } = await supabase
      .from('schools')
      .select('*')
      .eq('id', req.user.schoolId)
      .maybeSingle();
    if (!school) {
      return res.status(404).json({ error: 'School not found' });
    }
    const merged = mergeSchoolWithExtras(school);
    if (school?.id) hydrateExtrasFromSchool(school);

    if (!hasPlanFeature(merged.payment_plan, 'scanner')) {
      return res.status(403).json({ error: 'Scanner is not included in your plan' });
    }

    const token = await regenerateScannerToken(req.user.schoolId);
    res.json({ token });
  } catch (error) {
    console.error('Scanner regenerate error:', error);
    res.status(500).json({ error: 'Failed to regenerate scanner link' });
  }
});

// ============ STAFF PORTAL (token link + access code) ============

const resolveStaffPortalSchool = async (token) => {
  const schoolId = await getSchoolIdByStaffPortalToken(token);
  if (!schoolId) return null;

  const { data: school, error } = await supabase
    .from('schools')
    .select('*')
    .eq('id', schoolId)
    .maybeSingle();

  if (error || !school) return null;

  const merged = mergeSchoolWithExtras(school);
  if (!merged.payment_plan) return null;
  if ((merged.plan_status || 'pending') !== 'approved') return null;
  if (!hasPlanFeature(merged.payment_plan, 'staff')) return null;
  if (!getSubscriptionInfo(merged).subscription_active) return null;

  return { schoolId, schoolName: merged.name, school: merged };
};

const authenticateStaffPortal = (req, res, next) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Staff portal session required' });
  }

  jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }, (err, payload) => {
    if (err || payload?.purpose !== 'staff_portal') {
      return res.status(401).json({ error: 'Invalid or expired staff portal session' });
    }
    if (!isStaffSessionActive(payload.staffId, token)) {
      return res.status(401).json({
        error: 'This staff login is already used on another device. Sign in here to continue.',
      });
    }
    req.staffPortal = payload;
    next();
  });
};

app.get('/api/staff-portal/link', authenticateToken, enforcePlanApproval, async (req, res) => {
  try {
    const { data: school } = await supabase
      .from('schools')
      .select('*')
      .eq('id', req.user.schoolId)
      .maybeSingle();
    if (!school) return res.status(404).json({ error: 'School not found' });

    const merged = mergeSchoolWithExtras(school);
    if (school?.id) hydrateExtrasFromSchool(school);
    if (!hasPlanFeature(merged.payment_plan, 'staff')) {
      return res.status(403).json({ error: 'Staff portal requires the Staff feature on your plan' });
    }

    const token = await ensureStaffPortalToken(req.user.schoolId);
    const slug = slugifySchoolName(merged.name);
    res.json({
      token,
      schoolName: merged.name,
      schoolSlug: slug,
      portalPath: `/${slug}/staff-portal`,
    });
  } catch (error) {
    console.error('Staff portal link error:', error);
    res.status(500).json({ error: error.message || 'Failed to load staff portal link' });
  }
});

app.post('/api/staff-portal/regenerate', authenticateToken, enforcePlanApproval, async (req, res) => {
  try {
    const { data: school } = await supabase
      .from('schools')
      .select('*')
      .eq('id', req.user.schoolId)
      .maybeSingle();
    if (!school) return res.status(404).json({ error: 'School not found' });

    const merged = mergeSchoolWithExtras(school);
    if (school?.id) hydrateExtrasFromSchool(school);
    if (!hasPlanFeature(merged.payment_plan, 'staff')) {
      return res.status(403).json({ error: 'Staff portal requires the Staff feature on your plan' });
    }

    const token = await regenerateStaffPortalToken(req.user.schoolId);
    const slug = slugifySchoolName(merged.name);
    res.json({
      token,
      schoolName: merged.name,
      schoolSlug: slug,
      portalPath: `/${slug}/staff-portal`,
    });
  } catch (error) {
    console.error('Staff portal regenerate error:', error);
    res.status(500).json({ error: error.message || 'Failed to regenerate staff portal link' });
  }
});

/** Resolve short /{school-name}/staff-portal links without exposing the portal token. */
app.get('/api/public/staff-portal/:schoolSlug', async (req, res) => {
  try {
    const wanted = slugifySchoolName(req.params.schoolSlug);
    if (!wanted) return res.status(400).json({ error: 'Invalid school link' });

    let match = null;
    const { data: bySlug, error: slugError } = await supabase
      .from('schools')
      .select('id, name, name_slug, role, payment_plan, plan_status, next_payment_due, last_payment_at, subscription_frozen, subscription_started_at')
      .eq('name_slug', wanted)
      .maybeSingle();
    if (slugError && !isMissingColumnError(slugError, 'name_slug')) throw slugError;
    if (bySlug) match = bySlug;
    if (!match) {
      const { data: schools, error } = await supabase
        .from('schools')
        .select('id, name, role, payment_plan, plan_status, next_payment_due, last_payment_at, subscription_frozen, subscription_started_at');
      if (error) throw error;
      match = (schools || []).find((school) => slugifySchoolName(school.name) === wanted) || null;
    }
    if (match) {
      if (String(match.role || '') === 'super_admin') match = null;
      else {
        const merged = mergeSchoolWithExtras(match);
        if (!merged.payment_plan || (merged.plan_status || 'pending') !== 'approved') match = null;
        else if (!hasPlanFeature(merged.payment_plan, 'staff')) match = null;
        else if (!getSubscriptionInfo(merged).subscription_active) match = null;
        else match = merged;
      }
    }

    if (!match) {
      return res.status(404).json({ error: 'Staff portal not found for this school' });
    }

    res.json({
      schoolName: mergeSchoolWithExtras(match).name,
      schoolSlug: wanted,
    });
  } catch (error) {
    console.error('Public staff portal resolve error:', error);
    res.status(500).json({ error: 'Failed to resolve staff portal' });
  }
});

async function findStaffPortalSchoolBySlug(schoolSlug) {
  const wanted = slugifySchoolName(schoolSlug);
  if (!wanted) return null;
  let match = null;
  const { data: bySlug, error: slugError } = await supabase
    .from('schools')
    .select('id, name, name_slug, role, payment_plan, plan_status, next_payment_due, last_payment_at, subscription_frozen, subscription_started_at')
    .eq('name_slug', wanted)
    .maybeSingle();
  if (slugError && !isMissingColumnError(slugError, 'name_slug')) throw slugError;
  match = bySlug || null;
  if (!match) {
    const { data: schools, error } = await supabase
      .from('schools')
      .select('id, name, role, payment_plan, plan_status, next_payment_due, last_payment_at, subscription_frozen, subscription_started_at');
    if (error) throw error;
    match = (schools || []).find((school) => slugifySchoolName(school.name) === wanted) || null;
  }
  if (!match || String(match.role || '') === 'super_admin') return null;
  const merged = mergeSchoolWithExtras(match);
  if (!merged.payment_plan || (merged.plan_status || 'pending') !== 'approved') return null;
  if (!hasPlanFeature(merged.payment_plan, 'staff')) return null;
  if (!getSubscriptionInfo(merged).subscription_active) return null;
  const token = await ensureStaffPortalToken(merged.id);
  return {
    schoolId: merged.id,
    schoolName: merged.name,
    token,
  };
}

async function issueStaffPortalSession(req, res, resolved) {
  const clientIp = getClientIp(req);
  const hitCheck = await checkAuthHitAllowed('staff_login', clientIp);
  if (!hitCheck.allowed) {
    recordPlatformEvent({
      eventType: 'login_failed',
      schoolId: resolved.schoolId,
      schoolName: resolved.schoolName,
      role: 'staff_portal',
      path: '/staff-portal',
      meta: { reason: 'rate_limited', source: 'staff_portal' },
    }).catch(() => {});
    return sendAuthRateLimited(res, hitCheck);
  }
  await recordAuthHit('staff_login', clientIp);

  const accessCode = String(req.body.accessCode || req.body.secretCode || '').trim();
  const role = String(req.body.role || '').trim();
  if (!accessCode || !role) {
    return res.status(400).json({ error: 'Access code and role are required' });
  }

  const { data: staffRows, error } = await supabase
    .from('staffs')
    .select('id, name, role, subjects, class_names, school_id, secret_code')
    .eq('school_id', resolved.schoolId)
    .eq('secret_code', accessCode);

  if (error) throw error;

  const staff =
    (staffRows || []).find((row) => String(row.role || '').toLowerCase() === role.toLowerCase()) ||
    null;

  if (!staff) {
    recordPlatformEvent({
      eventType: 'login_failed',
      schoolId: resolved.schoolId,
      schoolName: resolved.schoolName,
      role: 'staff_portal',
      path: '/staff-portal',
      meta: {
        reason: 'wrong_password',
        source: 'staff_portal',
        attemptedRole: role,
      },
    }).catch(() => {});
    return res.status(401).json({ error: 'Invalid access code or role' });
  }

  const sessionToken = jwt.sign(
    {
      purpose: 'staff_portal',
      schoolId: resolved.schoolId,
      staffId: staff.id,
      staffName: staff.name,
      role: staff.role,
      portalToken: resolved.token || req.params.token,
    },
    JWT_SECRET,
    { expiresIn: '12h' }
  );
  setStaffSession(staff.id, sessionToken);

  recordPlatformEvent({
    eventType: 'staff_login',
    schoolId: resolved.schoolId,
    schoolName: resolved.schoolName,
    email: staff.name,
    role: 'staff_portal',
    path: '/staff-portal',
    meta: {
      staffId: staff.id,
      staffName: staff.name,
      staffRole: staff.role,
      source: 'staff_portal',
    },
  }).catch(() => {});

  res.json({
    sessionToken,
    schoolName: resolved.schoolName,
    school: {
      name: resolved.schoolName,
      logo_url: resolved.school?.logo_url || null,
      payment_plan: resolved.school?.payment_plan || null,
      plan_status: resolved.school?.plan_status || 'approved',
      plan_approved: true,
      role: 'school',
    },
    staff: {
      id: staff.id,
      name: staff.name,
      role: staff.role,
      subjects: parseCsvList(staff.subjects),
      classNames: parseCsvList(staff.class_names),
    },
  });
}

app.get('/api/staff-portal/:token/school', async (req, res) => {
  try {
    const resolved = await resolveStaffPortalSchool(req.params.token);
    if (!resolved) {
      return res.status(404).json({ error: 'Invalid or inactive staff portal link' });
    }
    res.json({ schoolName: resolved.schoolName });
  } catch (error) {
    console.error('Staff portal school error:', error);
    res.status(500).json({ error: 'Failed to load staff portal' });
  }
});

app.post('/api/public/staff-portal/:schoolSlug/login', async (req, res) => {
  try {
    const resolved = await findStaffPortalSchoolBySlug(req.params.schoolSlug);
    if (!resolved) {
      return res.status(404).json({ error: 'Invalid or inactive staff portal link' });
    }
    return issueStaffPortalSession(req, res, resolved);
  } catch (error) {
    console.error('Staff portal slug login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

app.post('/api/staff-portal/:token/login', async (req, res) => {
  try {
    const resolved = await resolveStaffPortalSchool(req.params.token);
    if (!resolved) {
      return res.status(404).json({ error: 'Invalid or inactive staff portal link' });
    }
    return issueStaffPortalSession(req, res, { ...resolved, token: req.params.token });
  } catch (error) {
    console.error('Staff portal login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

app.post('/api/staff-portal/session/telemetry', authenticateStaffPortal, async (req, res) => {
  try {
    const payload = req.body || {};
    const events = Array.isArray(payload.events) ? payload.events : [payload];
    await recordClientEvents(
      {
        schoolId: req.staffPortal.schoolId,
        email: req.staffPortal.staffName || req.staffPortal.staffId,
        role: 'staff_portal',
      },
      events.map((event) => ({
        ...event,
        schoolName: event.schoolName || payload.schoolName || null,
        path: event.path || '/staff-portal',
        meta: {
          ...(event.meta && typeof event.meta === 'object' ? event.meta : {}),
          staffId: req.staffPortal.staffId,
          staffName: req.staffPortal.staffName || event.meta?.staffName || null,
          staffRole: req.staffPortal.role,
          source: 'staff_portal',
        },
      }))
    );
    res.json({ ok: true });
  } catch (error) {
    console.warn('Staff portal telemetry error:', error.message || error);
    res.json({ ok: false });
  }
});

app.get('/api/staff-portal/session/me', authenticateStaffPortal, async (req, res) => {
  try {
    const { data: staff, error } = await supabase
      .from('staffs')
      .select('*')
      .eq('id', req.staffPortal.staffId)
      .eq('school_id', req.staffPortal.schoolId)
      .maybeSingle();

    if (error) throw error;
    if (!staff) return res.status(404).json({ error: 'Staff member not found' });

    const { data: school } = await supabase
      .from('schools')
      .select('name, logo_url, payment_plan, plan_status')
      .eq('id', req.staffPortal.schoolId)
      .maybeSingle();

    const currentTerm = await resolveTeacherScoreTerm(req.staffPortal.schoolId);

    res.json({
      schoolName: school?.name || 'School',
      school: {
        name: school?.name || 'School',
        logo_url: school?.logo_url || null,
        payment_plan: school?.payment_plan || null,
        plan_status: school?.plan_status || 'approved',
        plan_approved: true,
        role: 'school',
      },
      currentTerm: currentTerm.name,
      term: currentTerm,
      staff: {
        id: staff.id,
        name: staff.name,
        role: staff.role,
        subjects: parseCsvList(staff.subjects),
        classNames: parseCsvList(staff.class_names),
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/staff-portal/session/students', authenticateStaffPortal, async (req, res) => {
  try {
    if (String(req.staffPortal.role).toLowerCase() !== 'teacher') {
      return res.status(403).json({ error: 'Only teachers can view class students here' });
    }

    const { data: staff, error: staffError } = await supabase
      .from('staffs')
      .select('*')
      .eq('id', req.staffPortal.staffId)
      .eq('school_id', req.staffPortal.schoolId)
      .maybeSingle();
    if (staffError) throw staffError;
    if (!staff) return res.status(404).json({ error: 'Staff member not found' });

    const classNames = parseCsvList(staff.class_names);
    if (!classNames.length) {
      return res.json([]);
    }

    let students = null;
    let error = null;

    ({ data: students, error } = await supabase
      .from('students')
      .select('id, name, class, roll_number, photo_url, parent_name, parent_phone, parent_relationship, parent_email')
      .eq('school_id', req.staffPortal.schoolId)
      .order('name', { ascending: true }));

    if (error && (isMissingColumnError(error, 'parent_phone') || isMissingColumnError(error, 'parent_name') || isMissingColumnError(error, 'parent_email') || isMissingColumnError(error, 'parent_relationship'))) {
      ({ data: students, error } = await supabase
        .from('students')
        .select('id, name, class, roll_number, photo_url')
        .eq('school_id', req.staffPortal.schoolId)
        .order('name', { ascending: true }));
    }

    if (error) throw error;

    const classSet = new Set(classNames.map((c) => normalizeClassKey(c)));
    const filtered = (students || []).filter((student) =>
      classSet.has(normalizeClassKey(student.class))
    );

    res.json(mergeStudentPhotos(filtered));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/staff-portal/session/scores', authenticateStaffPortal, async (req, res) => {
  try {
    if (String(req.staffPortal.role).toLowerCase() !== 'teacher') {
      return res.status(403).json({ error: 'Only teachers can manage scores here' });
    }

    const subject = String(req.query.subject || '').trim();
    const className = String(req.query.className || req.query.class || '').trim();
    const currentTerm = await resolveTeacherScoreTerm(req.staffPortal.schoolId);
    const term = currentTerm.name;

    let query = supabase
      .from('student_scores')
      .select('*')
      .eq('school_id', req.staffPortal.schoolId)
      .eq('staff_id', req.staffPortal.staffId)
      .eq('term', term);

    if (subject) query = query.eq('subject', subject);
    if (className) query = query.eq('class_name', className);

    const { data, error } = await query.order('updated_at', { ascending: false });
    if (error) {
      if (isMissingColumnError(error, 'student_scores') || error.code === '42P01') {
        return res.json({ scores: [], lock: { published: false, canEdit: true } });
      }
      throw error;
    }
    const lockState = await loadScoreLocks(req.staffPortal.schoolId);
    const lock = inspectScoreLock(lockState.locks, {
      term,
      className,
      staffId: req.staffPortal.staffId,
    });
    res.json({ scores: data || [], lock });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const SCORE_ATTITUDES = new Set(['Excellent', 'Good', 'Bad', 'Worse']);

const portalHttpError = (status, message) => {
  const err = new Error(message);
  err.status = status;
  return err;
};

const loadPortalStaff = async (req) => {
  const { data: staff, error } = await supabase
    .from('staffs')
    .select('*')
    .eq('id', req.staffPortal.staffId)
    .eq('school_id', req.staffPortal.schoolId)
    .maybeSingle();
  if (error) throw error;
  if (!staff) throw portalHttpError(404, 'Staff member not found');
  return staff;
};

const upsertStaffPortalScore = async ({ schoolId, staffId, staff, body }) => {
  const allowedSubjects = parseCsvList(staff.subjects);
  const allowedClasses = parseCsvList(staff.class_names);
  const subject = String(body.subject || '').trim();
  const studentId = body.studentId;
  const className = String(body.className || body.class || '').trim();
  const currentTerm = await resolveTeacherScoreTerm(schoolId);
  const term = currentTerm.name;
  const score = body.score === '' || body.score == null ? null : Number(body.score);
  const maxScore = body.maxScore === '' || body.maxScore == null ? 100 : Number(body.maxScore);
  const remark = body.remark?.trim?.() || null;
  const attitudeRaw = String(body.attitude || '').trim();
  const attitude = SCORE_ATTITUDES.has(attitudeRaw) ? attitudeRaw : null;

  if (!studentId || !subject) {
    throw portalHttpError(400, 'Student and subject are required');
  }
  if (allowedSubjects.length && !listsOverlap([subject], allowedSubjects)) {
    throw portalHttpError(403, 'You are not assigned to this subject');
  }

    const { data: student, error: studentError } = await supabase
      .from('students')
      .select('id, name, class, school_id')
      .eq('id', studentId)
      .eq('school_id', schoolId)
      .maybeSingle();
  if (studentError) throw studentError;
  if (!student) throw portalHttpError(404, 'Student not found');

  const studentClass = String(student.class || '').trim();
  if (allowedClasses.length && !listsOverlap([studentClass], allowedClasses)) {
    throw portalHttpError(403, 'Student is not in your assigned classes');
  }

  const lockState = await loadScoreLocks(schoolId);
  const lock = inspectScoreLock(lockState.locks, {
    term,
    className: className || studentClass,
    staffId,
  });
  if (lock.published && !lock.canEdit) {
    throw portalHttpError(
      403,
      'This report is published. Ask the administrator to allow you to edit.'
    );
  }

  const record = {
    school_id: schoolId,
    student_id: studentId,
    staff_id: staffId,
    subject,
    class_name: className || studentClass || null,
    term,
    score: Number.isFinite(score) ? score : null,
    max_score: Number.isFinite(maxScore) ? maxScore : 100,
    remark,
    attitude,
    updated_at: new Date().toISOString(),
  };

  const { data: existing } = await supabase
    .from('student_scores')
    .select('id')
    .eq('school_id', schoolId)
    .eq('student_id', studentId)
    .eq('subject', subject)
    .eq('term', term)
    .eq('staff_id', staffId)
    .maybeSingle();

  let saved;
  if (existing?.id) {
    let { data, error } = await supabase
      .from('student_scores')
      .update(record)
      .eq('id', existing.id)
      .select()
      .single();
    if (error && isMissingColumnError(error, 'attitude')) {
      const { attitude: _omit, ...withoutAttitude } = record;
      ({ data, error } = await supabase
        .from('student_scores')
        .update(withoutAttitude)
        .eq('id', existing.id)
        .select()
        .single());
    }
    if (error) throw error;
    saved = data;
  } else {
    let { data, error } = await supabase
      .from('student_scores')
      .insert([{ ...record, created_at: new Date().toISOString() }])
      .select()
      .single();
    if (error && isMissingColumnError(error, 'attitude')) {
      const { attitude: _omit, ...withoutAttitude } = record;
      ({ data, error } = await supabase
        .from('student_scores')
        .insert([{ ...withoutAttitude, created_at: new Date().toISOString() }])
        .select()
        .single());
    }
    if (error) {
      if (isMissingColumnError(error, 'student_scores') || error.code === '42P01') {
        throw portalHttpError(
          503,
          'Scores table is missing. Run backend/migrations/add_parent_teacher_portal.sql in Supabase.'
        );
      }
      throw error;
    }
    saved = data;
  }

  let promotion = null;
  try {
    promotion = await applyTermPromotion(schoolId, studentId, term);
  } catch (err) {
    console.warn('Term promotion check failed:', err.message || err);
  }

  return { saved, student, subject, className: className || studentClass, term, promotion };
};

app.post('/api/staff-portal/session/scores', authenticateStaffPortal, async (req, res) => {
  try {
    if (String(req.staffPortal.role).toLowerCase() !== 'teacher') {
      return res.status(403).json({ error: 'Only teachers can enter scores' });
    }

    const staff = await loadPortalStaff(req);
    const { saved, student, subject, className, term, promotion } = await upsertStaffPortalScore({
      schoolId: req.staffPortal.schoolId,
      staffId: req.staffPortal.staffId,
      staff,
      body: req.body || {},
    });

    bumpSchoolCaches(req.staffPortal.schoolId);
    recordPlatformEvent({
      eventType: 'staff_activity',
      schoolId: req.staffPortal.schoolId,
      email: staff.name,
      role: 'staff_portal',
      path: '/staff-portal',
      meta: {
        staffId: staff.id,
        staffName: staff.name,
        staffRole: staff.role,
        source: 'staff_portal',
        activity: `Saved ${subject} score for ${student.name || 'a student'}${
          className ? ` · ${className}` : ''
        } (${term})`,
        studentId: student.id,
        subject,
        className,
        term,
      },
    }).catch(() => {});
    res.json({ ...saved, promotion, student_name: student?.name, class_name: className, term });
  } catch (error) {
    const status = error.status || 500;
    if (status >= 500) console.error('Staff portal score save error:', error);
    res.status(status).json({ error: error.message || 'Failed to save score' });
  }
});

app.post('/api/staff-portal/session/scores/batch', authenticateStaffPortal, async (req, res) => {
  try {
    if (String(req.staffPortal.role).toLowerCase() !== 'teacher') {
      return res.status(403).json({ error: 'Only teachers can enter scores' });
    }

    const staff = await loadPortalStaff(req);
    const subject = String(req.body?.subject || '').trim();
    const className = String(req.body?.className || req.body?.class || '').trim();
    const term = String(req.body?.term || 'Term 1').trim() || 'Term 1';
    const entries = Array.isArray(req.body?.entries) ? req.body.entries : [];

    if (!subject) return res.status(400).json({ error: 'Subject is required' });
    if (!entries.length) return res.status(400).json({ error: 'Add at least one student score' });

    const saved = [];
    const failed = [];
    const promotions = { promoted: [], retained: [], pending: [], already: [] };
    for (const entry of entries) {
      try {
        const result = await upsertStaffPortalScore({
          schoolId: req.staffPortal.schoolId,
          staffId: req.staffPortal.staffId,
          staff,
          body: {
            ...entry,
            subject,
            className: entry.className || className,
            term,
          },
        });
        saved.push(result.saved);
        const promo = result.promotion;
        const name = result.student?.name || 'Student';
        if (promo?.action === 'promoted') {
          promotions.promoted.push({ name, nextClass: promo.nextClass, percent: promo.percent });
        } else if (promo?.action === 'retained') {
          promotions.retained.push({ name, percent: promo.percent });
        } else if (promo?.action === 'pending') {
          promotions.pending.push({ name });
        } else if (promo?.action === 'already') {
          promotions.already.push({ name, percent: promo.percent });
        }
      } catch (error) {
        failed.push({
          studentId: entry?.studentId,
          error: error.message || 'Failed to save score',
        });
      }
    }

    if (!saved.length) {
      return res.status(400).json({
        error: failed[0]?.error || 'Failed to save scores',
        failed,
      });
    }

    bumpSchoolCaches(req.staffPortal.schoolId);
    recordPlatformEvent({
      eventType: 'staff_activity',
      schoolId: req.staffPortal.schoolId,
      email: staff.name,
      role: 'staff_portal',
      path: '/staff-portal',
      meta: {
        staffId: staff.id,
        staffName: staff.name,
        staffRole: staff.role,
        source: 'staff_portal',
        activity: `Saved ${saved.length} ${subject} scores${className ? ` · ${className}` : ''} (${term})`,
        subject,
        className,
        term,
        savedCount: saved.length,
        failedCount: failed.length,
      },
    }).catch(() => {});

    const promoBits = [
      promotions.promoted.length ? `${promotions.promoted.length} promoted` : null,
      promotions.retained.length ? `${promotions.retained.length} retained` : null,
      promotions.pending.length ? `${promotions.pending.length} still waiting` : null,
    ].filter(Boolean);
    const savedLine =
      failed.length > 0
        ? `Saved ${saved.length} scores, ${failed.length} failed`
        : `Saved ${saved.length} scores`;

    res.json({
      saved: saved.length,
      failed,
      scores: saved,
      promotions,
      message: promoBits.length ? `${savedLine}. ${promoBits.join(', ')}.` : savedLine,
    });
  } catch (error) {
    const status = error.status || 500;
    if (status >= 500) console.error('Staff portal batch score save error:', error);
    res.status(status).json({ error: error.message || 'Failed to save scores' });
  }
});

registerStaffFeeRoutes(app, { authenticateStaffPortal });
registerStaffAdminRoutes(app, { authenticateStaffPortal });

// ============ REPORT CARDS (admin view of teacher-entered scores) ============

app.get('/api/report-cards/scores', authenticateToken, enforcePlanApproval, async (req, res) => {
  try {
    if (req.user.role === 'super_admin') {
      return res.status(400).json({ error: 'Use school admin account to view report cards' });
    }

    const schoolId = req.user.schoolId;
    const { page, limit, from, to } = parsePagination(req);
    const classFilter = String(req.query.class || req.query.className || '').trim();
    const subjectFilter = String(req.query.subject || '').trim();
    const termFilter = String(req.query.term || '').trim();
    const cacheKey = `reports:${schoolId}:${page}:${limit}:${classFilter}:${subjectFilter}:${termFilter}`;
    const cached = cacheGet(cacheKey);
    if (cached && String(req.query.refresh || '') !== '1') return res.json(cached);

    const { data: school } = await supabase.from('schools').select('*').eq('id', schoolId).maybeSingle();
    const merged = school ? mergeSchoolWithExtras(school) : null;
    if (merged && !hasPlanFeature(merged.payment_plan, 'report-cards')) {
      return res.status(403).json({ error: 'Report cards are not included in your plan' });
    }

    let scoreQuery = supabase
      .from('student_scores')
      .select('*', { count: 'exact' })
      .eq('school_id', schoolId)
      .order('updated_at', { ascending: false })
      .range(from, to);
    if (classFilter && classFilter !== 'all') scoreQuery = scoreQuery.eq('class_name', classFilter);
    if (subjectFilter && subjectFilter !== 'all') scoreQuery = scoreQuery.eq('subject', subjectFilter);
    if (termFilter && termFilter !== 'all') scoreQuery = scoreQuery.eq('term', termFilter);
    const { data: scores, error, count } = await scoreQuery;

    if (error) {
      if (isMissingColumnError(error, 'student_scores') || error.code === '42P01') {
        return res.json({ scores: [], note: 'No scores yet. Teachers enter scores in the staff portal.' });
      }
      throw error;
    }

    const rows = scores || [];
    const studentIds = [...new Set(rows.map((r) => r.student_id).filter(Boolean))];
    const staffIds = [...new Set(rows.map((r) => r.staff_id).filter(Boolean))];

    const [studentsRes, staffRes] = await Promise.all([
      studentIds.length
        ? supabase.from('students').select('id, name, class, roll_number').in('id', studentIds)
        : Promise.resolve({ data: [] }),
      staffIds.length
        ? supabase.from('staffs').select('id, name, role').in('id', staffIds)
        : Promise.resolve({ data: [] }),
    ]);

    const studentsById = new Map((studentsRes.data || []).map((s) => [s.id, s]));
    const staffById = new Map((staffRes.data || []).map((s) => [s.id, s]));

    const enriched = rows.map((row) => {
      const student = studentsById.get(row.student_id);
      const teacher = staffById.get(row.staff_id);
      const score = row.score == null ? null : Number(row.score);
      const maxScore = row.max_score == null ? 100 : Number(row.max_score);
      const percent =
        score != null && maxScore > 0 ? Math.round((score / maxScore) * 1000) / 10 : null;
      return {
        id: row.id,
        student_id: row.student_id,
        student_name: student?.name || 'Student',
        class_name: row.class_name || student?.class || '—',
        roll_number: student?.roll_number || null,
        subject: row.subject,
        term: row.term || 'Term 1',
        score,
        max_score: maxScore,
        percent,
        remark: row.remark || null,
        attitude: row.attitude || null,
        teacher_id: row.staff_id,
        teacher_name: teacher?.name || 'Teacher',
        updated_at: row.updated_at || row.created_at,
        created_at: row.created_at,
      };
    });

    const filterRows = await supabase
      .from('student_scores')
      .select('class_name, subject, term')
      .eq('school_id', schoolId)
      .limit(400);
    const payload = {
      scores: enriched,
      items: enriched,
      total: count || 0,
      page,
      limit,
      filters: {
        classes: [...new Set((filterRows.data || []).map((row) => row.class_name).filter(Boolean))].sort(),
        subjects: [...new Set((filterRows.data || []).map((row) => row.subject).filter(Boolean))].sort(),
        terms: [...new Set((filterRows.data || []).map((row) => row.term).filter(Boolean))].sort(),
      },
    };
    cacheSet(cacheKey, payload, REPORTS_TTL_MS);
    res.json(payload);
  } catch (error) {
    console.error('Report cards scores error:', error);
    res.status(500).json({ error: error.message || 'Failed to load report card scores' });
  }
});

app.delete('/api/report-cards/scores', authenticateToken, enforcePlanApproval, async (req, res) => {
  try {
    if (req.user.role === 'super_admin') {
      return res.status(400).json({ error: 'Use school admin account to manage report cards' });
    }

    const schoolId = req.user.schoolId;
    const { data: school } = await supabase.from('schools').select('*').eq('id', schoolId).maybeSingle();
    const merged = school ? mergeSchoolWithExtras(school) : null;
    if (merged && !hasPlanFeature(merged.payment_plan, 'report-cards')) {
      return res.status(403).json({ error: 'Report cards are not included in your plan' });
    }

    const { data, error } = await supabase
      .from('student_scores')
      .delete()
      .eq('school_id', schoolId)
      .select('id');

    if (error) {
      if (isMissingColumnError(error, 'student_scores') || error.code === '42P01') {
        return res.json({ deleted: 0, message: 'No teacher score entries to clear' });
      }
      throw error;
    }

    const deleted = Array.isArray(data) ? data.length : 0;
    bumpSchoolCaches(schoolId);
    res.json({
      deleted,
      message:
        deleted > 0
          ? `Cleared ${deleted} teacher score ${deleted === 1 ? 'entry' : 'entries'}`
          : 'No teacher score entries to clear',
    });
  } catch (error) {
    console.error('Report cards clear scores error:', error);
    res.status(500).json({ error: error.message || 'Failed to clear teacher score entries' });
  }
});

const readScannerDeviceId = (req) =>
  String(req.headers['x-device-id'] || req.body?.deviceId || req.query.deviceId || '').trim();

const assertScannerDevice = (schoolId, req, res) => {
  const deviceId = readScannerDeviceId(req);
  const slot = claimScannerSlot(schoolId, deviceId);
  if (!slot.allowed) {
    res.status(409).json({ error: slot.error });
    return null;
  }
  return slot;
};

// Public mobile scanner endpoints (token-based, no login)
app.get('/api/scanner/school/:token', async (req, res) => {
  try {
    const resolved = await resolveScannerSchool(req.params.token);
    if (!resolved) {
      return res.status(404).json({ error: 'Invalid or inactive scanner link' });
    }

    if (!assertScannerDevice(resolved.schoolId, req, res)) return;

    const lateAfterTime = await getSchoolLateAfterTime(resolved.schoolId);
    const window = describeScannerWindow(lateAfterTime);
    res.json({
      schoolName: resolved.schoolName,
      lateAfterTime: window.lateAfterTime,
      scannerOpensAt: window.opensAt,
      scannerClosesAt: window.closesAt,
      scannerOpen: window.open,
      scannerMessage: window.message,
      timezone: window.timezone,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/scanner/release/:token', async (req, res) => {
  try {
    const resolved = await resolveScannerSchool(req.params.token);
    if (resolved) releaseScannerSlot(resolved.schoolId, readScannerDeviceId(req));
    res.json({ ok: true });
  } catch {
    res.json({ ok: true });
  }
});

app.post('/api/scanner/mark/:token', async (req, res) => {
  try {
    const attendanceCode = getAttendanceCode(req.body);
    if (!attendanceCode) {
      return res.status(400).json({ error: 'QR code is required' });
    }

    const resolved = await resolveScannerSchool(req.params.token);
    if (!resolved) {
      return res.status(404).json({ error: 'Invalid or inactive scanner link' });
    }

    if (!assertScannerDevice(resolved.schoolId, req, res)) return;
    touchScannerSlot(resolved.schoolId, readScannerDeviceId(req));

    const result = await markAttendanceForSchool(resolved.schoolId, attendanceCode);
    res.json(result);
  } catch (error) {
    const status = error.status || 500;
    if (status >= 500) {
      console.error('Mobile scanner attendance error:', error);
    }
    res.status(status).json({ error: error.message, user: error.user || undefined });
  }
});

// Mark attendance (authenticated admin scanner)
app.post('/api/attendance/mark', authenticateToken, enforcePlanApproval, async (req, res) => {
  try {
    const attendanceCode = getAttendanceCode(req.body);
    if (!attendanceCode) {
      return res.status(400).json({ error: 'QR code is required' });
    }

    const result = await markAttendanceForSchool(req.user.schoolId, attendanceCode);
    res.json(result);
  } catch (error) {
    const status = error.status || 500;
    if (status >= 500) {
      console.error('Attendance marking error:', error);
    }
    res.status(status).json({ error: error.message, user: error.user || undefined });
  }
});

app.post('/api/attendance/absent-sms', authenticateToken, enforcePlanApproval, async (req, res) => {
  try {
    const { data: school } = await supabase
      .from('schools')
      .select('id, name')
      .eq('id', req.user.schoolId)
      .maybeSingle();
    const result = await sendAbsentParentSms({
      schoolId: req.user.schoolId,
      schoolName: school?.name || 'School',
      date: req.body?.date,
      confirmSmsPayment: Boolean(req.body?.confirmSmsPayment),
      senderName: req.user.staffPortal
        ? req.staffPortal?.staffName || 'Administrator'
        : req.user.email || 'Admin',
      senderRole: req.user.staffPortal ? 'Administrator' : 'Admin',
    });
    res.json(result);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({
        error: err.message,
        code: err.code || undefined,
        sms_billing: err.sms_billing,
        sms_delivery: err.sms_delivery,
      });
    }
    console.error('Absent parent SMS error:', err);
    res.status(500).json({ error: err.message || 'Failed to SMS absent-student parents' });
  }
});

// Get attendance records
app.get('/api/attendance', authenticateToken, enforcePlanApproval, async (req, res) => {
  try {
    const { date, type } = req.query;
    const today = schoolLocalDate();
    const selectedDate = /^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) ? date : today;
    const people = await loadSchoolPeopleForAttendance(req.user.schoolId);
    const lateAfterTimePromise = getSchoolLateAfterTime(req.user.schoolId);
    const attendancePromise = fetchAllQueryRows(() => {
      let query = supabase
        .from('attendance')
        .select('*')
        .eq('school_id', req.user.schoolId)
        .order('timestamp', { ascending: false });
      query = applyAttendanceDateFilter(query, selectedDate);
      if (type && type !== 'all') query = query.eq('user_type', type);
      return query;
    });

    const [attendance, lateAfterTime] = await Promise.all([attendancePromise, lateAfterTimePromise]);
    const dayRows = filterAttendanceForDate(attendance, selectedDate);
    const visibleAttendance = await pruneAttendanceBeforeEnrollment(
      req.user.schoolId,
      dayRows,
      people,
      { persist: false }
    );
    const enrichedAttendance = await enrichAttendanceRows(visibleAttendance, lateAfterTime);
    res.json(enrichedAttendance);

    void ensureUnscannedStudentsMarkedLate(req.user.schoolId, selectedDate, { people });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/attendance/person/:userId', authenticateToken, enforcePlanApproval, async (req, res) => {
  try {
    const userId = String(req.params.userId || '').trim();
    const userType = normalizeAttendanceUserType(req.query.userType || req.query.user_type || 'student');
    if (!userId) return res.status(400).json({ error: 'Person is required' });

    const period = await resolveFeePeriod(req.user.schoolId).catch(() => null);
    const today = schoolLocalDate();
    const { from, to } = attendanceWindow(period, today);

    const people = await loadSchoolPeopleForAttendance(req.user.schoolId);
    const person = people.find((row) => row.id === userId && row.user_type === userType);
    const startOn = firstAttendanceDate(person?.created_at);
    const rangeFrom = startOn && startOn > from ? startOn : from;
    const fillKey = `att-person-fill:${req.user.schoolId}:${userId}:${userType}:${rangeFrom}:${to}`;
    if (!cacheGet(fillKey)) {
      await fillPersonTermLateDays(req.user.schoolId, userId, userType, rangeFrom, to);
      cacheSet(fillKey, 1, 120000);
    }

    const data = await fetchAllQueryRows(() =>
      supabase
        .from('attendance')
        .select('*')
        .eq('school_id', req.user.schoolId)
        .eq('user_id', userId)
        .eq('user_type', userType)
        .gte('date', rangeFrom)
        .lte('date', to)
        .order('date', { ascending: true })
        .order('timestamp', { ascending: true })
    );

    const lateAfterTime = await getSchoolLateAfterTime(req.user.schoolId);
    const records = await enrichAttendanceRows(data || [], lateAfterTime);
    const lateDays = records.filter((row) => row.status === 'late' || row.punctuality === 'late').length;
    const absentDays = records.filter((row) => row.status === 'absent' || row.punctuality === 'absent').length;
    const earlyDays = records.length - lateDays - absentDays;

    res.json({
      user_id: userId,
      user_type: userType,
      term: {
        name: period?.name || null,
        starts_on: from,
        ends_on: to,
        source: period?.source || null,
      },
      records,
      summary: {
        days: records.length,
        early: earlyDays,
        late: lateDays,
        absent: absentDays,
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/attendance/person/:userId', authenticateToken, enforcePlanApproval, async (req, res) => {
  try {
    const userId = String(req.params.userId || '').trim();
    const userType = normalizeAttendanceUserType(req.query.userType || req.query.user_type || 'student');
    if (!userId) return res.status(400).json({ error: 'Person is required' });

    const { error, count } = await supabase
      .from('attendance')
      .delete({ count: 'exact' })
      .eq('school_id', req.user.schoolId)
      .eq('user_id', userId)
      .eq('user_type', userType);
    if (error) throw error;

    bumpSchoolCaches(req.user.schoolId);
    res.json({ ok: true, deleted: count || 0, user_id: userId, user_type: userType });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to delete attendance' });
  }
});

app.delete('/api/attendance/students', authenticateToken, enforcePlanApproval, async (req, res) => {
  try {
    const { error, count } = await supabase
      .from('attendance')
      .delete({ count: 'exact' })
      .eq('school_id', req.user.schoolId)
      .eq('user_type', 'student');
    if (error) throw error;

    bumpSchoolCaches(req.user.schoolId);
    res.json({ ok: true, deleted: count || 0 });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to delete student attendance' });
  }
});

app.get('/api/attendance/export/students', authenticateToken, enforcePlanApproval, async (req, res) => {
  try {
    const requestedType = String(req.query.type || 'student').trim().toLowerCase();
    const peopleType =
      requestedType === 'staff'
        ? 'staff'
        : requestedType === 'non-staff' || requestedType === 'nonstaff' || requestedType === 'non_staff'
          ? 'non-staff'
          : requestedType === 'all'
            ? 'all'
            : 'student';
    const period = await resolveFeePeriod(req.user.schoolId).catch(() => null);
    const today = schoolLocalDate();
    const { from, to } = attendanceWindow(period, today);
    const lateAfterTime = await getSchoolLateAfterTime(req.user.schoolId);

    const { page, limit, from: pageFrom, to: pageTo } = parsePagination(req);
    const exportAll =
      req.query.all === '1' || req.query.all === 'true' || String(req.query.limit) === 'all';
    const people = await loadSchoolPeopleForAttendance(req.user.schoolId);
    const wanted = people.filter((person) => peopleType === 'all' || person.user_type === peopleType);

    const term = {
      name: period?.name || null,
      starts_on: from,
      ends_on: to,
      source: period?.source || null,
    };

    const classFilter = String(req.query.class || req.query.className || '').trim().toLowerCase();
    const search = String(req.query.q || '').trim().toLowerCase();
    const filtered = wanted.filter((person) => {
      if (classFilter && String(person.label || '').trim().toLowerCase() !== classFilter) return false;
      if (search) {
        const hay = [person.name, person.id, person.roll_number, person.label]
          .map((value) => String(value || '').trim().toLowerCase())
          .join(' ');
        if (!hay.includes(search)) return false;
      }
      return true;
    });
    const pagePeople = exportAll ? filtered : filtered.slice(pageFrom, pageTo + 1);
    const pageIds = pagePeople.map((person) => person.id);

    await fillSchoolTermAttendance(req.user.schoolId, from, to, pagePeople);

    const attendanceRows = [];
    for (let i = 0; i < pageIds.length; i += 80) {
      const ids = pageIds.slice(i, i + 80);
      const chunk = await fetchAllQueryRows(() => {
        let query = supabase
          .from('attendance')
          .select('user_id, user_type, date, timestamp, status')
          .eq('school_id', req.user.schoolId)
          .gte('date', from)
          .lte('date', to)
          .order('date', { ascending: true });
        if (peopleType !== 'all') query = query.eq('user_type', peopleType);
        return query.in('user_id', ids);
      });
      attendanceRows.push(...chunk);
    }
    const schoolRes = await supabase.from('schools').select('name').eq('id', req.user.schoolId).maybeSingle();

    const byPerson = new Map();
    for (const row of attendanceRows) {
      const punctuality =
        row.status === 'absent' || row.status === 'early' || row.status === 'late'
          ? row.status
          : getAttendancePunctuality(row.timestamp, lateAfterTime);
      const list = byPerson.get(row.user_id) || [];
      list.push({
        date: row.date,
        timestamp: row.timestamp,
        punctuality,
        status: punctuality,
      });
      byPerson.set(row.user_id, list);
    }

    const mapped = pagePeople.map((person) => {
      const records = byPerson.get(person.id) || [];
      const lateDays = records.filter((row) => row.status === 'late' || row.punctuality === 'late').length;
      const absentDays = records.filter((row) => row.status === 'absent' || row.punctuality === 'absent').length;
      return {
        id: person.id,
        name: person.name,
        class: person.label || null,
        label: person.label || null,
        roll_number: person.roll_number || null,
        user_type: person.user_type,
        records,
        summary: {
          days: records.length,
          early: records.length - lateDays - absentDays,
          late: lateDays,
          absent: absentDays,
        },
      };
    });

    res.json({
      school_name: schoolRes.data?.name || null,
      term,
      type: peopleType,
      people: mapped,
      students: mapped,
      items: mapped,
      total: filtered.length,
      page,
      limit,
    });
  } catch (error) {
    console.error('Student attendance export error:', error);
    res.status(500).json({ error: error.message || 'Failed to export attendance' });
  }
});

app.get('/api/attendance/settings', authenticateToken, enforcePlanApproval, async (req, res) => {
  try {
    const lateAfterTime = await getSchoolLateAfterTime(req.user.schoolId);
    const window = describeScannerWindow(lateAfterTime);
    res.json({
      lateAfterTime,
      timezone: ATTENDANCE_TIMEZONE,
      scannerOpensAt: window.opensAt,
      scannerClosesAt: window.closesAt,
      scannerOpen: window.open,
      scannerMessage: window.message,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/attendance/settings', authenticateToken, enforcePlanApproval, async (req, res) => {
  try {
    const lateAfterTime = normalizeLateAfterTime(req.body.lateAfterTime || req.body.late_after_time);
    await upsertSchoolExtras(req.user.schoolId, { late_after_time: lateAfterTime }, { requirePersist: true });
    const window = describeScannerWindow(lateAfterTime);
    res.json({
      lateAfterTime,
      timezone: ATTENDANCE_TIMEZONE,
      scannerOpensAt: window.opensAt,
      scannerClosesAt: window.closesAt,
      scannerOpen: window.open,
      scannerMessage: window.message,
    });
  } catch (error) {
    console.error('Attendance settings error:', error);
    res.status(500).json({ error: error.message || 'Failed to save late time setting' });
  }
});

// Get attendance summary for today
app.get('/api/attendance/summary', authenticateToken, enforcePlanApproval, async (req, res) => {
  try {
    const today = schoolLocalDate();
    const requestedDate = req.query.date || today;
    const selectedDate = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) ? requestedDate : today;
    const filled = await ensureUnscannedStudentsMarkedLate(req.user.schoolId, selectedDate);
    const cacheKey = `att-sum:${req.user.schoolId}:${selectedDate}`;
    const cached = cacheGet(cacheKey);
    if (cached && !filled) return res.json(cached);

    const [students, staff, nonStaff, attendanceRows] = await Promise.all([
      supabase.from('students').select('id', { count: 'exact', head: true }).eq('school_id', req.user.schoolId),
      supabase.from('staffs').select('id', { count: 'exact', head: true }).eq('school_id', req.user.schoolId),
      supabase.from('nonstaffs').select('id', { count: 'exact', head: true }).eq('school_id', req.user.schoolId),
      fetchAllQueryRows(() =>
        supabase.from('attendance').select('user_type').eq('school_id', req.user.schoolId).eq('date', selectedDate)
      ),
    ]);

    const payload = buildAttendanceSummaryPayload(
      selectedDate,
      {
        students: students.count || 0,
        staff: staff.count || 0,
        nonStaff: nonStaff.count || 0,
      },
      attendanceRows
    );
    cacheSet(cacheKey, payload, DASHBOARD_TTL_MS);
    res.json(payload);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ MESSAGES ROUTES ============

// Get messages for a school
app.get('/api/messages', authenticateToken, enforcePlanApproval, async (req, res) => {
  try {
    const { data: messages, error } = await supabase
      .from('messages')
      .select('*')
      .eq('school_id', req.user.schoolId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(messages);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Send message with SMS or email based on plan
app.post('/api/messages', authenticateToken, enforcePlanApproval, async (req, res) => {
  try {
    const {
      senderName,
      senderRole,
      sendMode,
      recipients,
      individualRole,
      recipientEmail,
      recipientPhone,
      message,
      deliveryChannel = 'sms',
      confirmSmsPayment = false,
    } = req.body;

    const { data: schoolAccount, error: schoolError } = await supabase
      .from('schools')
      .select('id, name, payment_plan')
      .eq('id', req.user.schoolId)
      .single();

    if (schoolError || !schoolAccount) {
      return res.status(403).json({ error: 'School account not found' });
    }

    const planId = schoolAccount.payment_plan;
    const channel = deliveryChannel === 'email' ? 'email' : 'sms';

    if (channel === 'sms' && !hasPlanFeature(planId, 'messages-sms')) {
      return res.status(403).json({ error: 'Bulk SMS is not included in your plan' });
    }
    if (channel === 'email' && !hasPlanFeature(planId, 'messages-email')) {
      return res.status(403).json({ error: 'Bulk email is not included in your plan. Choose a paid Small, Mid, or Large school plan.' });
    }

    let smsSettlement = null;
    let smsDelivery = null;
    if (channel === 'sms') {
      if (!confirmSmsPayment) {
        return res.status(400).json({
          error: 'Confirm SMS send first. You need enough prepaid school SMS units (convert from School Wallet).',
          code: 'SMS_CONFIRM_REQUIRED',
        });
      }
      try {
        smsSettlement = await settleSmsPayment({
          supabase,
          schoolId: req.user.schoolId,
          schoolName: schoolAccount.name,
          message,
          sendMode,
          recipients,
          recipientPhone,
        });
      } catch (settleErr) {
        const status = settleErr.status || 500;
        return res.status(status).json({
          error: settleErr.message || 'SMS payment failed',
          code: settleErr.code || 'SMS_PAYMENT_FAILED',
        });
      }

      try {
        smsDelivery = await sendSmsBatch({
          phones: smsSettlement.phones,
          body: message,
          schoolName: schoolAccount.name,
        });

        const segments = smsSettlement.quote?.segments || 1;
        const failedUnits = (smsDelivery.failed || 0) * segments;
        if (failedUnits > 0) {
          try {
            const refund = await refundSchoolAndPlatformUnits({
              schoolId: req.user.schoolId,
              schoolName: schoolAccount.name,
              units: failedUnits,
              reference: smsSettlement.reference,
              reason: `Refund for ${smsDelivery.failed} failed SMS delivery(ies)`,
            });
            smsSettlement.school_sms_units = refund.school_balance.units_available;
            smsSettlement.refunded_units = refund.refunded_units;
          } catch (refundErr) {
            console.error('SMS refund failed:', refundErr.message || refundErr);
          }
        }

        if (smsDelivery.sent === 0 && smsDelivery.failed > 0) {
          recordPlatformEvent({
            eventType: 'sms_failed',
            schoolId: req.user.schoolId,
            schoolName: schoolAccount.name,
            email: req.user.email,
            role: req.user.role,
            path: '/messages',
            meta: {
              failed: smsDelivery.failed,
              reason: 'delivery_failed',
              errors: smsDelivery.results
                .filter((r) => !r.ok)
                .slice(0, 3)
                .map((r) => r.error)
                .filter(Boolean),
            },
          }).catch(() => {});
          return res.status(502).json({
            error: 'SMS provider could not deliver to any recipient. Units were refunded where possible.',
            code: 'SMS_DELIVERY_FAILED',
            sms_billing: smsSettlement,
            sms_delivery: {
              sent: smsDelivery.sent,
              failed: smsDelivery.failed,
              total: smsDelivery.total,
              dryRun: smsDelivery.dryRun,
              sample_errors: smsDelivery.results
                .filter((r) => !r.ok)
                .slice(0, 3)
                .map((r) => r.error),
            },
          });
        }
      } catch (sendErr) {
        // Full failure after settlement — refund all units
        const refundUnits = smsSettlement.quote?.units_required || 0;
        try {
          if (refundUnits > 0) {
            await refundSchoolAndPlatformUnits({
              schoolId: req.user.schoolId,
              schoolName: schoolAccount.name,
              units: refundUnits,
              reference: smsSettlement.reference,
              reason: sendErr.message || 'SMS provider error refund',
            });
          }
        } catch (refundErr) {
          console.error('SMS full refund failed:', refundErr.message || refundErr);
        }
        const status = sendErr.status || 502;
        recordPlatformEvent({
          eventType: 'sms_failed',
          schoolId: req.user.schoolId,
          schoolName: schoolAccount.name,
          email: req.user.email,
          role: req.user.role,
          path: '/messages',
          meta: {
            reason: 'provider_error',
            message: sendErr.message || 'SMS delivery failed',
          },
        }).catch(() => {});
        return res.status(status).json({
          error: sendErr.message || 'SMS delivery failed',
          code: sendErr.code || 'SMS_DELIVERY_FAILED',
        });
      }
    }

    const messageRecord = {
      school_id: req.user.schoolId,
      sender_name: senderName,
      sender_role: senderRole || 'Admin',
      send_mode: sendMode || 'Group',
      recipients: recipients || 'Parents',
      individual_role: individualRole,
      recipient_email: channel === 'email' ? recipientEmail : null,
      message,
      delivery_channel: channel,
      created_at: new Date(),
    };

    let newMessage;
    const { data: insertedMessage, error } = await supabase
      .from('messages')
      .insert([messageRecord])
      .select()
      .single();

    if (error && error.message?.includes('delivery_channel')) {
      const { delivery_channel, ...fallbackRecord } = messageRecord;
      const retry = await supabase.from('messages').insert([fallbackRecord]).select().single();
      if (retry.error) throw retry.error;
      newMessage = retry.data;
    } else if (error) {
      throw error;
    } else {
      newMessage = insertedMessage;
    }

    if (channel === 'sms' && smsDelivery?.sent > 0) {
      recordPlatformEvent({
        eventType: 'sms_sent',
        schoolId: req.user.schoolId,
        schoolName: schoolAccount.name,
        email: req.user.email,
        role: req.user.role,
        path: '/messages',
        meta: {
          count: smsDelivery.sent,
          delivered: smsDelivery.sent,
          failed: smsDelivery.failed || 0,
        },
      }).catch(() => {});
    }

    if (channel === 'sms' && smsDelivery?.failed > 0 && smsDelivery?.sent > 0) {
      recordPlatformEvent({
        eventType: 'sms_failed',
        schoolId: req.user.schoolId,
        schoolName: schoolAccount.name,
        email: req.user.email,
        role: req.user.role,
        path: '/messages',
        meta: {
          failed: smsDelivery.failed,
          reason: 'partial_delivery',
          errors: (smsDelivery.results || [])
            .filter((r) => !r.ok)
            .slice(0, 3)
            .map((r) => r.error)
            .filter(Boolean),
        },
      }).catch(() => {});
    }

    if (channel === 'email' && emailReady && emailTransporter) {
      const emailList = [];
      const defaultBroadcastEmail = process.env.BROADCAST_EMAIL || process.env.EMAIL_USER;

      if (sendMode === 'Individual' && recipientEmail) {
        emailList.push(recipientEmail);
      } else if (recipients === 'Parents') {
        emailList.push(process.env.PARENTS_EMAIL || defaultBroadcastEmail);
      } else if (recipients === 'Teachers') {
        emailList.push(process.env.TEACHERS_EMAIL || defaultBroadcastEmail);
      } else if (recipients === 'Staff') {
        emailList.push(process.env.STAFF_EMAIL || defaultBroadcastEmail);
      } else {
        emailList.push(defaultBroadcastEmail);
      }

      const validEmails = emailList.filter(Boolean);
      for (const toEmail of validEmails) {
        try {
          await emailTransporter.sendMail({
            from: getEmailUser(),
            to: toEmail,
            subject: `Message from ${escapeHtml(senderName)} (${escapeHtml(senderRole || 'Admin')})`,
            html: `
              <div style="font-family: Arial, sans-serif; padding: 20px; background-color: #f5f5f5;">
                <div style="background-color: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                  <h2 style="color: #333; margin-top: 0;">New Message from School</h2>
                  <p><strong>From:</strong> ${escapeHtml(senderName)} (${escapeHtml(senderRole || 'Admin')})</p>
                  <p><strong>Recipient Group:</strong> ${escapeHtml(recipients || 'Direct Message')}</p>
                  <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
                  <div style="color: #555; line-height: 1.6;">
                    ${escapeHtml(message).replace(/\n/g, '<br>')}
                  </div>
                  <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
                  <p style="color: #999; font-size: 12px; margin-bottom: 0;">This is an automated message from SCHOOLTYPE</p>
                </div>
              </div>
            `,
            text: message,
          });
          console.log(`Email sent to ${toEmail}`);
        } catch (emailError) {
          console.error(`Failed to send email to ${toEmail}:`, emailError.message);
        }
      }
    } else if (!emailTransporter) {
      console.debug('Email transporter not configured. Skipping email delivery.');
    }

    res.json({
      ...newMessage,
      sms_billing: smsSettlement
        ? {
            reference: smsSettlement.reference,
            quote: smsSettlement.quote,
            school_sms_units: smsSettlement.school_sms_units,
            refunded_units: smsSettlement.refunded_units || 0,
          }
        : undefined,
      sms_delivery: smsDelivery
        ? {
            sent: smsDelivery.sent,
            failed: smsDelivery.failed,
            total: smsDelivery.total,
            dryRun: smsDelivery.dryRun,
            provider: getSmsProviderStatus().mode,
          }
        : undefined,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ DASHBOARD STATS ============

app.get('/api/dashboard/stats', authenticateToken, async (req, res) => {
  try {
    const today = schoolLocalDate();
    const requestedDate = req.query.date || today;
    const selectedDate = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) ? requestedDate : today;
    const filled = await ensureUnscannedStudentsMarkedLate(req.user.schoolId, selectedDate);
    const cacheKey = `dash:${req.user.schoolId}:${selectedDate}`;
    const cached = cacheGet(cacheKey);
    if (cached && !filled) return res.json(cached);

    if (req.user.role !== 'super_admin') {
      const { data: schoolAccount } = await selectSchoolById(req.user.schoolId, SCHOOL_PLAN_COLUMNS);
      const merged = mergeSchoolWithExtras(schoolAccount);

      if (!merged?.payment_plan || (merged.plan_status || 'pending') !== 'approved') {
        return res.json({
          totalStudents: 0,
          totalStaff: 0,
          totalNonStaff: 0,
          unreadMessages: 0,
          todayAttendance: 0,
          totalRevenue: 0,
          feesPaid: 0,
          unpaidRevenue: 0,
          yearCollected: 0,
          billedStudents: 0,
          paidStudents: 0,
          unpaidStudents: 0,
          totalClasses: 0,
          walletBalance: 0,
          smsUnits: 0,
          reportCards: 0,
          feePeriodLabel: null,
          planPending: true,
          attendance: null,
        });
      }
    }

    const schoolId = req.user.schoolId;
    const attendanceFor = (userType) =>
      supabase
        .from('attendance')
        .select('id', { count: 'exact', head: true })
        .eq('school_id', schoolId)
        .eq('date', selectedDate)
        .eq('user_type', userType);

    const settle = async (promise, fallback) => {
      try {
        return await promise;
      } catch {
        return fallback;
      }
    };

    const [students, staff, nonStaff, messages, attStudents, attStaff, attNonStaff, classes, reportCards, feeGlance, wallet, sms] =
      await Promise.all([
        (async () => {
          const first = await supabase
            .from('students')
            .select('id', { count: 'exact', head: true })
            .eq('school_id', schoolId)
            .is('alumni_year', null);
          if (!first.error) return first;
          return supabase.from('students').select('id', { count: 'exact', head: true }).eq('school_id', schoolId);
        })(),
        supabase.from('staffs').select('id', { count: 'exact', head: true }).eq('school_id', schoolId),
        supabase.from('nonstaffs').select('id', { count: 'exact', head: true }).eq('school_id', schoolId),
        supabase
          .from('messages')
          .select('id', { count: 'exact', head: true })
          .eq('school_id', schoolId)
          .is('reply', null),
        attendanceFor('student'),
        attendanceFor('staff'),
        attendanceFor('non-staff'),
        supabase.from('classes').select('id', { count: 'exact', head: true }).eq('school_id', schoolId),
        supabase.from('report_cards').select('id', { count: 'exact', head: true }).eq('school_id', schoolId),
        (async () => {
          const feeKey = `fee-dash:${schoolId}`;
          const cachedFees = cacheGet(feeKey);
          if (cachedFees) return cachedFees;
          const payload = await settle(getFeeOverviewPayload(schoolId), null);
          if (payload) cacheSet(feeKey, payload, 2 * 60 * 1000);
          return payload;
        })(),
        settle(getWallet(schoolId), null),
        settle(getSchoolSmsBalance(schoolId), null),
      ]);

    const totals = {
      students: students.count || 0,
      staff: staff.count || 0,
      nonStaff: nonStaff.count || 0,
    };
    const presentStudents = attStudents.count || 0;
    const presentStaff = attStaff.count || 0;
    const presentNonStaff = attNonStaff.count || 0;
    const attendanceSummary = {
      date: selectedDate,
      students: {
        total: totals.students,
        present: presentStudents,
        percentage: percentPresent(presentStudents, totals.students),
      },
      staff: {
        total: totals.staff,
        present: presentStaff,
        percentage: percentPresent(presentStaff, totals.staff),
      },
      nonStaff: {
        total: totals.nonStaff,
        present: presentNonStaff,
        percentage: percentPresent(presentNonStaff, totals.nonStaff),
      },
    };
    cacheSet(`att-sum:${schoolId}:${selectedDate}`, attendanceSummary, DASHBOARD_TTL_MS);

    const feeTotals = feeGlance?.totals || {};
    const feesPaid = Number(feeTotals.paid_amount) || 0;
    const unpaidRevenue = Number(feeTotals.unpaid_amount) || 0;
    const payload = {
      totalStudents: totals.students,
      totalStaff: totals.staff,
      totalNonStaff: totals.nonStaff,
      unreadMessages: messages.count || 0,
      todayAttendance: presentStudents + presentStaff + presentNonStaff,
      attendance: attendanceSummary,
      totalRevenue: feesPaid + unpaidRevenue,
      feesPaid,
      unpaidRevenue,
      yearCollected: Number(feeTotals.year_collected) || 0,
      billedStudents: Number(feeTotals.billed) || 0,
      paidStudents: Number(feeTotals.paid) || 0,
      unpaidStudents: Number(feeTotals.unpaid) || 0,
      totalClasses: classes.count || 0,
      walletBalance: fromMinorUnits(wallet?.available_balance) || 0,
      smsUnits: Number(sms?.units_available) || 0,
      reportCards: reportCards.error ? 0 : reportCards.count || 0,
      feePeriodLabel: feeGlance?.term_name || feeGlance?.period_label || feeGlance?.month || null,
    };
    cacheSet(cacheKey, payload, DASHBOARD_TTL_MS);
    res.json(payload);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/dashboard/analytics', authenticateToken, enforcePlanApproval, async (req, res) => {
  try {
    const range = String(req.query.range || '1w');
    const cacheKey = `analytics:${req.user.schoolId}:${range}`;
    const cached = cacheGet(cacheKey);
    if (cached) return res.json(cached);
    const analytics = await getSchoolAnalytics(req.user.schoolId, { range });
    cacheSet(cacheKey, analytics, 45 * 1000);
    res.json(analytics);
  } catch (error) {
    console.error('School analytics error:', error);
    res.status(500).json({ error: error.message || 'Failed to load school analytics' });
  }
});

// Simple DB connectivity check before starting the server
const PORT = process.env.PORT || 5000;

async function seedSuperAdmin() {
  if (process.env.SEED_SUPER_ADMIN !== 'true') {
    return;
  }

  if (IS_PRODUCTION && !process.env.DEV_SUPER_ADMIN_PASSWORD) {
    console.warn('Skipping super admin seed in production: set DEV_SUPER_ADMIN_PASSWORD explicitly.');
    return;
  }

  const email = (process.env.DEV_SUPER_ADMIN_EMAIL || 'superadmin@school.com').trim().toLowerCase();
  const password = process.env.DEV_SUPER_ADMIN_PASSWORD || 'SuperAdmin123!';
  const name = process.env.DEV_SUPER_ADMIN_NAME || 'Super Admin';

  if (IS_PRODUCTION && password === 'SuperAdmin123!') {
    console.warn('Skipping super admin seed: default password is not allowed in production.');
    return;
  }

  try {
    const existing = await findSchoolByEmail(email);

    // Skip bcrypt work only when the account already matches env credentials.
    // (Previously we returned early for any super_admin row, so a drifted
    // password_hash left the login page hint permanently wrong.)
    if (existing && getSchoolRole(existing) === 'super_admin') {
      let passwordMatches = false;
      try {
        passwordMatches = Boolean(
          existing.password_hash && (await bcrypt.compare(password, existing.password_hash))
        );
      } catch {
        passwordMatches = false;
      }
      if (
        passwordMatches &&
        existing.role === 'super_admin' &&
        !existing.initial_password &&
        (!name || existing.name === name)
      ) {
        return;
      }
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const syncUpdates = {
      name,
      email,
      password_hash: hashedPassword,
      initial_password: null,
      role: 'super_admin',
      email_verified: true,
      email_verification_token: null,
      email_verification_expires_at: null,
    };

    if (existing) {
      const { error: updateError } = await updateSchoolRecord(existing.id, syncUpdates);
      if (updateError) {
        console.error('Failed to sync super admin:', updateError.message);
        return;
      }

      console.log('Dev super admin credentials synced');
      console.log(`  Email: ${email}`);
      return;
    }

    const { error: insertError } = await insertSchoolRecord({
      ...syncUpdates,
      created_at: new Date(),
    });

    if (insertError) {
      console.error('Failed to seed super admin:', insertError.message);
      return;
    }

    console.log('Dev super admin account created');
    console.log(`  Email: ${email}`);
  } catch (err) {
    console.error('Super admin seed error:', err.message);
  }
}

async function initializeDatabase() {
  try {
    if (IS_PRODUCTION && JWT_SECRET_IS_WEAK) {
      console.error(
        'Database setup failed: JWT_SECRET must be set to a strong value (32+ characters) in production.'
      );
      return false;
    }

    if (!supabase) {
      console.error(
        'Database setup failed: Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY).'
      );
      return false;
    }

    await syncJwtClock();
    const profileCols = await ensureStudentProfileColumns();
    if (profileCols.ok) {
      console.log('Student gender and extra charges columns are ready');
    } else if (profileCols.error) {
      console.warn('Could not add student gender/extra charges columns:', profileCols.error.message);
    }

    // Perform a lightweight test query to verify Supabase connectivity.
    const { data, error } = await supabase.from('schools').select('id').limit(1);
    if (error) {
      console.error('Database setup failed:', error.message || error);
      return false;
    }
    console.log('Database setup complete');
    try {
      await initSchoolPlanStore();
      console.log('School plan store ready (Supabase)');
    } catch (planErr) {
      console.warn('School plan store init skipped:', planErr.message || planErr);
    }

    const warmOptionalStores = async () => {
      try {
        const planSchema = await checkPlanSchemaReady();
        if (!planSchema.ready) {
          console.warn(
            `Plan/approval columns missing or unreadable on schools (${planSchema.error?.message || 'unknown'}). ${PLAN_SCHEMA_HELP}`
          );
        }

        if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
          console.warn(
            'SUPABASE_SERVICE_ROLE_KEY is not set — using anon key. Super-admin school lists and plan writes may fail if RLS is enabled. Prefer the service role key, or run database/supabase_backend_access.sql.'
          );
        }

        await initStudentPhotoStore();
        await initAuthSecurityStore();
        await initPlatformTelemetry();
        try {
          await initSchoolWalletStore();
        } catch (walletErr) {
          console.warn('School wallet store unavailable:', walletErr.message || walletErr);
          console.warn('Run database/supabase_core_billing.sql in Supabase if you want cloud wallets.');
        }
        try {
          await initPlatformSmsStore();
        } catch (smsErr) {
          console.warn('Platform SMS store unavailable:', smsErr.message || smsErr);
          console.warn('Run database/supabase_core_billing.sql in Supabase if you want cloud SMS billing.');
        }
        try {
          let baselineMinor = 0;
          try {
            baselineMinor = await getRecordedSubscriptionRevenueMinor();
          } catch (baselineErr) {
            console.warn('Demo reset baseline skipped:', baselineErr.message || baselineErr);
          }
          const claimed = await claimDemoMoneyReset(baselineMinor);
          if (claimed) {
            await resetSmsInventoryToZero();
            console.log('Cleared demo SMS units');
          }
        } catch (demoErr) {
          console.warn('Demo money reset skipped:', demoErr.message || demoErr);
        }
        try {
          await rebuildPlatformRevenueLedger();
        } catch (ledgerErr) {
          console.warn('Platform ledger rebuild skipped:', ledgerErr.message || ledgerErr);
        }
        await seedSuperAdmin();
      } catch (err) {
        console.warn('Background store init failed:', err.message || err);
      }
    };

    if (process.env.VERCEL) {
      void warmOptionalStores();
    } else {
      await warmOptionalStores();
    }
    return true;
  } catch (err) {
    console.error('Database setup failed:', err.message || err);
    if (String(err.message || '').includes('supabase_core_billing.sql')) {
      console.error('\nApply database/supabase_core_billing.sql in the Supabase SQL editor, then restart.\n');
    }
    return false;
  }
}

export const ready = initializeDatabase();

export { app };
export default app;

// ============ PLATFORM NOTIFICATIONS + CRON ============

const requireCronSecret = (req, res, next) => {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    // The daily job also runs inside this process. The HTTP route stays locked in production.
    if (isProduction()) {
      return res.status(503).json({ error: 'CRON_SECRET is not configured' });
    }
    return next();
  }
  const provided = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (provided !== expected) {
    return res.status(401).json({ error: 'Unauthorized cron request' });
  }
  return next();
};

app.get('/api/cron/subscription-reminders', requireCronSecret, async (req, res) => {
  try {
    const result = await runSubscriptionDueReminders({
      sendEmail: async ({ to, subject, text, html }) =>
        sendAuthEmail({ to, subject, text, html }),
    });
    res.json({ ok: true, ...result });
  } catch (error) {
    console.error('Subscription reminder cron error:', error);
    res.status(500).json({ error: 'Reminder job failed' });
  }
});

app.get('/api/notifications', authenticateToken, async (req, res) => {
  try {
    if (req.user.role === 'super_admin') {
      const [items, unread] = await Promise.all([
        listSuperAdminNotificationThreads({ limit: 200 }),
        countUnreadSuperAdminNotifications(),
      ]);
      return res.json({ items, unread });
    }
    const [items, unread] = await Promise.all([
      listSchoolNotifications(req.user.schoolId),
      countUnreadSchoolNotifications(req.user.schoolId),
    ]);
    res.json({ items, unread });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

app.get('/api/notifications/schools', authenticateToken, async (req, res) => {
  try {
    if (req.user.role === 'super_admin') {
      const { data, error } = await supabase
        .from('schools')
        .select('id, name, email, role')
        .neq('role', 'super_admin')
        .order('name');
      if (error) throw error;
      return res.json(data || []);
    }
    const schools = await listPeerSchools(req.user.schoolId);
    res.json(schools);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/notifications/compose', authenticateToken, async (req, res) => {
  try {
    if (req.user.role === 'super_admin') {
      return res.status(403).json({ error: 'Use the platform compose endpoint' });
    }

    const fromSchoolId = req.user.schoolId;
    const requested = Array.isArray(req.body.schoolIds) ? req.body.schoolIds : [];
    const uniqueIds = [...new Set(requested.map((id) => String(id || '').trim()).filter(Boolean))].filter(
      (id) => id !== fromSchoolId
    );
    if (!uniqueIds.length) {
      return res.status(400).json({ error: 'Select at least one school' });
    }
    if (!String(req.body.body || '').trim()) {
      return res.status(400).json({ error: 'Message body is required' });
    }

    const peers = await listPeerSchools(fromSchoolId);
    const allowed = new Set(peers.map((school) => school.id));
    const targets = uniqueIds.filter((id) => allowed.has(id));
    if (!targets.length) {
      return res.status(400).json({ error: 'Select a valid school' });
    }

    const subjectText = String(req.body.subject || '').trim() || 'Message from school';
    const created = await createPlatformNotificationsBatch(
      targets.map((id) => ({
        schoolId: id,
        fromSchoolId,
        senderRole: 'school',
        subject: subjectText,
        body: req.body.body,
        kind: 'message',
      }))
    );
    res.json({ count: created.length, items: created });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

app.get('/api/notifications/unread-count', authenticateToken, async (req, res) => {
  try {
    if (req.user.role === 'super_admin') {
      const unread = await countUnreadSuperAdminNotifications();
      return res.json({ unread });
    }
    const unread = await countUnreadSchoolNotifications(req.user.schoolId);
    res.json({ unread });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/notifications/:id/read', authenticateToken, async (req, res) => {
  try {
    if (req.user.role === 'super_admin') {
      const { data, error } = await supabase
        .from('platform_notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('id', req.params.id)
        .eq('sender_role', 'school')
        .select()
        .maybeSingle();
      if (error) throw error;
      return res.json(data || { ok: true });
    }
    const row = await markNotificationRead(req.params.id, req.user.schoolId);
    res.json(row || { ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/notifications/read-all', authenticateToken, async (req, res) => {
  try {
    if (req.user.role === 'super_admin') {
      await supabase
        .from('platform_notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('sender_role', 'school')
        .is('read_at', null);
    } else {
      await markAllSchoolNotificationsRead(req.user.schoolId);
    }
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/notifications/:id/reply', authenticateToken, async (req, res) => {
  try {
    const body = String(req.body.body || req.body.message || '').trim();
    if (!body) return res.status(400).json({ error: 'Reply message is required' });

    if (req.user.role === 'super_admin') {
      const { data: parent } = await supabase
        .from('platform_notifications')
        .select('id, school_id, parent_id, subject, kind, body')
        .eq('id', req.params.id)
        .maybeSingle();
      if (!parent) return res.status(404).json({ error: 'Notification not found' });
      const rootId = parent.parent_id || parent.id;
      let root = parent;
      if (parent.parent_id) {
        const loaded = await supabase
          .from('platform_notifications')
          .select('id, school_id, parent_id, subject, kind, body')
          .eq('id', rootId)
          .maybeSingle();
        if (loaded.data) root = loaded.data;
      }
      const reply = await createPlatformNotification({
        schoolId: parent.school_id,
        senderRole: 'super_admin',
        subject: parent.subject ? `Re: ${String(parent.subject).replace(/^Re:\s*/i, '')}` : 'Reply',
        body,
        kind: 'message',
        parentId: rootId,
      });
      if (isPublicSupportNotification(root)) {
        const contact = parsePublicSupportContact(root.body);
        if (!contact.email) {
          return res.json({
            ...reply,
            email_sent: false,
            email_error: 'This public request has no email address to reply to.',
          });
        }
        const greeting = contact.fullName ? `Hello ${contact.fullName},` : 'Hello,';
        const safeBody = String(body)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
        try {
          await sendAuthEmail({
            to: contact.email,
            subject: reply.subject || 'Reply from Schooltype support',
            text: `${greeting}\n\n${body}\n\n— Schooltype support`,
            html: `<p>${greeting}</p><p>${safeBody.replace(/\n/g, '<br>')}</p><p style="color:#64748b;font-size:12px">Schooltype support</p>`,
          });
        } catch (mailErr) {
          return res.json({
            ...reply,
            email_sent: false,
            email_error:
              mailErr.code === 'EMAIL_NOT_CONFIGURED'
                ? 'Reply was saved in the inbox, but email is not configured. Set EMAIL_USER and EMAIL_PASSWORD.'
                : mailErr.message || 'Reply was saved in the inbox, but the email could not be sent.',
          });
        }
        return res.json({ ...reply, email_sent: true });
      }
      return res.json(reply);
    }

    const { data: parent } = await supabase
      .from('platform_notifications')
      .select('*')
      .eq('id', req.params.id)
      .maybeSingle();

    if (!parent) return res.status(404).json({ error: 'Notification not found' });

    const myId = req.user.schoolId;
    const involved = parent.school_id === myId || parent.from_school_id === myId;
    if (!involved) return res.status(404).json({ error: 'Notification not found' });

    let targetSchoolId = myId;
    let fromSchoolId = null;
    if (parent.from_school_id && parent.from_school_id !== myId) {
      targetSchoolId = parent.from_school_id;
      fromSchoolId = myId;
    } else if (parent.school_id && parent.school_id !== myId) {
      targetSchoolId = parent.school_id;
      fromSchoolId = myId;
    }

    const rootId = parent.parent_id || parent.id;
    const reply = await createPlatformNotification({
      schoolId: targetSchoolId,
      fromSchoolId,
      senderRole: 'school',
      subject: parent.subject ? `Re: ${String(parent.subject).replace(/^Re:\s*/i, '')}` : 'Reply',
      body,
      kind: 'message',
      parentId: rootId,
    });
    res.json(reply);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

app.post('/api/super-admin/notifications', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const { schoolId, schoolIds, subject, body, parentId, selectAll } = req.body;
    let targets = Array.isArray(schoolIds) && schoolIds.length
      ? schoolIds
      : schoolId
        ? [schoolId]
        : [];

    if (selectAll || (!targets.length && !parentId)) {
      const { data: schools, error } = await supabase
        .from('schools')
        .select('id, role')
        .neq('role', 'super_admin');
      if (error) throw error;
      targets = (schools || []).map((s) => s.id);
    }

    if (parentId) {
      const { data: parent } = await supabase
        .from('platform_notifications')
        .select('*')
        .eq('id', parentId)
        .maybeSingle();
      if (!parent) return res.status(404).json({ error: 'Thread not found' });
      if (!String(body || '').trim()) {
        return res.status(400).json({ error: 'Message body is required' });
      }
      const reply = await createPlatformNotification({
        schoolId: parent.school_id,
        senderRole: 'super_admin',
        subject: subject || (parent.subject ? `Re: ${String(parent.subject).replace(/^Re:\s*/i, '')}` : 'Reply'),
        body,
        kind: 'message',
        parentId: parent.parent_id || parent.id,
      });
      return res.json({ count: 1, items: [reply] });
    }

    if (!targets.length) {
      return res.status(400).json({ error: 'Select at least one school' });
    }
    if (!String(body || '').trim()) {
      return res.status(400).json({ error: 'Message body is required' });
    }

    const subjectText = subject || 'Message from SCHOOLTYPE';
    const created = await createPlatformNotificationsBatch(
      targets.map((id) => ({
        schoolId: id,
        senderRole: 'super_admin',
        subject: subjectText,
        body,
        kind: 'message',
      }))
    );
    res.json({ count: created.length, items: created });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

// Render (and local dev) keep one Node process listening. Do not boot this
// path under Vercel — the API is not a serverless function anymore.
if (!isVercel()) {
  ready.then((ok) => {
    if (!ok) {
      console.error('Database initialization failed. Starting the API so /api/health can report it.');
    }

    const host = process.env.HOST || '0.0.0.0';
    const server = app.listen(PORT, host, () => {
      console.log(`Schooltype API listening on ${host}:${PORT}`);
      if (isProduction() && !String(process.env.FRONTEND_URL || '').trim()) {
        console.warn('FRONTEND_URL is not set. Email links will point at localhost. Set it to https://schootype.vercel.app');
      }
    });

    // Daily subscription reminders. Render has no separate cron for this.
    const runReminders = () => {
      runSubscriptionDueReminders({
        sendEmail: async ({ to, subject, text, html }) =>
          sendAuthEmail({ to, subject, text, html }),
      }).catch((err) => console.warn('Reminder sweep failed:', err.message));
    };
    setTimeout(runReminders, 15000);
    setInterval(runReminders, 24 * 60 * 60 * 1000);

    const sweepAbsences = async () => {
      const today = schoolLocalDate();
      const { data: schools, error } = await supabase.from('schools').select('id').limit(400);
      if (error) {
        console.warn('Absence sweep school list failed:', error.message);
        return;
      }
      for (const school of schools || []) {
        try {
          await ensureUnscannedStudentsMarkedLate(school.id, today);
        } catch (err) {
          console.warn(`Absence sweep failed for ${school.id}:`, err.message);
        }
      }
    };
    setTimeout(() => sweepAbsences().catch(() => {}), 25000);
    setInterval(() => sweepAbsences().catch(() => {}), 10 * 60 * 1000);

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`\nPort ${PORT} is already in use — another backend instance may still be running.`);
        console.error('Stop it first, then run npm run dev again in the backend folder.');
        console.error(`Windows: netstat -ano | findstr :${PORT}  then  taskkill /PID <pid> /F\n`);
      } else {
        console.error('Failed to start server:', err.message);
      }
      process.exit(1);
    });
  });
}