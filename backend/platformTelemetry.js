import { randomUUID } from 'crypto';
import { supabase } from './supabaseClient.js';
import { isSuccessfulFeeStatus, roundMoney } from './feePayments.js';

const MEMORY_CAP = 8000;
const ACTIVE_WINDOW_MS = 5 * 60 * 1000;
const SLOW_PAGE_MS = 3000;
const FETCH_LIMIT = 20000;
const LOG_FULL_LIMIT = 200;
const ANALYTICS_RANGES = new Set(['1d', '1w', '1m', '6m', '1y']);
const SERIES_ACTIVE_TYPES = new Set(['heartbeat', 'page_view', 'login', 'staff_login']);
const SERIES_KEY_TYPES = new Set([
  'login',
  'login_failed',
  'signup',
  'payment_failed',
  'payment_success',
  'sms_sent',
  'sms_failed',
  'staff_login',
  'staff_activity',
  'page_slow',
]);

const CLIENT_EVENT_TYPES = new Set(['heartbeat', 'page_view', 'page_slow']);
const SERVER_EVENT_TYPES = new Set([
  'login',
  'login_failed',
  'signup',
  'payment_failed',
  'payment_success',
  'sms_sent',
  'sms_failed',
  'staff_login',
  'staff_activity',
]);

const memoryEvents = [];
let tableReady = false;
let tableChecked = false;

function isMissingTableError(error) {
  const msg = String(error?.message || error?.details || error?.hint || '').toLowerCase();
  return (
    error?.code === '42P01' ||
    error?.code === 'PGRST205' ||
    msg.includes('platform_events') ||
    msg.includes('does not exist') ||
    msg.includes('could not find')
  );
}

function startOfDay(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfWeek(date = new Date()) {
  const d = startOfDay(date);
  const day = d.getDay();
  const diff = day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - diff);
  return d;
}

function startOfHour(date = new Date()) {
  const d = new Date(date);
  d.setMinutes(0, 0, 0);
  return d;
}

