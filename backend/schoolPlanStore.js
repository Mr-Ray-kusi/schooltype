import { randomBytes } from 'crypto';
import { supabase, platformSupabase } from './supabaseClient.js';
import { initializeSubscription } from './subscription.js';
import { PAYMENT_PLANS, resolvePlanId } from './plans.js';

function billingDb() {
  return platformSupabase || supabase;
}

const SCHOOL_EXTRA_FIELDS = [
  'payment_plan',
  'plan_status',
  'plan_selected_at',
  'initial_password',
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

/** Plan/approval fields must live in Postgres so every Vercel instance sees them. */
const CRITICAL_PLAN_FIELDS = ['payment_plan', 'plan_status'];

const SCHEMA_HELP =
  'Run database/supabase_core_billing.sql then database/supabase_backend_access.sql in the Supabase SQL editor, and set SUPABASE_SERVICE_ROLE_KEY on the server.';

const cache = new Map();

const isMissingColumnError = (error, column) => {
  const msg = String(error?.message || error?.details || error?.hint || '');
  return (
    msg.includes(column) &&
    (msg.includes('does not exist') ||
      msg.includes('Could not find') ||
      msg.includes('schema cache') ||
      error?.code === 'PGRST204')
  );
};

const toDateOnly = (value) => {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  try {
    return new Date(value).toISOString().slice(0, 10);
  } catch {
    return null;
  }
};

const normalizeExtras = (row = {}) => ({
  school_id: row.id || row.school_id,
  payment_plan: row.payment_plan || null,
  plan_status: row.plan_status || null,
  plan_selected_at: row.plan_selected_at || null,
  initial_password: row.initial_password || null,
  logo_url: row.logo_url || null,
  scanner_token: row.scanner_token || null,
  staff_portal_token: row.staff_portal_token || null,
  late_after_time: row.late_after_time || '08:00',
  last_due_reminder_at: row.last_due_reminder_at || null,
  next_payment_due: toDateOnly(row.next_payment_due),
  last_payment_at: toDateOnly(row.last_payment_at),
  subscription_frozen: Boolean(row.subscription_frozen),
  subscription_started_at: toDateOnly(row.subscription_started_at),
  total_paid: Number(row.total_paid) || 0,
  payment_records: Array.isArray(row.payment_records) ? row.payment_records : [],
});

async function updateSchoolColumns(schoolId, updates) {
  const payload = { ...updates };
  const optional = [...SCHOOL_EXTRA_FIELDS];
  const stripped = [];

  for (let attempt = 0; attempt <= optional.length; attempt++) {
    if (!Object.keys(payload).length) {
      return {
        data: null,
        error: {
          message: `No school columns left to update (missing schema). ${SCHEMA_HELP}`,
          code: 'MISSING_COLUMNS',
        },
        stripped,
      };
    }

    const { data, error } = await supabase
      .from('schools')
      .update(payload)
      .eq('id', schoolId)
      .select('*')
      .maybeSingle();

    if (!error) {
      if (!data) {
        return {
          data: null,
          error: {
            message: `School update returned no row (often RLS). ${SCHEMA_HELP}`,
            code: 'NO_ROW',
          },
          stripped,
        };
      }
      return { data, error: null, stripped };
    }

    const missingColumn = optional.find(
      (column) => payload[column] !== undefined && isMissingColumnError(error, column)
    );

    if (missingColumn) {
      delete payload[missingColumn];
      stripped.push(missingColumn);
      continue;
    }

    return { data: null, error, stripped };
  }

  return {
    data: null,
    error: { message: 'Failed to update school subscription fields' },
    stripped,
  };
}

function mapPaymentRow(row) {
  return {
    amount: Number(row.amount) || 0,
    plan_id: row.plan || null,
    plan_name: row.plan_name || row.plan || null,
    recorded_at: row.created_at,
    status: row.status || 'approved',
    reference: row.reference || null,
    source: row.source || null,
  };
}

async function loadPaymentRecords(schoolId) {
  const client = billingDb();
  if (!client) return [];
  let result = await client
    .from('subscription_payments')
    .select('amount, plan, plan_name, created_at, status, reference, source')
    .eq('school_id', schoolId)
    .order('created_at', { ascending: false });

  if (result.error && (isMissingColumnError(result.error, 'reference') || isMissingColumnError(result.error, 'source'))) {
    result = await client
      .from('subscription_payments')
      .select('amount, plan, plan_name, created_at, status')
      .eq('school_id', schoolId)
      .order('created_at', { ascending: false });
  }

  if (result.error) {
    if (isMissingColumnError(result.error, 'subscription_payments') || result.error.code === '42P01') {
      return [];
    }
    console.warn('Failed to load subscription payments:', result.error.message);
    return [];
  }

  return (result.data || []).map(mapPaymentRow);
}

export async function initSchoolPlanStore() {
  cache.clear();

  // On Vercel, skip preloading every school into memory — that made cold starts slow.
  // Plan fields are read from the schools row (and filled into cache on demand).
  if (process.env.VERCEL) {
    return;
  }

  const { data: schools, error } = await supabase.from('schools').select('*');
  if (error) {
    throw new Error(`School plan store init failed: ${error.message}`);
  }

  let payResult = await supabase
    .from('subscription_payments')
    .select('school_id, amount, plan, plan_name, created_at, status, reference, source')
    .order('created_at', { ascending: false });
  if (
    payResult.error &&
    (isMissingColumnError(payResult.error, 'reference') || isMissingColumnError(payResult.error, 'source'))
  ) {
    payResult = await supabase
      .from('subscription_payments')
      .select('school_id, amount, plan, plan_name, created_at, status')
      .order('created_at', { ascending: false });
  }
  const payments = payResult.data;
  const payError = payResult.error;

  if (payError && !(isMissingColumnError(payError, 'subscription_payments') || payError.code === '42P01')) {
    console.warn('subscription_payments unavailable:', payError.message);
  }

  const paymentsBySchool = new Map();
  for (const row of payments || []) {
    const list = paymentsBySchool.get(row.school_id) || [];
    list.push(mapPaymentRow(row));
    paymentsBySchool.set(row.school_id, list);
  }

  for (const school of schools || []) {
    const extras = normalizeExtras(school);
    extras.payment_records = paymentsBySchool.get(school.id) || [];
    cache.set(school.id, extras);
  }
}

/** Keep cache aligned with a Postgres schools row (source of truth). */
export function hydrateExtrasFromSchool(school) {
  if (!school?.id) return null;
  const existing = cache.get(school.id) || { school_id: school.id, payment_records: [] };
  const fromDb = normalizeExtras(school);
  // Do not let a cold/partial row null out plan fields already known on this instance.
  const merged = {
    ...existing,
    ...fromDb,
    payment_plan: fromDb.payment_plan || existing.payment_plan || null,
    plan_status: fromDb.plan_status || existing.plan_status || null,
    plan_selected_at: fromDb.plan_selected_at || existing.plan_selected_at || null,
    scanner_token: fromDb.scanner_token || existing.scanner_token || null,
    staff_portal_token: fromDb.staff_portal_token || existing.staff_portal_token || null,
    late_after_time: fromDb.late_after_time || existing.late_after_time || '08:00',
    payment_records: existing.payment_records || [],
  };
  cache.set(school.id, merged);
  return merged;
}

export function parsePaymentRecords(extras) {
  if (!extras?.payment_records) return [];
  if (Array.isArray(extras.payment_records)) return extras.payment_records;
  try {
    const records = JSON.parse(extras.payment_records);
    return Array.isArray(records) ? records : [];
  } catch {
    return [];
  }
}

export function getSchoolExtrasSync(schoolId) {
  return cache.get(schoolId) || null;
}

export async function replaceSchoolSubscriptionPayments(schoolId, records = []) {
  const { error: delError } = await supabase.from('subscription_payments').delete().eq('school_id', schoolId);
  if (delError && !(isMissingColumnError(delError, 'subscription_payments') || delError.code === '42P01')) {
    console.warn('Failed to clear subscription payments:', delError.message);
  }

  const rows = (records || [])
    .map((row) => ({
      school_id: schoolId,
      plan: row.plan_id || row.plan || null,
      plan_name: row.plan_name || null,
      amount: Number(row.amount) || 0,
      currency: 'GHS',
      status: row.status || 'approved',
      created_at: row.recorded_at || row.created_at || new Date().toISOString(),
      approved_at: row.recorded_at || row.created_at || new Date().toISOString(),
      reference: row.reference || null,
      source: row.source || 'paystack',
    }))
    .filter((row) => row.amount > 0);

  if (rows.length) {
    let { error: insError } = await supabase.from('subscription_payments').insert(rows);
    if (insError && (isMissingColumnError(insError, 'reference') || isMissingColumnError(insError, 'source'))) {
      const slim = rows.map(({ reference: _reference, source: _source, ...rest }) => rest);
      ({ error: insError } = await supabase.from('subscription_payments').insert(slim));
    }
    if (insError && !(isMissingColumnError(insError, 'subscription_payments') || insError.code === '42P01')) {
      console.warn('Failed to rewrite subscription payments:', insError.message);
    }
  }

  const extras = cache.get(schoolId);
  if (extras) extras.payment_records = records || [];
  return records || [];
}

export function inferPlanIdFromAmount(amount) {
  const paid = Number(amount) || 0;
  if (paid <= 0) return null;
  const exact = Object.values(PAYMENT_PLANS).find((plan) => Number(plan.price) === paid);
  if (exact) return exact.id;
  if (paid >= 30) return 'large';
  if (paid >= 20) return 'mid';
  return 'small';
}

/** True when signup/renewal payment already happened — do not send the school to pay again. */
export function schoolHasPaidPlan(school) {
  if (!school) return false;
  const status = String(school.plan_status || '').toLowerCase();
  if (status === 'rejected') return false;
  if (status === 'approved' || school.plan_approved === true) return true;
  if (['paid', 'active', 'success', 'complete'].includes(status)) return true;
  if (Number(school.total_paid) > 0) return true;
  if (school.last_payment_at || school.subscription_started_at) return true;
  if (Array.isArray(school.payment_records) && school.payment_records.length > 0) return true;
  if (typeof school.payment_records === 'string' && school.payment_records.trim().length > 2 && school.payment_records.trim() !== '[]') {
    return true;
  }
  if (!school.payment_plan) return false;
  if (school.plan_selected_at) return true;
  return false;
}

function paidSignupStatus(status) {
  const value = String(status || '').toLowerCase();
  return ['fulfilled', 'paid', 'complete', 'success', 'approved'].includes(value);
}

/**
 * If Paystack already created/paid this school but plan_status stayed pending,
 * copy that proof onto the school row so sign-in opens the dashboard.
 */
export async function syncPaidPlanFromLedger(school) {
  if (!school?.id) return school;
  if (String(school.role || '') === 'super_admin') return school;

  const merged = mergeSchoolWithExtras(school);
  if (schoolHasPaidPlan(merged) && merged.plan_status === 'approved' && merged.payment_plan) {
    return { ...school, ...merged, plan_status: 'approved' };
  }

  const client = billingDb();
  if (!client) {
    return schoolHasPaidPlan(merged) ? { ...school, ...merged, plan_status: 'approved' } : school;
  }

  let planId = resolvePlanId(merged.payment_plan) || inferPlanIdFromAmount(merged.total_paid);
  let paid = schoolHasPaidPlan(merged);
  let totalPaid = Number(merged.total_paid) || 0;

  try {
    if (school.email) {
      const { data: pendingRows } = await client
        .from('pending_signups')
        .select('payment_plan, status, paystack_reference, school_id')
        .eq('email', String(school.email).trim().toLowerCase())
        .limit(20);
      const hit = (pendingRows || []).find(
        (row) =>
          String(row.status || '') !== 'replaced' &&
          (paidSignupStatus(row.status) || row.payment_plan || row.paystack_reference)
      );
      if (hit) {
        paid = true;
        planId = planId || resolvePlanId(hit.payment_plan);
      }
    }
  } catch {
    // pending_signups may be missing
  }

  try {
    const { data: pays } = await client
      .from('subscription_payments')
      .select('amount, plan, plan_id, status, created_at')
      .eq('school_id', school.id)
      .limit(20);
    const hit = (pays || []).find(
      (row) => Number(row.amount) > 0 || paidSignupStatus(row.status) || row.plan || row.plan_id
    );
    if (hit) {
      paid = true;
      planId = planId || resolvePlanId(hit.plan || hit.plan_id);
      totalPaid = Math.max(totalPaid, Number(hit.amount) || 0);
    }
  } catch {
    // subscription_payments may be missing
  }

  if (!paid) return school;
  if (!planId) planId = 'small';

  const subscription =
    merged.subscription_started_at && merged.next_payment_due
      ? {
          subscription_started_at: merged.subscription_started_at,
          last_payment_at: merged.last_payment_at || merged.subscription_started_at,
          next_payment_due: merged.next_payment_due,
        }
      : initializeSubscription();

  const updates = {
    payment_plan: planId || merged.payment_plan,
    plan_status: 'approved',
    subscription_frozen: false,
    total_paid: totalPaid || merged.total_paid || 0,
    ...subscription,
  };

  try {
    await client.from('schools').update(updates).eq('id', school.id);
    cache.set(school.id, {
      ...(cache.get(school.id) || {}),
      ...updates,
      school_id: school.id,
    });
  } catch (error) {
    console.warn('Failed to persist paid plan after signup payment:', error.message || error);
  }

  return { ...school, ...merged, ...updates };
}

export function mergeSchoolWithExtras(school) {
  if (!school) return school;

  // Prefer Postgres columns; cache is only a fallback for the same instance.
  const extras = getSchoolExtrasSync(school.id) || {};
  const paymentPlan = school.payment_plan || extras.payment_plan || null;
  // Prefer explicit DB status; never invent "pending" over a cached "approved".
  const rawStatus = school.plan_status ?? extras.plan_status ?? null;
  let planStatus = rawStatus || (paymentPlan ? 'pending' : null);

  const paymentEvidence = {
    payment_plan: paymentPlan,
    plan_status: extras.plan_status === 'approved' ? 'approved' : planStatus,
    plan_approved: school.plan_approved || extras.plan_approved,
    total_paid: school.total_paid ?? extras.total_paid,
    last_payment_at: school.last_payment_at || extras.last_payment_at,
    subscription_started_at: school.subscription_started_at || extras.subscription_started_at,
    payment_records: school.payment_records || extras.payment_records,
  };

  // Signup payment can leave billing dates / total_paid while plan_status stays pending.
  if (paymentPlan && planStatus !== 'rejected' && schoolHasPaidPlan(paymentEvidence)) {
    planStatus = 'approved';
  }

  return {
    ...school,
    payment_plan: paymentPlan,
    plan_status: planStatus,
    plan_selected_at: school.plan_selected_at || extras.plan_selected_at || null,
    initial_password: school.initial_password || extras.initial_password || null,
    logo_url: school.logo_url || extras.logo_url || null,
    scanner_token: school.scanner_token || extras.scanner_token || null,
    staff_portal_token: school.staff_portal_token || extras.staff_portal_token || null,
    late_after_time: school.late_after_time || extras.late_after_time || '08:00',
    last_due_reminder_at: school.last_due_reminder_at || extras.last_due_reminder_at || null,
    next_payment_due: toDateOnly(school.next_payment_due || extras.next_payment_due),
    last_payment_at: toDateOnly(school.last_payment_at || extras.last_payment_at),
    subscription_frozen: Boolean(
      school.subscription_frozen !== undefined && school.subscription_frozen !== null
        ? school.subscription_frozen
        : extras.subscription_frozen
    ),
    subscription_started_at: toDateOnly(
      school.subscription_started_at || extras.subscription_started_at
    ),
    total_paid: Number(school.total_paid ?? extras.total_paid) || 0,
    payment_records: parsePaymentRecords(extras),
  };
}

/**
 * Persist school plan/subscription extras to Supabase.
 * Critical plan fields (payment_plan, plan_status) must succeed in Postgres —
 * silent in-memory-only writes hide schools from super-admin on other instances.
 */
export async function upsertSchoolExtras(schoolId, extras, { requirePersist } = {}) {
  const existing = cache.get(schoolId) || { school_id: schoolId, payment_records: [] };

  const merged = {
    school_id: schoolId,
    payment_plan: extras.payment_plan !== undefined ? extras.payment_plan : existing.payment_plan || null,
    plan_status: extras.plan_status !== undefined ? extras.plan_status : existing.plan_status || null,
    plan_selected_at:
      extras.plan_selected_at !== undefined ? extras.plan_selected_at : existing.plan_selected_at || null,
    initial_password:
      extras.initial_password !== undefined ? extras.initial_password : existing.initial_password || null,
    logo_url: extras.logo_url !== undefined ? extras.logo_url : existing.logo_url || null,
    scanner_token:
      extras.scanner_token !== undefined ? extras.scanner_token : existing.scanner_token || null,
    staff_portal_token:
      extras.staff_portal_token !== undefined
        ? extras.staff_portal_token
        : existing.staff_portal_token || null,
    late_after_time:
      extras.late_after_time !== undefined
        ? extras.late_after_time
        : existing.late_after_time || '08:00',
    last_due_reminder_at:
      extras.last_due_reminder_at !== undefined
        ? extras.last_due_reminder_at
        : existing.last_due_reminder_at || null,
    next_payment_due:
      extras.next_payment_due !== undefined
        ? toDateOnly(extras.next_payment_due)
        : existing.next_payment_due || null,
    last_payment_at:
      extras.last_payment_at !== undefined
        ? toDateOnly(extras.last_payment_at)
        : existing.last_payment_at || null,
    subscription_frozen:
      extras.subscription_frozen !== undefined
        ? Boolean(extras.subscription_frozen)
        : Boolean(existing.subscription_frozen),
    subscription_started_at:
      extras.subscription_started_at !== undefined
        ? toDateOnly(extras.subscription_started_at)
        : existing.subscription_started_at || null,
    total_paid:
      extras.total_paid !== undefined ? Number(extras.total_paid) : Number(existing.total_paid) || 0,
    payment_records: existing.payment_records || [],
  };

  const schoolUpdate = {
    payment_plan: merged.payment_plan,
    plan_status: merged.plan_status,
    plan_selected_at: merged.plan_selected_at,
    initial_password: merged.initial_password,
    logo_url: merged.logo_url,
    scanner_token: merged.scanner_token,
    staff_portal_token: merged.staff_portal_token,
    late_after_time: merged.late_after_time,
    last_due_reminder_at: merged.last_due_reminder_at,
    next_payment_due: merged.next_payment_due,
    last_payment_at: merged.last_payment_at,
    subscription_frozen: merged.subscription_frozen,
    subscription_started_at: merged.subscription_started_at,
    total_paid: merged.total_paid,
  };

  const touchingCritical = CRITICAL_PLAN_FIELDS.some((field) => extras[field] !== undefined);
  const mustPersist = requirePersist !== undefined ? requirePersist : touchingCritical;

  const { data, error, stripped } = await updateSchoolColumns(schoolId, schoolUpdate);

  if (error || !data) {
    const detail = error?.message || 'update returned no row';
    if (mustPersist) {
      throw new Error(`Failed to save school plan/approval in database: ${detail}. ${SCHEMA_HELP}`);
    }
    console.warn(
      'School extras DB update failed; using in-memory cache until SQL migrations are applied:',
      detail
    );
  } else {
    const fromDb = normalizeExtras(data);
    Object.assign(merged, fromDb);

    if (touchingCritical) {
      if (extras.payment_plan !== undefined && extras.payment_plan && !data.payment_plan) {
        throw new Error(`payment_plan did not persist. ${SCHEMA_HELP}`);
      }
      if (extras.plan_status !== undefined && extras.plan_status && data.plan_status !== extras.plan_status) {
        throw new Error(`plan_status did not persist (got ${data.plan_status}). ${SCHEMA_HELP}`);
      }
    }
  }

  if (mustPersist && stripped.some((column) => CRITICAL_PLAN_FIELDS.includes(column))) {
    throw new Error(`Schools table is missing plan columns (${stripped.join(', ')}). ${SCHEMA_HELP}`);
  }

  // Optional: append a payment history row when caller passes serialized records
  if (extras.payment_records !== undefined) {
    let records = extras.payment_records;
    if (typeof records === 'string') {
      try {
        records = JSON.parse(records);
      } catch {
        records = [];
      }
    }
    if (Array.isArray(records) && records.length) {
      const newest = records[0];
      const alreadyCached = (existing.payment_records || []).some(
        (r) => r.recorded_at === newest.recorded_at && Number(r.amount) === Number(newest.amount)
      );
      if (!alreadyCached && newest) {
        const payRow = {
          school_id: schoolId,
          plan: newest.plan_id || merged.payment_plan,
          plan_name: newest.plan_name || null,
          amount: Number(newest.amount) || 0,
          currency: 'GHS',
          status: 'approved',
          created_at: newest.recorded_at || new Date().toISOString(),
          approved_at: newest.recorded_at || new Date().toISOString(),
          reference: newest.reference || null,
          source: newest.source || 'paystack',
        };
        let { error: payError } = await supabase.from('subscription_payments').insert([payRow]);
        if (payError && (isMissingColumnError(payError, 'reference') || isMissingColumnError(payError, 'source'))) {
          delete payRow.reference;
          delete payRow.source;
          ({ error: payError } = await supabase.from('subscription_payments').insert([payRow]));
        }
        if (payError && !(isMissingColumnError(payError, 'subscription_payments') || payError.code === '42P01')) {
          console.warn('Failed to insert subscription payment:', payError.message);
        }
      }
      merged.payment_records = records;
    }
  } else {
    merged.payment_records = await loadPaymentRecords(schoolId);
  }

  cache.set(schoolId, merged);
  return merged;
}

export async function deleteSchoolExtras(schoolId) {
  cache.delete(schoolId);
}

function createScannerToken() {
  return randomBytes(24).toString('hex');
}

export function getScannerTokenSync(schoolId) {
  return getSchoolExtrasSync(schoolId)?.scanner_token || null;
}

export async function getSchoolIdByScannerToken(token) {
  if (!token) return null;

  const { data, error } = await supabase
    .from('schools')
    .select('id')
    .eq('scanner_token', token)
    .maybeSingle();

  if (error) {
    console.warn('Scanner token lookup failed:', error.message);
    return null;
  }

  return data?.id || null;
}

export async function ensureScannerToken(schoolId) {
  // Prefer in-memory cache, then Postgres — never mint a new token just because cache is cold.
  const cached = getScannerTokenSync(schoolId);
  if (cached) return cached;

  const { data: school, error } = await supabase
    .from('schools')
    .select('id, scanner_token')
    .eq('id', schoolId)
    .maybeSingle();

  if (error) {
    console.warn('Scanner token DB lookup failed:', error.message);
  }

  if (school?.scanner_token) {
    hydrateExtrasFromSchool(school);
    return school.scanner_token;
  }

  const token = createScannerToken();
  await upsertSchoolExtras(schoolId, { scanner_token: token }, { requirePersist: true });
  return getScannerTokenSync(schoolId) || token;
}

export async function regenerateScannerToken(schoolId) {
  const token = createScannerToken();
  await upsertSchoolExtras(schoolId, { scanner_token: token }, { requirePersist: true });
  return token;
}

function createStaffPortalToken() {
  return randomBytes(24).toString('hex');
}

export function getStaffPortalTokenSync(schoolId) {
  return getSchoolExtrasSync(schoolId)?.staff_portal_token || null;
}

export async function getSchoolIdByStaffPortalToken(token) {
  if (!token) return null;

  const { data, error } = await supabase
    .from('schools')
    .select('id')
    .eq('staff_portal_token', token)
    .maybeSingle();

  if (error) {
    console.warn('Staff portal token lookup failed:', error.message);
    return null;
  }

  return data?.id || null;
}

export async function ensureStaffPortalToken(schoolId) {
  const cached = getStaffPortalTokenSync(schoolId);
  if (cached) return cached;

  const { data: school, error } = await supabase
    .from('schools')
    .select('id, staff_portal_token')
    .eq('id', schoolId)
    .maybeSingle();

  if (error) {
    console.warn('Staff portal token DB lookup failed:', error.message);
  }

  if (school?.staff_portal_token) {
    hydrateExtrasFromSchool(school);
    return school.staff_portal_token;
  }

  const token = createStaffPortalToken();
  await upsertSchoolExtras(schoolId, { staff_portal_token: token }, { requirePersist: true });
  return getStaffPortalTokenSync(schoolId) || token;
}

export async function regenerateStaffPortalToken(schoolId) {
  const token = createStaffPortalToken();
  await upsertSchoolExtras(schoolId, { staff_portal_token: token }, { requirePersist: true });
  return token;
}

/** Probe whether plan columns exist (for startup warnings). */
export async function checkPlanSchemaReady() {
  const { error } = await supabase.from('schools').select('id, payment_plan, plan_status').limit(1);
  if (!error) return { ready: true, error: null };
  if (
    isMissingColumnError(error, 'payment_plan') ||
    isMissingColumnError(error, 'plan_status')
  ) {
    return { ready: false, error };
  }
  return { ready: false, error };
}
