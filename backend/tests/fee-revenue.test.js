import assert from 'node:assert/strict';
import { test } from 'node:test';
import { schoolRevenueFigures } from '../feePayments.js';

test('unpaid revenue is total revenue minus year collected', () => {
  const figures = schoolRevenueFigures({
    billedAmount: 1000,
    collectedAmount: 250.5,
    yearCollected: 400,
  });
  assert.equal(figures.totalRevenue, 1000);
  assert.equal(figures.feesPaid, 250.5);
  assert.equal(figures.yearCollected, 400);
  assert.equal(figures.unpaidRevenue, 600);
});

test('unpaid revenue does not go below zero when year collected exceeds total revenue', () => {
  const figures = schoolRevenueFigures({
    billedAmount: 100,
    collectedAmount: 80,
    yearCollected: 140.004,
  });
  assert.equal(figures.totalRevenue, 100);
  assert.equal(figures.feesPaid, 80);
  assert.equal(figures.yearCollected, 140);
  assert.equal(figures.unpaidRevenue, 0);
});
