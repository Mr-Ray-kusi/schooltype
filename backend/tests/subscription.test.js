import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  coerceYearlyBillingToTerm,
  getSubscriptionInfo,
  reminderMilestoneDue,
  parseDueReminderSent,
  formatDueReminderSent,
  initializeSubscription,
} from '../subscription.js';
import { isFeeRecordingRequest, isReadOnlyExemptRequest } from '../subscriptionAccess.js';

test('yearly 12-month windows collapse to a four-month term', () => {
  const next = coerceYearlyBillingToTerm({
    last_payment_at: '2026-01-15',
    next_payment_due: '2027-01-15',
  });
  assert.equal(next.next_payment_due, '2026-05-15');
  assert.equal(
    coerceYearlyBillingToTerm({
      last_payment_at: '2026-01-15',
      next_payment_due: '2026-05-15',
    }),
    null
  );
});

test('after the term ends the school stays viewable and can record fees', () => {
  const info = getSubscriptionInfo({
    plan_status: 'approved',
    last_payment_at: '2025-01-01',
    next_payment_due: '2025-05-01',
  });
  assert.equal(info.subscription_active, true);
  assert.equal(info.subscription_read_only, true);
  assert.equal(info.can_record_fees, true);
  assert.equal(info.reason, 'overdue');
});

test('a current term stays writable', () => {
  const sub = initializeSubscription('2099-01-15');
  const info = getSubscriptionInfo({
    plan_status: 'approved',
    ...sub,
  });
  assert.equal(info.subscription_read_only, false);
  assert.equal(info.can_record_fees, true);
  assert.equal(info.reason, 'current');
});

test('reminders fire at 14, 7, and 1 days and catch a missed day', () => {
  assert.equal(reminderMilestoneDue(14, []), 14);
  assert.equal(reminderMilestoneDue(10, []), 14);
  assert.equal(reminderMilestoneDue(10, [14]), null);
  assert.equal(reminderMilestoneDue(7, [14]), 7);
  assert.equal(reminderMilestoneDue(1, [14, 7]), 1);
  assert.equal(reminderMilestoneDue(0, [14, 7, 1]), null);
  const packed = formatDueReminderSent('2026-05-15', [14, 7]);
  assert.deepEqual(parseDueReminderSent(packed, '2026-05-15'), [14, 7]);
  assert.deepEqual(parseDueReminderSent(packed, '2026-09-15'), []);
});

test('fee recording stays allowed while other writes and downloads do not', () => {
  assert.equal(isFeeRecordingRequest({ method: 'POST', path: '/api/fees/manual' }), true);
  assert.equal(isReadOnlyExemptRequest({ method: 'GET', path: '/api/students' }), true);
  assert.equal(isReadOnlyExemptRequest({ method: 'GET', path: '/api/attendance/export/students' }), false);
  assert.equal(isReadOnlyExemptRequest({ method: 'POST', path: '/api/students' }), false);
  assert.equal(isReadOnlyExemptRequest({ method: 'POST', path: '/api/payroll/pay' }), false);
  assert.equal(isReadOnlyExemptRequest({ method: 'POST', path: '/api/wallet/deposit' }), false);
  assert.equal(isReadOnlyExemptRequest({ method: 'POST', path: '/api/fees/manual' }), true);
});
