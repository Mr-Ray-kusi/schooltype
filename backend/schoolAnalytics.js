import { supabase } from './supabaseClient.js';
import { resolveFeePeriod } from './academicTerms.js';
import { isSuccessfulFeeStatus, resolveStudentFeeAmount, roundMoney } from './feePayments.js';
import {
  analyticsRangeWindow,
  describePlatformError,
  enumerateBuckets,
  normalizeAnalyticsRange,
  pageLabel,
  startOfUnit,
  listPlatformEventsSince,
} from './platformTelemetry.js';

const ACTIVE_WINDOW_MS = 5 * 60 * 1000;

const safeQuery = async (fn, fallback) => {
  try {
    return await fn();
  } catch {
    return fallback;
  }
};

const toPoints = (buckets, map) =>
  buckets.map((bucket) => ({
    t: bucket.t,
    label: bucket.label,
    value: map.get(bucket.t) || 0,
  }));

const bump = (map, key, amount = 1) => {
  map.set(key, (map.get(key) || 0) + amount);
};

const capitalize = (value) => {
  const text = String(value || '').replace(/-/g, ' ').trim();
  if (!text) return '';
  return text.charAt(0).toUpperCase() + text.slice(1);
};

const isStaffPortalEvent = (event) => {
  const role = String(event?.role || '').toLowerCase();
  if (role === 'staff_portal') return true;
  return String(event?.meta?.source || '').toLowerCase() === 'staff_portal';
};

const staffPersonKey = (event) =>
  String(event?.meta?.staffId || event?.email || event?.id || '').trim() || event?.id;

const staffDisplayName = (event) =>
  event?.meta?.staffName || event?.email || 'Staff';

const describeAttendance = (row) => {
  const type = capitalize(row.user_type || 'person') || 'Person';
  const label = row.user_label ? ` · ${row.user_label}` : '';
  const status = String(row.status || '').toLowerCase();
  if (status === 'late') return `${type}${label} marked late`;
  if (status === 'early') return `${type}${label} marked early`;
  if (status === 'present') return `${type}${label} marked present`;
  if (status === 'absent') return `${type}${label} marked absent`;
  return `${type}${label} attendance recorded`;
};

const describeStaffActivity = (event) => {
  const meta = event?.meta && typeof event.meta === 'object' ? event.meta : {};
  if (meta.activity) return String(meta.activity);
  if (event?.event_type === 'staff_login') {
    return meta.staffRole ? `Signed in via staff portal as ${meta.staffRole}` : 'Signed in via staff portal';
  }
  if (event?.event_type === 'staff_activity') {
    return 'Recorded work in the staff portal';
  }
  const page = pageLabel(event?.path);
  if (event?.event_type === 'heartbeat') return `Active in ${page}`;
  if (event?.event_type === 'page_view') return `Opened ${page}`;
  return describePlatformError(event);
};

const eventMeta = (event) => {
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
};

const eventMatchesSchool = (event, schoolId, students = []) => {
  const sid = String(schoolId || '');
  if (!sid) return false;
  if (event?.school_id && String(event.school_id) === sid) return true;
  const meta = eventMeta(event);
  if (meta.school_id && String(meta.school_id) === sid) return true;
  if (event?.event_type !== 'payment_failed') return false;
  const ids = new Set((students || []).map((row) => String(row.id)));
  const codes = new Set(
    (students || [])
      .flatMap((row) => [row.barcode, row.roll_number])
      .filter(Boolean)
      .map((value) => String(value).trim().toLowerCase())
  );
  if (meta.student_id && ids.has(String(meta.student_id))) return true;
  const code = String(meta.student_code || '').trim().toLowerCase();
  if (code && codes.has(code)) return true;
  const names = new Set(
    (students || []).map((row) => String(row.name || '').trim().toLowerCase()).filter(Boolean)
  );
  const studentName = String(meta.student_name || '').trim().toLowerCase();
  return Boolean(studentName && names.has(studentName));
};

const isFeePaymentFailure = (event) => {
  if (event?.event_type !== 'payment_failed') return false;
  const path = String(event?.path || '');
  if (path.startsWith('/school-wallet')) return false;
  const meta = eventMeta(event);
  if (meta.kind === 'wallet' || meta.kind === 'deposit') return false;
  return (
    meta.kind === 'school_fee' ||
    meta.reason === 'student_not_found' ||
    path.includes('/fees') ||
    path.includes('/pay')
  );
};

const describeFeeFailure = (event) => {
  const meta = eventMeta(event);
  const reason = describePlatformError({ ...event, meta });
  const code = String(meta.student_code || '').trim();
  if (meta.reason === 'student_not_found') return reason;
  const parts = [reason];
  if (code) parts.push(`Student ID: ${code}`);
  if (meta.student_class) parts.push(meta.student_class);
  return parts.filter(Boolean).join(' · ');
};

