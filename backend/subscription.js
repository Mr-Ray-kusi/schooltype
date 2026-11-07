import { PLAN_TERM_MONTHS } from './plans.js';

export const SUBSCRIPTION_GRACE_DAYS = 14;
export const TERM_PLAN_REMINDER_DAYS = [14, 7, 1];

export function addMonths(date, months) {
  const d = new Date(`${toDateString(date)}T12:00:00`);
  d.setMonth(d.getMonth() + months);
  return d;
}

export function toDateString(date) {
  if (!date) return null;
  if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(date)) return date.slice(0, 10);
  return new Date(date).toISOString().split('T')[0];
}

function billingMonths(months) {
  const n = Number(months);
  return Number.isFinite(n) && n >= 1 ? Math.round(n) : PLAN_TERM_MONTHS;
}

export function monthSpan(start, end) {
  const from = toDateString(start);
  const to = toDateString(end);
  if (!from || !to) return 0;
  const a = new Date(`${from}T12:00:00`);
  const b = new Date(`${to}T12:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0;
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}

/** Rewrite leftover yearly (12-month) billing windows to the current 4-month term plan. */
export function coerceYearlyBillingToTerm(school) {
  const start = school?.last_payment_at || school?.subscription_started_at;
  const end = school?.next_payment_due;
  if (!start || !end) return null;
  if (monthSpan(start, end) < 10) return null;
  const next = toDateString(addMonths(start, PLAN_TERM_MONTHS));
  if (!next || next === end) return null;
  return { next_payment_due: next };
}

export function parseDueReminderSent(value, dueDate) {
  const raw = String(value || '');
  const sep = raw.indexOf(':');
  if (sep < 0) return [];
  const due = raw.slice(0, sep);
  if (due !== dueDate) return [];
  return raw
    .slice(sep + 1)
    .split(',')
    .map((part) => Number(part))
    .filter((n) => TERM_PLAN_REMINDER_DAYS.includes(n));
}

export function formatDueReminderSent(dueDate, milestones) {
  const unique = [...new Set((milestones || []).map(Number))]
    .filter((n) => TERM_PLAN_REMINDER_DAYS.includes(n))
    .sort((a, b) => b - a);
  return `${dueDate}:${unique.join(',')}`;
}

/** Catch-up: send 14 if 8–14 days left, 7 if 2–7, 1 if 1 day left. */
export function reminderMilestoneDue(daysUntilDue, sentMilestones = []) {
  const days = Number(daysUntilDue);
  if (!Number.isFinite(days) || days < 1) return null;
  const sent = new Set((sentMilestones || []).map(Number));
  for (let i = 0; i < TERM_PLAN_REMINDER_DAYS.length; i += 1) {
    const milestone = TERM_PLAN_REMINDER_DAYS[i];
    const nextSmaller = TERM_PLAN_REMINDER_DAYS[i + 1] || 0;
    if (days <= milestone && days > nextSmaller && !sent.has(milestone)) {
      return milestone;
    }
  }
  return null;
}

/** Set when a subscription is first approved. Default is one Ghana term (four months). */
export function initializeSubscription(startDate = new Date(), { months = PLAN_TERM_MONTHS } = {}) {
  const started = toDateString(startDate);
  const period = billingMonths(months);
  return {
    subscription_started_at: started,
    last_payment_at: started,
    next_payment_due: toDateString(addMonths(started, period)),
  };
}

/**
 * Advance to the next billing period on renewal.
 */
export function renewSubscription(school, { months = PLAN_TERM_MONTHS } = {}) {
  const period = billingMonths(months);
  const periodEnd = school.next_payment_due;
  const anchor = school.subscription_started_at || school.last_payment_at;

  if (!periodEnd) {
    return initializeSubscription(anchor || new Date(), { months: period });
  }

  if (!anchor && !school.last_payment_at) {
    const started = toDateString(addMonths(periodEnd, -period));
    const newPeriodStart = periodEnd;
    const newPeriodEnd = toDateString(addMonths(periodEnd, period));
    return {
      subscription_started_at: started,
      last_payment_at: newPeriodStart,
      next_payment_due: newPeriodEnd,
    };
  }

  let periodStart = periodEnd;
  let nextEnd = toDateString(addMonths(periodEnd, period));
  const now = new Date();

  while (new Date(`${nextEnd}T23:59:59`) <= now) {
    periodStart = nextEnd;
    nextEnd = toDateString(addMonths(nextEnd, period));
  }

  return {
    subscription_started_at: anchor || periodStart,
    last_payment_at: periodStart,
    next_payment_due: nextEnd,
  };
}

function withAccess(base, extra) {
  const frozen = extra.reason === 'frozen';
  const overdue = extra.reason === 'overdue';
  const writable = extra.subscription_active && extra.reason !== 'overdue' && extra.reason !== 'frozen';
  return {
    ...base,
    ...extra,
    subscription_read_only: Boolean(frozen || overdue || extra.subscription_read_only),
    can_record_fees: Boolean(!frozen && (writable || overdue || extra.can_record_fees)),
  };
}

export function getSubscriptionInfo(school) {
  const frozen = school.subscription_frozen === true || school.subscription_frozen === 1;
  const planApproved = (school.plan_status || 'pending') === 'approved';
  const nextPaymentDue = school.next_payment_due || null;
  const lastPaymentAt = school.last_payment_at || null;
  const subscriptionStartedAt = school.subscription_started_at || lastPaymentAt || null;

  const base = {
    subscription_frozen: frozen,
    subscription_started_at: subscriptionStartedAt,
    next_payment_due: nextPaymentDue,
    last_payment_at: lastPaymentAt,
    grace_days: SUBSCRIPTION_GRACE_DAYS,
  };

  if (!planApproved) {
    return withAccess(base, {
      subscription_active: false,
      reason: 'not_approved',
      in_grace_period: false,
      days_past_due: 0,
      days_until_due: null,
      subscription_read_only: true,
      can_record_fees: false,
    });
  }

  if (frozen) {
    return withAccess(base, {
      subscription_active: false,
      reason: 'frozen',
      in_grace_period: false,
      days_past_due: nextPaymentDue ? daysPastDue(nextPaymentDue) : 0,
      days_until_due: nextPaymentDue ? daysUntilDue(nextPaymentDue) : null,
      subscription_read_only: true,
      can_record_fees: false,
    });
  }

  if (!nextPaymentDue) {
    return withAccess(base, {
      subscription_active: true,
      reason: 'no_billing_date',
      in_grace_period: false,
      days_past_due: 0,
      days_until_due: null,
      subscription_read_only: false,
      can_record_fees: true,
    });
  }

  const now = new Date();
  const due = new Date(`${nextPaymentDue}T23:59:59`);
  const pastDue = daysPastDue(nextPaymentDue);
  const untilDue = daysUntilDue(nextPaymentDue);

  if (now > due) {
    return withAccess(base, {
      subscription_active: true,
      reason: 'overdue',
      in_grace_period: false,
      days_past_due: pastDue,
      days_until_due: untilDue,
      subscription_read_only: true,
      can_record_fees: true,
    });
  }

  return withAccess(base, {
    subscription_active: true,
    reason: 'current',
    in_grace_period: false,
    days_past_due: pastDue,
    days_until_due: untilDue,
    subscription_read_only: false,
    can_record_fees: true,
  });
}

function daysPastDue(dueDateStr) {
  const due = new Date(`${dueDateStr}T23:59:59`);
  const now = new Date();
  if (now <= due) return 0;
  return Math.floor((now - due) / (1000 * 60 * 60 * 24));
}

function daysUntilDue(dueDateStr) {
  const due = new Date(`${dueDateStr}T23:59:59`);
  const now = new Date();
  const diff = Math.ceil((due - now) / (1000 * 60 * 60 * 24));
  return diff;
}