function startOfMonth(date = new Date()) {
  const d = new Date(date);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function normalizeAnalyticsRange(value) {
  const key = String(value || '1w').toLowerCase();
  return ANALYTICS_RANGES.has(key) ? key : '1w';
}

export function startOfUnit(date, unit) {
  if (unit === 'hour') return startOfHour(date);
  if (unit === 'day') return startOfDay(date);
  if (unit === 'week') return startOfWeek(date);
  return startOfMonth(date);
}

function addTimeUnit(date, unit) {
  const d = new Date(date);
  if (unit === 'hour') d.setHours(d.getHours() + 1);
  else if (unit === 'day') d.setDate(d.getDate() + 1);
  else if (unit === 'week') d.setDate(d.getDate() + 7);
  else d.setMonth(d.getMonth() + 1);
  return d;
}

export function analyticsRangeWindow(range, now = new Date()) {
  if (range === '1d') {
    const start = startOfHour(now);
    start.setHours(start.getHours() - 23);
    return { start, unit: 'hour' };
  }
  if (range === '1w') {
    const start = startOfDay(now);
    start.setDate(start.getDate() - 6);
    return { start, unit: 'day' };
  }
  if (range === '1m') {
    const start = startOfDay(now);
    start.setDate(start.getDate() - 29);
    return { start, unit: 'day' };
  }
  if (range === '6m') {
    const start = startOfWeek(now);
    start.setDate(start.getDate() - 7 * 25);
    return { start, unit: 'week' };
  }
  const start = startOfMonth(now);
  start.setMonth(start.getMonth() - 11);
  return { start, unit: 'month' };
}

function formatBucketLabel(date, unit) {
  if (unit === 'hour') return date.toLocaleTimeString('en-GB', { hour: 'numeric' });
  if (unit === 'day') return date.toLocaleDateString('en-GB', { weekday: 'short' });
  if (unit === 'week') return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return date.toLocaleDateString('en-GB', { month: 'short' });
}

export function enumerateBuckets(start, now, unit) {
  const buckets = [];
  let cursor = startOfUnit(start, unit);
  const end = now.getTime();
  let guard = 0;
  while (cursor.getTime() <= end && guard < 400) {
    buckets.push({
      t: cursor.toISOString(),
      label: formatBucketLabel(cursor, unit),
    });
    cursor = addTimeUnit(cursor, unit);
    guard += 1;
  }
  return buckets;
}

function personKey(event) {
  return `${event.school_id || ''}|${event.email || event.role || event.id}`;
}

function buildPerformanceSeries({ events, newUsers, range, now }) {
  const { start, unit } = analyticsRangeWindow(range, now);
  const buckets = enumerateBuckets(start, now, unit);
  const known = new Set(buckets.map((bucket) => bucket.t));
  const logins = new Map();
  const pages = new Map();
  const slow = new Map();
  const keyEvents = new Map();
  const failures = new Map();
  const attacks = new Map();
  const active = new Map();
  const newcomers = new Map();

  const bump = (map, key, amount = 1) => {
    map.set(key, (map.get(key) || 0) + amount);
  };

  for (const event of events || []) {
    const at = new Date(event.created_at);
    if (Number.isNaN(at.getTime()) || at < start) continue;
    const key = startOfUnit(at, unit).toISOString();
    if (!known.has(key)) continue;
    const type = event.event_type;
    if (type === 'login') bump(logins, key);
    if (type === 'page_view') bump(pages, key);
    if (type === 'page_slow') bump(slow, key);
    if (type === 'login_failed') bump(attacks, key);
    if (type === 'login_failed' || type === 'payment_failed') bump(failures, key);
    if (SERIES_KEY_TYPES.has(type)) bump(keyEvents, key);
    if (SERIES_ACTIVE_TYPES.has(type)) {
      if (!active.has(key)) active.set(key, new Set());
      active.get(key).add(personKey(event));
    }
  }

  for (const user of newUsers || []) {
    const at = new Date(user.createdAt);
    if (Number.isNaN(at.getTime()) || at < start) continue;
    const key = startOfUnit(at, unit).toISOString();
    if (!known.has(key)) continue;
    bump(newcomers, key);
  }

  const toPoints = (map, unique = false) =>
    buckets.map((bucket) => ({
      t: bucket.t,
      label: bucket.label,
      value: unique ? map.get(bucket.t)?.size || 0 : map.get(bucket.t) || 0,
    }));

  return {
    range,
    unit,
    start: start.toISOString(),
    series: {
      active: toPoints(active, true),
      logins: toPoints(logins),
      pages: toPoints(pages),
      slow: toPoints(slow),
      events: toPoints(keyEvents),
      errors: toPoints(failures),
      attacks: toPoints(attacks),
      tracks: toPoints(active, true),
      newUsers: toPoints(newcomers),
    },
  };
}

function trimText(value, max = 180) {
  const text = String(value || '').trim();
  if (!text) return null;
  return text.slice(0, max);
}

function normalizePath(path) {
  const raw = String(path || '').split('?')[0].split('#')[0];
  if (!raw) return '/';
  const cleaned = raw.replace(/\/{2,}/g, '/');
  return cleaned.length > 160 ? cleaned.slice(0, 160) : cleaned;
}

export function pageLabel(path) {
  const p = normalizePath(path).toLowerCase();
  if (p === '/' || p === '/login' || p === '/signup') return 'Public';
  if (p.startsWith('/attendance')) return 'Attendance';
  if (p.startsWith('/fees-paid') || p.startsWith('/fees-unpaid') || p.startsWith('/fees')) return 'Fees';
  if (p.startsWith('/report-cards')) return 'Reports';
  if (p.startsWith('/students') || p.startsWith('/add-student')) return 'Students';
  if (p.includes('staff-portal')) return 'Staff portal';
  if (p.startsWith('/staff')) return 'Staff';
  if (p.startsWith('/non-staff')) return 'Non-staff';
  if (p.startsWith('/scanner')) return 'Scanner';
  if (p.startsWith('/messages')) return 'Messages';
  if (p.startsWith('/classes')) return 'Setup';
  if (p.startsWith('/dashboard')) return 'Dashboard';
  if (p.startsWith('/school-wallet') || p.startsWith('/super-admin/platform-wallet')) return 'Wallet';
  if (p.startsWith('/bank-settings')) return 'Bank settings';
  if (p.startsWith('/notifications')) return 'Notifications';
  if (p.startsWith('/super-admin/analytics')) return 'Platform analytics';
  if (p.startsWith('/super-admin/monitor')) return 'Monitoring';
  if (p.startsWith('/super-admin')) return 'Platform admin';
  return p;
}

function remember(event) {
  memoryEvents.push(event);
  if (memoryEvents.length > MEMORY_CAP) {
    memoryEvents.splice(0, memoryEvents.length - MEMORY_CAP);
  }
}

function toRow(input) {
  const type = String(input.eventType || input.event_type || '').trim();
  if (!type) return null;
  const duration = Number(input.durationMs ?? input.duration_ms);
  return {
    id: input.id || randomUUID(),
    school_id: String(input.schoolId || input.school_id || '').trim() || null,
    school_name: trimText(input.schoolName || input.school_name, 120),
    email: trimText(input.email, 160)?.toLowerCase() || null,
    role: trimText(input.role, 40),
    event_type: type,
    path: input.path ? normalizePath(input.path) : null,
    duration_ms: Number.isFinite(duration) ? Math.max(0, Math.round(duration)) : null,
    meta: input.meta && typeof input.meta === 'object' ? input.meta : null,
    created_at: input.createdAt || input.created_at || new Date().toISOString(),
  };
}

export async function initPlatformTelemetry() {
  if (!supabase || tableChecked) return tableReady;
  tableChecked = true;
  try {
    const { error } = await supabase.from('platform_events').select('id').limit(1);
    if (error) {
      if (isMissingTableError(error)) {
        console.warn(
          'platform_events table is missing. Super-admin analytics will use in-memory events until you run backend/migrations/add_platform_events.sql (also in database/migrations.sql).'
        );
        tableReady = false;
        return false;
      }
      console.warn('platform_events probe failed:', error.message || error);
      tableReady = false;
      return false;
    }
    tableReady = true;
    return true;
  } catch (err) {
    console.warn('platform telemetry init failed:', err.message || err);
    tableReady = false;
    return false;
  }
}

export async function recordPlatformEvent(input) {
  const row = toRow(input);
  if (!row) return null;
  remember(row);

  if (!supabase) return row;
  if (!tableChecked) await initPlatformTelemetry();
  if (!tableReady) return row;

  try {
    const { error } = await supabase.from('platform_events').insert([row]);
    if (error) {
      if (isMissingTableError(error)) {
        tableReady = false;
        return row;
      }
      console.warn('Failed to persist platform event:', error.message || error);
    }
  } catch (err) {
    console.warn('Failed to persist platform event:', err.message || err);
  }
  return row;
}

export function recordClientEvents(user, events) {
  if (String(user?.role || '').toLowerCase() === 'super_admin') {
    return Promise.resolve([]);
  }
  const list = Array.isArray(events) ? events : [events];
  const accepted = [];
  for (const raw of list.slice(0, 20)) {
    const type = String(raw?.type || raw?.eventType || raw?.event_type || '').trim();
    if (!CLIENT_EVENT_TYPES.has(type)) continue;
    const duration = Number(raw.durationMs ?? raw.duration_ms);
    if (type === 'page_slow' && Number.isFinite(duration) && duration < SLOW_PAGE_MS) {
      continue;
    }
    accepted.push(
      recordPlatformEvent({
        schoolId: user?.schoolId || null,
        schoolName: raw.schoolName || raw.school_name || null,
        email: user?.email || null,
        role: user?.role || null,
        eventType: type,
        path: raw.path,
        durationMs: duration,
        meta: raw.meta || null,
      })
    );
  }
  return Promise.all(accepted);
}

function isSchoolUsageEvent(event) {
  const role = String(event?.role || '').toLowerCase();
  if (role === 'super_admin') return false;
  const path = String(event?.path || '');
  if (path.startsWith('/super-admin')) return false;
  return true;
}

export async function listPlatformEventsSince(since, { schoolId, limit } = {}) {
  return loadEventsSince(since instanceof Date ? since : new Date(since), { schoolId, limit });
}

async function loadEventsSince(since, { schoolId, limit } = {}) {
  const sinceMs = since.getTime();
  const fromMemory = memoryEvents.filter((event) => {
    if (new Date(event.created_at).getTime() < sinceMs) return false;
    if (schoolId && event.school_id && event.school_id !== schoolId) return false;
    return true;
  });

  if (!supabase) return fromMemory;
  if (!tableChecked) await initPlatformTelemetry();
  if (!tableReady) return fromMemory;

  try {
    let query = supabase
      .from('platform_events')
      .select('id, school_id, school_name, email, role, event_type, path, duration_ms, meta, created_at')
      .gte('created_at', since.toISOString())
      .order('created_at', { ascending: false })
      .limit(Math.min(Number(limit) || FETCH_LIMIT, FETCH_LIMIT));
    if (schoolId) query = query.eq('school_id', schoolId);
    const { data, error } = await query;

    if (error) {
      if (isMissingTableError(error)) tableReady = false;
      return fromMemory;
    }

    const byId = new Map();
    for (const event of data || []) byId.set(event.id, event);
    for (const event of fromMemory) {
      if (!byId.has(event.id)) byId.set(event.id, event);
    }
    return [...byId.values()].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  } catch {
    return fromMemory;
  }
}

function countBy(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!key) continue;
    const current = map.get(key) || { key, count: 0, sample: item };
    current.count += 1;
    map.set(key, current);
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

function uniqueActiveUsers(events, now = Date.now()) {
  return buildUserTracks(events, new Date(now - ACTIVE_WINDOW_MS), now).filter((user) => user.online);
}

function isAttackEvent(event) {
  const type = String(event?.event_type || '');
  const meta = readEventMeta(event);
  return type === 'login_failed' || String(meta.reason || '') === 'rate_limited';
}

function shouldKeepTrail(event) {
  const type = String(event?.event_type || '');
  return (
    type === 'page_view' ||
    type === 'page_slow' ||
    type === 'login' ||
    type === 'login_failed' ||
    type === 'staff_login' ||
    type === 'staff_activity' ||
    type === 'payment_failed' ||
    type === 'payment_success' ||
    type === 'signup'
  );
}

function compactTrail(items) {
  const out = [];
  for (const item of items) {
    const last = out[out.length - 1];
    if (last && last.page === item.page && last.label === item.label) {
      last.count = (last.count || 1) + 1;
      last.at = item.at;
      continue;
    }
    out.push({ ...item, count: 1 });
  }
  return out.slice(0, 24);
}

function buildUserTracks(events, rangeStart, now = Date.now()) {
  const startMs = rangeStart instanceof Date ? rangeStart.getTime() : new Date(rangeStart).getTime();
  const byPerson = new Map();
  for (const event of events || []) {
    const at = new Date(event.created_at).getTime();
    if (Number.isNaN(at) || at < startMs) continue;
    const key = `${event.school_id || ''}|${event.email || event.role || event.id}`;
    let row = byPerson.get(key);
    if (!row) {
      row = {
        schoolId: event.school_id,
        schoolName: event.school_name || (event.role === 'super_admin' ? 'Platform admin' : 'Unknown school'),
        email: event.email,
        role: event.role,
        lastSeen: event.created_at,
        path: event.path,
        page: pageLabel(event.path),
        lastAction: eventLabel(event),
        doing: null,
        online: false,
        pageViews: 0,
        failedLogins: 0,
        pages: [],
        trail: [],
        attacks: [],
      };
      byPerson.set(key, row);
    }
    if (at >= new Date(row.lastSeen).getTime()) {
      row.lastSeen = event.created_at;
      row.path = event.path || row.path;
      row.page = pageLabel(event.path) || row.page;
      row.lastAction = eventLabel(event);
      row.role = event.role || row.role;
      row.schoolName = event.school_name || row.schoolName;
      row.email = event.email || row.email;
    }
    if (event.event_type === 'page_view') row.pageViews += 1;
    if (event.event_type === 'login_failed') row.failedLogins += 1;
    if (shouldKeepTrail(event)) {
      row.trail.push({
        at: event.created_at,
        type: event.event_type,
        label: eventLabel(event),
        page: pageLabel(event.path),
        path: event.path,
        description: describePlatformError(event),
      });
    }
    if (isAttackEvent(event)) {
      const meta = readEventMeta(event);
      row.attacks.push({
        at: event.created_at,
        type: event.event_type,
        reason: meta.reason || null,
        description: describePlatformError(event),
      });
    }
  }

  return [...byPerson.values()]
    .map((row) => {
      const trail = compactTrail(
        [...row.trail].sort((a, b) => new Date(b.at) - new Date(a.at))
      );
      const pages = [];
      for (const item of [...trail].reverse()) {
        if (item.page && pages[pages.length - 1] !== item.page) pages.push(item.page);
      }
      const online = now - new Date(row.lastSeen).getTime() <= ACTIVE_WINDOW_MS;
      const where = row.page || pageLabel(row.path);
      return {
        ...row,
        online,
        path: row.path,
        page: where,
        pages,
        trail,
        attacks: row.attacks
          .sort((a, b) => new Date(b.at) - new Date(a.at))
          .slice(0, 12),
        doing: online ? `Viewing ${where}` : row.lastAction,
        attackCount: row.attacks.length,
      };
    })
    .sort((a, b) => Number(b.online) - Number(a.online) || new Date(b.lastSeen) - new Date(a.lastSeen))
    .slice(0, 150);
}

function buildAttackReports(events, rangeStart) {
  const startMs = rangeStart instanceof Date ? rangeStart.getTime() : new Date(rangeStart).getTime();
  const byTarget = new Map();
  for (const event of events || []) {
    if (!isAttackEvent(event)) continue;
    const at = new Date(event.created_at).getTime();
    if (Number.isNaN(at) || at < startMs) continue;
    const meta = readEventMeta(event);
    const target = String(event.email || 'unknown').toLowerCase();
    const current = byTarget.get(target) || {
      email: event.email || 'Unknown account',
      schoolName: event.school_name || null,
      count: 0,
      rateLimited: false,
      reasons: [],
      lastAt: event.created_at,
      samples: [],
    };
    current.count += 1;
    if (new Date(event.created_at) > new Date(current.lastAt)) {
      current.lastAt = event.created_at;
      current.schoolName = event.school_name || current.schoolName;
    }
    if (meta.reason === 'rate_limited') current.rateLimited = true;
    const reason = meta.reason || event.event_type;
    if (reason && !current.reasons.includes(reason)) current.reasons.push(reason);
    if (current.samples.length < 8) {
      current.samples.push({
        at: event.created_at,
        description: describePlatformError(event),
        reason: meta.reason || null,
        schoolName: event.school_name || null,
      });
    }
    byTarget.set(target, current);
  }

  return [...byTarget.values()]
    .map((row) => {
      const level = row.rateLimited || row.count >= 8 ? 'attack' : row.count >= 3 ? 'suspicious' : 'failed';
      const why =
        row.rateLimited
          ? 'Too many login attempts were blocked (rate limited).'
          : row.count >= 8
            ? `${row.count} failed logins on this account look like a brute-force attack.`
            : row.count >= 3
              ? `${row.count} failed logins on this account look suspicious.`
              : describePlatformError({ event_type: 'login_failed', meta: { reason: row.reasons[0] } });
      return { ...row, level, why };
    })
    .sort((a, b) => b.count - a.count || new Date(b.lastAt) - new Date(a.lastAt))
    .slice(0, 100);
}

function loginAdoption(events, dayStart, weekStart) {
  const logins = events.filter((event) => event.event_type === 'login');
  const bySchool = new Map();
  for (const event of logins) {
    const key = event.school_id || event.email || event.school_name || 'unknown';
    const current = bySchool.get(key) || {
      schoolId: event.school_id,
      schoolName: event.school_name || event.email || 'Unknown school',
      email: event.email,
      daily: 0,
      weekly: 0,
    };
    const at = new Date(event.created_at);
    if (at >= weekStart) current.weekly += 1;
    if (at >= dayStart) current.daily += 1;
    bySchool.set(key, current);
  }
  return [...bySchool.values()]
    .filter((row) => row.weekly > 0)
    .sort((a, b) => b.daily - a.daily || b.weekly - a.weekly);
}

function eventLabel(event) {
  switch (event.event_type) {
    case 'login':
      return 'Signed in';
    case 'heartbeat':
      return `Active on ${pageLabel(event.path)}`;
    case 'login_failed':
      return 'Failed login';
    case 'signup':
      return 'New school signed up';
    case 'payment_failed':
      return 'Payment failed';
    case 'payment_success':
      return 'Payment succeeded';
    case 'sms_sent':
      return 'SMS sent';
    case 'sms_failed':
      return 'SMS failed';
    case 'staff_login':
      return 'Staff signed in';
    case 'staff_activity':
      return event?.meta?.activity || 'Staff activity';
    case 'page_slow':
      return 'Slow page';
    case 'page_view':
      return `Visited ${pageLabel(event.path)}`;
    default:
      return event.event_type;
  }
}

export function describePlatformError(event) {
  const meta = event?.meta && typeof event.meta === 'object' ? event.meta : {};
  const reason = String(meta.reason || '').toLowerCase();
  const message = String(meta.message || '').trim();

  if (event?.event_type === 'login_failed') {
    if (reason === 'wrong_password') {
      return meta.source === 'staff_portal' ? 'Invalid access code or role' : 'Wrong password';
    }
    if (reason === 'unknown_email') return 'Email not found';
    if (reason === 'system_failure') return 'System failure during login';
    if (reason === 'rate_limited') return 'Too many login attempts';
    if (reason === 'invalid_code') return 'Invalid access code or role';
    if (meta.source === 'staff_portal') return message || 'Staff portal login failed';
    return message || 'Login attempt failed';
  }

  if (event?.event_type === 'sms_failed') {
    const sample = Array.isArray(meta.errors) ? meta.errors.find(Boolean) : null;
    return message || sample || 'SMS could not be delivered';
  }

  if (event?.event_type === 'payment_failed') {
    if (reason === 'student_not_found') {
      const code = String(meta.student_code || '').trim();
      return code ? `Student ID entered: ${code} — no matching student` : 'Student ID was not found';
    }
    if (message) return message;
    if (reason === 'abandoned') return 'Payment abandoned before completion';
    if (reason === 'provider_declined') return 'Payment declined by provider';
    if (reason === 'transfer_failed') return 'Withdrawal or transfer failed';
    if (reason === 'system_failure') return 'System failure while processing payment';
    return 'Payment attempt failed';
  }

  return eventLabel(event);
}

function eventDetailPayload(event, schoolName) {
  const meta = readEventMeta(event);
  return {
    id: event.id,
    type: event.event_type,
    label: eventLabel(event),
    description: describePlatformError(event),
    reason: meta.reason || null,
    message: meta.message || null,
    studentCode: meta.student_code || meta.studentCode || null,
    studentName: meta.student_name || meta.payer_name || null,
    source: meta.source || null,
    email: event.email,
    schoolName: schoolName || event.school_name || null,
    path: event.path,
    page: pageLabel(event.path),
    durationMs: event.duration_ms,
    createdAt: event.created_at,
  };
}

async function safeCount(table, filters = {}) {
  if (!supabase) return 0;
  try {
    let query = supabase.from(table).select('id', { count: 'exact', head: true });
    if (filters.gte) query = query.gte(filters.gte.column, filters.gte.value);
    if (filters.eq) query = query.eq(filters.eq.column, filters.eq.value);
    const { count, error } = await query;
    if (error) return 0;
    return count || 0;
  } catch {
    return 0;
  }
}

async function loadFeePaymentsSince(sinceIso, limit = 8000) {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from('fee_payments')
      .select('id, school_id, amount, status, payer_name, payment_method, channel, created_at')
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) return [];
    return data || [];
  } catch {
    return [];
  }
}