const feeFailureTitle = (event) => {
  const meta = eventMeta(event);
  if (meta.student_name) return meta.student_name;
  if (meta.reason === 'student_not_found') return 'Unknown student ID';
  return 'Failed fee payment';
};

const isFailedFeeStatus = (status) => {
  const value = String(status || '').toLowerCase();
  return value === 'failed' || value === 'abandoned' || value === 'declined';
};

const previewRow = ({ id, title, description, createdAt }) => ({
  id,
  title,
  description,
  createdAt,
});

export async function getSchoolAnalytics(schoolId, options = {}) {
  const now = new Date();
  const range = normalizeAnalyticsRange(options.range);
  const { start, unit } = analyticsRangeWindow(range, now);
  const buckets = enumerateBuckets(start, now, unit);
  const known = new Set(buckets.map((bucket) => bucket.t));
  const sinceIso = start.toISOString();

  const [attendanceRes, paymentsRes, messagesRes, studentsRes, classesRes, eventsRes] = await Promise.all([
    safeQuery(
      async () => {
        const first = await supabase
          .from('attendance')
          .select('id, date, timestamp, user_name, user_type, user_label, status')
          .eq('school_id', schoolId)
          .gte('date', sinceIso.slice(0, 10))
          .order('timestamp', { ascending: false })
          .limit(2500);
        if (!first.error) return first;
        return supabase
          .from('attendance')
          .select('id, date, timestamp, user_name, user_type')
          .eq('school_id', schoolId)
          .gte('date', sinceIso.slice(0, 10))
          .order('timestamp', { ascending: false })
          .limit(2500);
      },
      { data: [] }
    ),
    safeQuery(
      () =>
        supabase
          .from('fee_payments')
          .select('id, amount, status, payer_id, payer_name, payment_method, channel, payment_month, payment_reference, created_at')
          .eq('school_id', schoolId)
          .order('created_at', { ascending: false })
          .limit(2500),
      { data: [] }
    ),
    safeQuery(
      () =>
        supabase
          .from('messages')
          .select('id, delivery_channel, created_at, recipients, sender_name')
          .eq('school_id', schoolId)
          .gte('created_at', sinceIso)
          .order('created_at', { ascending: false })
          .limit(1500),
      { data: [] }
    ),
    safeQuery(
      async () => {
        const first = await supabase
          .from('students')
          .select('id, name, class, monthly_fee')
          .eq('school_id', schoolId);
        if (!first.error) return first;
        return supabase.from('students').select('id, name, class, monthly_fee').eq('school_id', schoolId);
      },
      { data: [] }
    ),
    safeQuery(
      () => supabase.from('classes').select('name, fee_amount').eq('school_id', schoolId),
      { data: [] }
    ),
    safeQuery(async () => ({ data: await listPlatformEventsSince(start, { schoolId, limit: 2500 }) }), { data: [] }),
  ]);

  const attendance = attendanceRes.data || [];
  const payments = paymentsRes.data || [];
  const messages = messagesRes.data || [];
  const students = studentsRes.data || [];
  const classes = classesRes.data || [];
  const events = (eventsRes.data || []).filter((event) => {
    if (eventMatchesSchool(event, schoolId, students)) return true;
    if (!isFeePaymentFailure(event)) return false;
    const meta = eventMeta(event);
    if (event.school_id || meta.school_id) return false;
    return !String(meta.student_name || '').trim();
  });

  const attendanceMap = new Map();
  const feesPaidMap = new Map();
  const feesFailedMap = new Map();
  const smsDeliveredMap = new Map();
  const smsFailedMap = new Map();
  const failedLoginMap = new Map();
  const activeStaffMap = new Map();

  const inWindow = (value) => {
    const at = new Date(value);
    if (Number.isNaN(at.getTime()) || at < start) return null;
    const key = startOfUnit(at, unit).toISOString();
    if (!known.has(key)) return null;
    return { at, key };
  };

  for (const row of attendance) {
    const window = inWindow(row.timestamp || `${row.date}T12:00:00`);
    if (!window) continue;
    bump(attendanceMap, window.key);
  }

  const successfulPayments = payments.filter((row) => isSuccessfulFeeStatus(row.status));
  for (const row of successfulPayments) {
    const window = inWindow(row.created_at);
    if (!window) continue;
    bump(feesPaidMap, window.key, Number(row.amount) || 0);
  }

  const smsMessages = messages.filter((row) => String(row.delivery_channel || 'sms') !== 'email');
  const smsSentEvents = events.filter((event) => event.event_type === 'sms_sent');
  const smsFailedEvents = events.filter((event) => event.event_type === 'sms_failed');
  const failedLoginEvents = events.filter((event) => event.event_type === 'login_failed');
  const feeFailedFromEvents = events.filter(isFeePaymentFailure);
  const seenFailureKeys = new Set(
    feeFailedFromEvents.map((event) => String(eventMeta(event).reference || event.id))
  );
  const feeFailedFromPayments = payments
    .filter((row) => isFailedFeeStatus(row.status))
    .filter((row) => !seenFailureKeys.has(String(row.payment_reference || row.id)))
    .map((row) => ({
      id: row.id,
      event_type: 'payment_failed',
      created_at: row.created_at,
      path: '/fees',
      school_id: schoolId,
      meta: {
        kind: 'school_fee',
        reason: 'provider_declined',
        message: `Payment ${row.status}`,
        student_name: row.payer_name,
        student_id: row.payer_id,
        student_code: row.payer_id,
        reference: row.payment_reference,
      },
    }));
  const feeFailedEvents = [...feeFailedFromEvents, ...feeFailedFromPayments].sort(
    (a, b) => new Date(b.created_at) - new Date(a.created_at)
  );
  const staffPortalEvents = events.filter(isStaffPortalEvent);

  for (const event of smsSentEvents) {
    const window = inWindow(event.created_at);
    if (!window) continue;
    const delivered = Number(event.meta?.delivered ?? event.meta?.count);
    bump(smsDeliveredMap, window.key, Number.isFinite(delivered) && delivered > 0 ? delivered : 1);
  }

  if (![...smsDeliveredMap.values()].some((value) => value > 0)) {
    for (const row of smsMessages) {
      const window = inWindow(row.created_at);
      if (!window) continue;
      bump(smsDeliveredMap, window.key);
    }
  }

  for (const event of smsFailedEvents) {
    const window = inWindow(event.created_at);
    if (!window) continue;
    const failed = Number(event.meta?.failed);
    bump(smsFailedMap, window.key, Number.isFinite(failed) && failed > 0 ? failed : 1);
  }

  for (const event of failedLoginEvents) {
    const window = inWindow(event.created_at);
    if (!window) continue;
    bump(failedLoginMap, window.key);
  }

  for (const event of feeFailedEvents) {
    const window = inWindow(event.created_at);
    if (!window) continue;
    bump(feesFailedMap, window.key);
  }

  for (const event of staffPortalEvents) {
    const window = inWindow(event.created_at);
    if (!window) continue;
    if (!activeStaffMap.has(window.key)) activeStaffMap.set(window.key, new Set());
    activeStaffMap.get(window.key).add(staffPersonKey(event));
  }

  const classFeeByName = new Map((classes || []).map((row) => [row.name, Number(row.fee_amount) || 0]));
  let periodKey = null;
  try {
    const period = await resolveFeePeriod(schoolId);
    periodKey = period?.key || null;
  } catch {
    periodKey = null;
  }

  const totalBilled = (students || []).reduce((sum, student) => {
    return sum + resolveStudentFeeAmount(student, classFeeByName.get(student.class) || 0);
  }, 0);

  const termPayments = successfulPayments.filter((row) => !periodKey || row.payment_month === periodKey);
  const unpaidMap = new Map();
  for (const bucket of buckets) {
    const end = new Date(bucket.t);
    const paidSoFar = termPayments
      .filter((row) => new Date(row.created_at) <= end)
      .reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
    unpaidMap.set(bucket.t, roundMoney(Math.max(0, totalBilled - paidSoFar)));
  }

  const feesPaidInRange = successfulPayments
    .filter((row) => new Date(row.created_at) >= start)
    .reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
  const feesUnpaidNow = unpaidMap.get(buckets[buckets.length - 1]?.t) || 0;
  const attendanceInRange = attendance.filter((row) => {
    const at = new Date(row.timestamp || `${row.date}T12:00:00`);
    return !Number.isNaN(at.getTime()) && at >= start;
  }).length;

  const unpaidStudents = (students || [])
    .map((student) => {
      const feeAmount = resolveStudentFeeAmount(student, classFeeByName.get(student.class) || 0);
      const paid = termPayments
        .filter((row) => row.payer_id === student.id)
        .reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
      return {
        id: student.id,
        name: student.name,
        className: student.class,
        outstanding: roundMoney(Math.max(0, feeAmount - paid)),
      };
    })
    .filter((row) => row.outstanding >= 0.01)
    .sort((a, b) => b.outstanding - a.outstanding)
    .slice(0, 12);

  const latestByStaff = new Map();
  for (const event of staffPortalEvents) {
    const key = staffPersonKey(event);
    const existing = latestByStaff.get(key);
    if (!existing || new Date(event.created_at) > new Date(existing.created_at)) {
      latestByStaff.set(key, event);
    }
  }

  const nowMs = now.getTime();
  const activeStaffPreview = [...latestByStaff.values()]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 12)
    .map((event) => {
      const at = new Date(event.created_at).getTime();
      const activeNow = Number.isFinite(at) && nowMs - at <= ACTIVE_WINDOW_MS;
      return previewRow({
        id: event.id,
        title: staffDisplayName(event),
        description: `${activeNow ? 'Active now' : 'Last seen'} · ${describeStaffActivity(event)}`,
        createdAt: event.created_at,
      });
    });

  const smsFailedInRange = [...smsFailedMap.values()].reduce((sum, value) => sum + value, 0);
  const smsDeliveredInRange = [...smsDeliveredMap.values()].reduce((sum, value) => sum + value, 0);

  return {
    generatedAt: now.toISOString(),
    range,
    unit,
    start: sinceIso,
    totals: {
      attendanceInRange,
      feesPaidInRange: roundMoney(feesPaidInRange),
      feesUnpaidNow: roundMoney(feesUnpaidNow),
      feesFailedInRange: feeFailedEvents.length,
      smsDeliveredInRange,
      smsFailedInRange,
      failedLoginInRange: failedLoginEvents.length,
      activeStaffInRange: latestByStaff.size,
    },
    chart: {
      range,
      unit,
      series: {
        attendance: toPoints(buckets, attendanceMap),
        feesPaid: toPoints(buckets, feesPaidMap).map((point) => ({ ...point, value: roundMoney(point.value) })),
        feesUnpaid: toPoints(buckets, unpaidMap),
        feesFailed: toPoints(buckets, feesFailedMap),
        smsDelivered: toPoints(buckets, smsDeliveredMap),
        smsFailed: toPoints(buckets, smsFailedMap),
        failedLogin: toPoints(buckets, failedLoginMap),
        activeStaff: buckets.map((bucket) => ({
          t: bucket.t,
          label: bucket.label,
          value: activeStaffMap.get(bucket.t)?.size || 0,
        })),
      },
    },
    previews: {
      attendance: attendance.slice(0, 12).map((row) =>
        previewRow({
          id: row.id,
          title: row.user_name || 'Attendance marked',
          description: describeAttendance(row),
          createdAt: row.timestamp || row.date,
        })
      ),
      feesPaid: successfulPayments
        .filter((row) => new Date(row.created_at) >= start)
        .slice(0, 12)
        .map((row) =>
          previewRow({
            id: row.id,
            title: row.payer_name || 'Fee payment',
            description: `${row.channel || row.payment_method || 'Paystack'} · ${new Intl.NumberFormat('en-GH', {
              style: 'currency',
              currency: 'GHS',
              maximumFractionDigits: 2,
            }).format(Number(row.amount) || 0)}`,
            createdAt: row.created_at,
          })
        ),
      feesUnpaid: unpaidStudents.map((row) =>
        previewRow({
          id: row.id,
          title: row.name || 'Student',
          description: `${row.className || 'Unassigned class'} · ${new Intl.NumberFormat('en-GH', {
            style: 'currency',
            currency: 'GHS',
            maximumFractionDigits: 2,
          }).format(row.outstanding)} outstanding`,
          createdAt: null,
        })
      ),
      feesFailed: feeFailedEvents.slice(0, 12).map((row) =>
        previewRow({
          id: row.id,
          title: feeFailureTitle(row),
          description: describeFeeFailure(row),
          createdAt: row.created_at,
        })
      ),
      smsDelivered: (smsSentEvents.length ? smsSentEvents : smsMessages).slice(0, 12).map((row) => {
        if (row.event_type === 'sms_sent') {
          const delivered = Number(row.meta?.delivered ?? row.meta?.count) || 1;
          const failed = Number(row.meta?.failed) || 0;
          return previewRow({
            id: row.id,
            title: 'SMS delivered',
            description: failed
              ? `${delivered} delivered · ${failed} failed`
              : `${delivered} message${delivered === 1 ? '' : 's'} delivered`,
            createdAt: row.created_at,
          });
        }
        return previewRow({
          id: row.id,
          title: row.sender_name || 'SMS',
          description: `Sent to ${row.recipients || 'recipients'}`,
          createdAt: row.created_at,
        });
      }),
      smsFailed: smsFailedEvents.slice(0, 12).map((row) =>
        previewRow({
          id: row.id,
          title: 'SMS failed',
          description: describePlatformError(row),
          createdAt: row.created_at,
        })
      ),
      failedLogin: failedLoginEvents.slice(0, 12).map((row) =>
        previewRow({
          id: row.id,
          title: row.role === 'staff_portal' || row.meta?.source === 'staff_portal' ? 'Staff portal login failed' : 'Failed login',
          description: describePlatformError(row),
          createdAt: row.created_at,
        })
      ),
      activeStaff: activeStaffPreview,
    },
  };
}
