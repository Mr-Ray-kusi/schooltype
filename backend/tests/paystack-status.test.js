import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  isHardPaystackDecline,
  isTransientPaystackFailure,
  isPaystackUserCancelled,
} from '../paystack.js';

test('early Paystack failed without a decline reason is still waiting on the phone', () => {
  const charge = { status: 'failed', gateway_response: 'Transaction failed' };
  assert.equal(isTransientPaystackFailure(charge), true);
  assert.equal(isHardPaystackDecline(charge), false);
  assert.equal(isPaystackUserCancelled(charge), false);
});

test('a real number or funds decline is terminal', () => {
  assert.equal(
    isHardPaystackDecline({ status: 'failed', gateway_response: 'Invalid mobile money number' }),
    true
  );
  assert.equal(
    isTransientPaystackFailure({ status: 'failed', gateway_response: 'Insufficient funds' }),
    false
  );
});