function successfulFeeAmount(row) {
  if (!isSuccessfulFeeStatus(row?.status)) return 0;
  return Number(row?.amount) || 0;
}

function buildFeeSeries(payments, range, now) {
  const { start, unit } = analyticsRangeWindow(range, now);
  const buckets = enumerateBuckets(start, now, unit);
  const known = new Set(buckets.map((bucket) => bucket.t));
  const amounts = new Map();
  for (const row of payments || []) {
    const amount = successfulFeeAmount(row);
    if (!amount) continue;
    const at = new Date(row.created_at);
    if (Number.isNaN(at.getTime()) || at < start) continue;
    const key = startOfUnit(at, unit).toISOString();
    if (!known.has(key)) continue;
    amounts.set(key, (amounts.get(key) || 0) + amount);
  }
  return buckets.map((bucket) => ({
    t: bucket.t,
    label: bucket.label,
    value: roundMoney(amounts.get(bucket.t) || 0),
  }));
}

function readEventMeta(event) {
  const raw = event?.meta;
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}

async function resolveSchoolNameLookup(events) {
  const schoolNameById = new Map();
  const schoolIdByStudentId = new Map();
  const schoolIdByCode = new Map();
  const schoolIds = new Set();
  const studentIds = new Set();
  const codes = new Set();

  for (const event of events || []) {
    const meta = readEventMeta(event);
    if (event.school_id) schoolIds.add(String(event.school_id));
    if (meta.school_id) schoolIds.add(String(meta.school_id));
    if (meta.student_id) studentIds.add(String(meta.student_id));
    const code = String(meta.student_code || '').trim();
    if (code) codes.add(code);
  }

  if (supabase && studentIds.size) {
    try {
      const { data } = await supabase.from('students').select('id, school_id').in('id', [...studentIds]);
      for (const row of data || []) {
        if (!row.school_id) continue;
        schoolIdByStudentId.set(String(row.id), row.school_id);
        schoolIds.add(String(row.school_id));
      }
    } catch {
      /* ignore */
    }
  }

  if (supabase && codes.size) {
    const list = [...codes];
    try {
      const [byBarcode, byRoll] = await Promise.all([
        supabase.from('students').select('barcode, school_id').in('barcode', list),
        supabase.from('students').select('roll_number, school_id').in('roll_number', list),
      ]);
      for (const row of byBarcode.data || []) {
        if (!row.school_id || !row.barcode) continue;
        schoolIdByCode.set(String(row.barcode).toLowerCase(), row.school_id);
        schoolIds.add(String(row.school_id));
      }
      for (const row of byRoll.data || []) {
        if (!row.school_id || !row.roll_number) continue;
        schoolIdByCode.set(String(row.roll_number).toLowerCase(), row.school_id);
        schoolIds.add(String(row.school_id));
      }
    } catch {
      /* ignore */
    }
  }

  if (supabase && schoolIds.size) {
    try {
      const { data } = await supabase.from('schools').select('id, name').in('id', [...schoolIds]);
      for (const row of data || []) {
        if (row.id && row.name) schoolNameById.set(String(row.id), row.name);
      }
    } catch {
      /* ignore */
    }
  }

  return (event) => {
    const meta = readEventMeta(event);
    if (event.school_name) return event.school_name;
    if (meta.school_name) return meta.school_name;
    const schoolId =
      event.school_id ||
      meta.school_id ||
      schoolIdByStudentId.get(String(meta.student_id || '')) ||
      schoolIdByCode.get(String(meta.student_code || '').trim().toLowerCase());
    return (schoolId && schoolNameById.get(String(schoolId))) || null;
  };
}

