import assert from 'node:assert/strict';
import { test } from 'node:test';
import { schoolRevenueFigures } from '../feePayments.js';

test('unpaid revenue is total revenue minus collected fees', () => {
  const figures = schoolRevenueFigures({ billedAmount: 1000, collectedAmount: 250.5 });
  assert.equal(figures.totalRevenue, 1000);
  assert.equal(figures.feesPaid, 250.5);
  assert.equal(figures.unpaidRevenue, 749.5);
});

test('unpaid revenue does not go below zero when collections exceed the bill', () => {
  const figures = schoolRevenueFigures({ billedAmount: 100, collectedAmount: 140.004 });
  assert.equal(figures.totalRevenue, 100);
  assert.equal(figures.feesPaid, 140);
  assert.equal(figures.unpaidRevenue, 0);
});
