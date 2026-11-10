import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.WALLET_STORE = 'local';

const {
  creditInternalFunds,
  reserveWithdrawal,
  createWalletTransaction,
  completeWithdrawal,
  failWithdrawal,
  getWallet,
  getWalletTransactionByReference,
} = await import('../schoolWalletStore.js');

process.env.WALLET_STORE = 'local';

function schoolId(label) {
  return `wallet-${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

test('the same wallet credit reference is applied once', async () => {
  const id = schoolId('credit');
  const reference = `fee_${id}`;
  const first = await creditInternalFunds(id, 4500, { reference, description: 'School fees' });
  const second = await creditInternalFunds(id, 4500, { reference, description: 'School fees' });
  assert.equal(first.wallet.available_balance, 4500);
  assert.equal(second.wallet.available_balance, 4500);
  assert.equal(second.transaction.status, 'success');
});

test('overlapping withdrawal webhooks release pending funds once', async () => {
  const id = schoolId('withdraw');
  await creditInternalFunds(id, 9000, { reference: `seed_${id}`, description: 'Opening balance' });
  await reserveWithdrawal(id, 3000);
  await createWalletTransaction(id, {
    type: 'withdrawal',
    amount: 3000,
    status: 'processing',
    reference: `wd_a_${id}`,
  });
  await reserveWithdrawal(id, 3000);
  await createWalletTransaction(id, {
    type: 'withdrawal',
    amount: 3000,
    status: 'processing',
    reference: `wd_b_${id}`,
  });

  const results = await Promise.allSettled([
    completeWithdrawal(`wd_a_${id}`),
    completeWithdrawal(`wd_a_${id}`),
  ]);
  assert.equal(results.filter((row) => row.status === 'rejected').length, 0);

  const wallet = await getWallet(id);
  const finished = await getWalletTransactionByReference(`wd_a_${id}`);
  const stillOpen = await getWalletTransactionByReference(`wd_b_${id}`);
  assert.equal(wallet.available_balance, 3000);
  assert.equal(wallet.pending_balance, 3000);
  assert.equal(finished.status, 'success');
  assert.equal(stillOpen.status, 'processing');
});

test('a failed withdrawal returns the reserved money once', async () => {
  const id = schoolId('fail');
  await creditInternalFunds(id, 9000, { reference: `seed_${id}`, description: 'Opening balance' });
  await reserveWithdrawal(id, 3000);
  await createWalletTransaction(id, {
    type: 'withdrawal',
    amount: 3000,
    status: 'processing',
    reference: `wd_${id}`,
    description: 'MoMo payout',
  });

  const results = await Promise.allSettled([
    failWithdrawal(`wd_${id}`, 'Transfer failed'),
    failWithdrawal(`wd_${id}`, 'Transfer failed'),
  ]);
  assert.equal(results.filter((row) => row.status === 'rejected').length, 0);

  const wallet = await getWallet(id);
  const tx = await getWalletTransactionByReference(`wd_${id}`);
  assert.equal(wallet.available_balance, 9000);
  assert.equal(wallet.pending_balance, 0);
  assert.equal(tx.status, 'failed');
  assert.equal(tx.description, 'Transfer failed');
});