async function newSchoolsSince(sinceIso, limit = 100) {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from('schools')
      .select('id, name, email, role, created_at')
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) return [];
    return (data || []).filter((school) => school.role !== 'super_admin');
  } catch {
    return [];
  }
}

export async function getPlatformAnalytics(options = {}) {
  const now = new Date();
  const range = normalizeAnalyticsRange(options.range);
  const { start: rangeStart } = analyticsRangeWindow(range, now);
  const dayStart = startOfDay(now);
  const weekStart = startOfWeek(now);
  const loadSince = new Date(Math.min(rangeStart.getTime(), weekStart.getTime()));
  const events = (await loadEventsSince(loadSince)).filter(isSchoolUsageEvent);

  const inRange = (type, since) =>
    events.filter((event) => event.event_type === type && new Date(event.created_at) >= since);

  const pageViews = inRange('page_view', rangeStart);
  const slowPages = inRange('page_slow', rangeStart);
  const failedLoginsToday = inRange('login_failed', dayStart);
  const failedLoginsWeek = inRange('login_failed', weekStart);
  const failedPaymentsToday = inRange('payment_failed', dayStart);
  const failedPaymentsWeek = inRange('payment_failed', weekStart);
  const smsEventsToday = inRange('sms_sent', dayStart);
  const smsFromEvents = smsEventsToday.reduce((sum, event) => {
    const count = Number(event.meta?.count);
    return sum + (Number.isFinite(count) && count > 0 ? count : 1);
  }, 0);

  const [totalStudents, smsFromMessages, feePayments, recentSchools] = await Promise.all([
    safeCount('students'),
    safeCount('messages', {
      gte: { column: 'created_at', value: dayStart.toISOString() },
      eq: { column: 'delivery_channel', value: 'sms' },
    }),
    loadFeePaymentsSince(loadSince.toISOString()),
    newSchoolsSince(rangeStart.toISOString(), range === '6m' || range === '1y' ? 500 : 100),
  ]);

  const feesInRange = feePayments.filter((row) => new Date(row.created_at) >= rangeStart);
  const feesToday = feesInRange
    .filter((row) => new Date(row.created_at) >= dayStart)
    .reduce((sum, row) => sum + successfulFeeAmount(row), 0);
  const feesPaidInRange = feesInRange.reduce((sum, row) => sum + successfulFeeAmount(row), 0);
  const feesPreview = feesInRange
    .filter((row) => successfulFeeAmount(row) > 0)
    .slice(0, LOG_FULL_LIMIT)
    .map((row) => ({
      id: row.id,
      amount: roundMoney(successfulFeeAmount(row)),
      payerName: row.payer_name || 'Parent payment',
      method: row.channel || row.payment_method || 'Paystack',
      createdAt: row.created_at,
    }));

  const signupEvents = inRange('signup', rangeStart);
  const newUsers = [];
  const seen = new Set();
  for (const school of recentSchools) {
    seen.add(school.email || school.id);
    newUsers.push({
      schoolId: school.id,
      schoolName: school.name,
      email: school.email,
      createdAt: school.created_at,
      source: 'school_record',
    });
  }
  for (const event of signupEvents) {
    const key = event.email || event.school_id;
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    newUsers.push({
      schoolId: event.school_id,
      schoolName: event.school_name,
      email: event.email,
      createdAt: event.created_at,
      source: 'signup',
    });
  }

  const keyTypes = new Set([
    'login',
    'login_failed',
    'signup',
    'payment_failed',
    'payment_success',
    'sms_sent',
    'sms_failed',
    'staff_login',
    'staff_activity',
    'page_slow',
  ]);
  const keyEventsAll = events.filter(
    (event) => keyTypes.has(event.event_type) && new Date(event.created_at) >= rangeStart
  );
  const recentErrors = [...inRange('login_failed', rangeStart), ...inRange('payment_failed', rangeStart)]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, LOG_FULL_LIMIT);
  const keyEventsLimited = keyEventsAll.slice(0, LOG_FULL_LIMIT);
  const schoolNameFor = await resolveSchoolNameLookup([...keyEventsLimited, ...recentErrors]);
  const keyEvents = keyEventsLimited.map((event) => eventDetailPayload(event, schoolNameFor(event)));

  const topPages = countBy(pageViews, (event) => pageLabel(event.path)).slice(0, 40).map((row) => ({
    page: row.key,
    count: row.count,
    path: row.sample.path,
  }));

  const slowPageRows = countBy(slowPages, (event) => pageLabel(event.path) || event.path).slice(0, 40).map((row) => {
    const matching = slowPages.filter((event) => pageLabel(event.path) === row.key);
    const avg = matching.reduce((sum, event) => sum + (Number(event.duration_ms) || 0), 0) / (matching.length || 1);
    return {
      page: row.key,
      count: row.count,
      avgMs: Math.round(avg),
      path: row.sample.path,
    };
  });

  const userTracks = buildUserTracks(events, rangeStart, now.getTime());
  const attackReports = buildAttackReports(events, rangeStart);

  const chart = buildPerformanceSeries({ events, newUsers, range, now });
  chart.series.fees = buildFeeSeries(feePayments, range, now);

  return {
    generatedAt: now.toISOString(),
    tableReady,
    range,
    activeWindowMinutes: 5,
    slowPageMs: SLOW_PAGE_MS,
    activeUsers: userTracks.filter((user) => user.online),
    userTracks,
    attacks: attackReports,
    eventCounts: {
      loginsToday: inRange('login', dayStart).length,
      loginsThisWeek: inRange('login', weekStart).length,
      loginsInRange: inRange('login', rangeStart).length,
      pageViewsToday: inRange('page_view', dayStart).length,
      pageViewsThisWeek: inRange('page_view', weekStart).length,
      pageViewsInRange: pageViews.length,
      keyEventsInRange: keyEventsAll.length,
      errorsInRange: inRange('login_failed', rangeStart).length + inRange('payment_failed', rangeStart).length,
      newUsersInRange: newUsers.length,
      userTracksInRange: userTracks.length,
      attacksInRange: attackReports.reduce((sum, row) => sum + row.count, 0),
      heartbeatsToday: inRange('heartbeat', dayStart).length,
    },
    loginsBySchool: loginAdoption(events, dayStart, weekStart),
    topPages,
    slowPages: slowPageRows,
    errors: {
      failedLoginsToday: failedLoginsToday.length,
      failedLoginsThisWeek: failedLoginsWeek.length,
      failedPaymentsToday: failedPaymentsToday.length,
      failedPaymentsThisWeek: failedPaymentsWeek.length,
      recent: recentErrors.map((event) => eventDetailPayload(event, schoolNameFor(event))),
    },
    dataStats: {
      totalStudents,
      feesCollectedToday: feesToday,
      feesPaidInRange,
      smsSentToday: Math.max(smsFromEvents, smsFromMessages),
    },
    feesPreview,
    keyEvents,
    newUsers,
    chart,
  };
}

export { CLIENT_EVENT_TYPES, SERVER_EVENT_TYPES, SLOW_PAGE_MS };
