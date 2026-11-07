import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getPlan, getPlanCharge, resolveBillingInterval } from '../plans.js';
import { initializeSubscription } from '../subscription.js';
import { inferPlanIdFromAmount } from '../schoolPlanStore.js';

test('Starter, Growth, and Unlimited publish term Ghana prices', () => {
  const starter = getPlan('small');
  const growth = getPlan('mid');
  const unlimited = getPlan('large');
  assert.equal(starter.name, 'Starter');
  assert.equal(starter.termPrice, 1500);
  assert.equal(starter.price, 1500);
  assert.equal(starter.period, 'term');
  assert.equal(starter.limits.maxStudents, 300);
  assert.equal(starter.freeFirstTerm, true);
  assert.equal(growth.name, 'Growth');
  assert.equal(growth.termPrice, 2500);
  assert.equal(growth.limits.maxStudents, 1000);
  assert.equal(unlimited.name, 'Unlimited');
  assert.equal(unlimited.termPrice, 3500);
  assert.equal(unlimited.limits.maxStudents, null);
});

test('charges are always one term', () => {
  assert.equal(resolveBillingInterval('year'), 'term');
  const starter = getPlan('starter');
  assert.equal(getPlanCharge(starter).amount, 1500);
  assert.equal(getPlanCharge(starter).interval, 'term');
  assert.equal(getPlanCharge(starter).months, 4);
  assert.equal(getPlanCharge(getPlan('mid')).amount, 2500);
  assert.equal(getPlanCharge(getPlan('large')).amount, 3500);
});

test('paid amounts map back to the matching size tier', () => {
  assert.equal(inferPlanIdFromAmount(1500), 'small');
  assert.equal(inferPlanIdFromAmount(2500), 'mid');
  assert.equal(inferPlanIdFromAmount(3500), 'large');
  assert.equal(inferPlanIdFromAmount(4000), 'small');
  assert.equal(inferPlanIdFromAmount(6500), 'mid');
  assert.equal(inferPlanIdFromAmount(9000), 'large');
});

test('a Starter free term lasts four months', () => {
  const sub = initializeSubscription('2026-01-15');
  assert.equal(sub.subscription_started_at, '2026-01-15');
  assert.equal(sub.next_payment_due, '2026-05-15');
});
