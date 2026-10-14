import { randomUUID } from 'crypto';
import {
  getPaystackConfig,
  listBanks,
  resolveAccountNumber,
  createTransferRecipient,
  createSubaccount,
  chargeMobileMoney,
  verifyTransaction,
  initiateTransfer,
  verifyPaystackSignature,
  toMinorUnits,
  fromMinorUnits,
  momoProviderFromBankCode,
  normalizeGhanaPhone,
} from './paystack.js';
import {
  ensureWallet,
  getWallet,
  listWalletAccounts,
  getWalletAccount,
  createWalletAccount,
  updateWalletAccount,
  deleteWalletAccount,
  createWalletTransaction,
  getWalletTransactionByReference,
  listWalletTransactions,
  updateWalletTransaction,
  creditDeposit,
  creditInternalFunds,
  deleteWalletTransactionsByReferences,
  setWalletBalances,
  isRealPlatformRevenueReference,
  isFakeOrDemoWalletTx,
  ledgerBalancesFromTransactions,
  reserveWithdrawal,
  completeWithdrawal,
  failWithdrawal,
  makeWalletReference,
} from './schoolWalletStore.js';
import { parsePaystackMetadata, settleSchoolFeeFromPaystack, syncSchoolFeeCredits } from './feePayments.js';
import { recordPlatformEvent } from './platformTelemetry.js';
import { findPlatformSchoolId } from './smsBilling.js';
import { claimPlatformLedgerRebuild, clearDemoMoneyBaseline } from './platformSmsStore.js';
import { supabase } from './supabaseClient.js';
import { mergeSchoolWithExtras, upsertSchoolExtras, replaceSchoolSubscriptionPayments } from './schoolPlanStore.js';
import { getPlan } from './plans.js';

function formatMoney(wallet) {
  return {
    ...wallet,
    available_balance_major: fromMinorUnits(wallet.available_balance),
    pending_balance_major: fromMinorUnits(wallet.pending_balance),
  };
}

function feeSourceTotals(transactions) {
  let onlineMinor = 0;
  let cashedMinor = 0;
  for (const tx of transactions || []) {
    if (String(tx.status || '') !== 'success') continue;
    const type = String(tx.type || '');
    if (type !== 'credit' && type !== 'deposit') continue;
    const label = formatTransaction(tx)?.source_label;
    const amount = Number(tx.amount) || 0;
    if (label === 'Cashed') cashedMinor += amount;
    else if (label === 'Paid online') onlineMinor += amount;
  }
  return {
    paid_online_major: fromMinorUnits(onlineMinor),
    cashed_major: fromMinorUnits(cashedMinor),
  };
}

function formatTransaction(tx) {
  if (!tx) return null;
  const metadata = parsePaystackMetadata(tx.metadata);
  const source = metadata.source;
  const description = String(tx.description || '');
  const sourceLabel =
    source === 'cashed' || /cashed/i.test(description)
      ? 'Cashed'
      : source === 'online' || metadata.kind === 'school_fee' || /paid online/i.test(description)
        ? 'Paid online'
        : null;
  return {
    ...tx,
    metadata,
    amount_major: fromMinorUnits(tx.amount),
    fee_major: fromMinorUnits(tx.fee),
    source_label: sourceLabel,
  };
}

export async function getRecordedSubscriptionRevenueMinor() {
  const { data: schools, error } = await supabase
    .from('schools')
    .select('id, role, total_paid, payment_plan, plan_status');
  if (error) throw error;
  let totalMajor = 0;
  for (const school of schools || []) {
    if (String(school.role || '') === 'super_admin') continue;
    totalMajor += Number(mergeSchoolWithExtras(school).total_paid) || 0;
  }
  return Math.round(totalMajor * 100);
}

function isInboundCredit(tx) {
  const type = String(tx?.type || '');
  return type === 'credit' || type === 'deposit';
}

function pickSignupKeepers(transactions) {
  const real = (transactions || []).filter((tx) => {
    if (String(tx.status || '') !== 'success' || !isInboundCredit(tx)) return false;
    if (isFakeOrDemoWalletTx(tx)) return false;
    return isRealPlatformRevenueReference(tx.reference);
  });
  const signup = real
    .filter(
      (tx) =>
        /^(signup_|splan_)/i.test(String(tx.reference || '')) ||
        tx.metadata?.kind === 'subscription_payment'
    )
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const tenCedis = signup.filter((tx) => Number(tx.amount) === 1000);
  if (tenCedis.length) return [tenCedis[0]];
  if (signup.length) return [signup[0]];
  const fallback = (transactions || [])
    .filter(
      (tx) =>
        String(tx.status || '') === 'success' &&
        isInboundCredit(tx) &&
        Number(tx.amount) === 1000
    )
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  return fallback.slice(0, 1);
}

async function rewriteSchoolTotalsFromKeepers(tenantSchools, keepers) {
  const paidBySchool = new Map();
  for (const tx of keepers) {
    const schoolId = tx.metadata?.from_school_id;
    if (!schoolId) continue;
    const list = paidBySchool.get(schoolId) || [];
    list.push({
      amount: fromMinorUnits(tx.amount),
      plan_id: tx.metadata?.plan_id || null,
      recorded_at: tx.created_at,
      source: 'paystack',
      reference: tx.reference,
    });
    paidBySchool.set(schoolId, list);
  }

  if (!paidBySchool.size && keepers.length === 1 && tenantSchools.length) {
    const paidSchools = tenantSchools.filter((school) => Number(mergeSchoolWithExtras(school).total_paid) > 0);
    const target = paidSchools[0] || tenantSchools[0];
    const merged = mergeSchoolWithExtras(target);
    const plan = getPlan(merged.payment_plan);
    paidBySchool.set(target.id, [
      {
        amount: fromMinorUnits(keepers[0].amount),
        plan_id: merged.payment_plan || null,
        plan_name: plan?.name || null,
        recorded_at: keepers[0].created_at,
        source: 'paystack',
        reference: keepers[0].reference,
      },
    ]);
  }

  for (const school of tenantSchools) {
    const records = paidBySchool.get(school.id) || [];
    const total = records.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    await replaceSchoolSubscriptionPayments(school.id, records);
    await upsertSchoolExtras(school.id, { total_paid: total });
  }
}

async function creditMissingRealPayments(tenantSchools, platformSchoolId) {
  for (const school of tenantSchools) {
    const merged = mergeSchoolWithExtras(school);
    const plan = getPlan(merged.payment_plan);
    for (const record of merged.payment_records || []) {
      const reference = record.reference;
      if (!isRealPlatformRevenueReference(reference)) continue;
      const amountMinor = Math.round(Number(record.amount || plan?.price || 0) * 100);
      if (amountMinor <= 0) continue;
      await creditInternalFunds(platformSchoolId, amountMinor, {
        reference,
        description: `Subscription payment · ${merged.name || 'school'}`,
        metadata: {
          kind: 'subscription_payment',
          from_school_id: school.id,
          plan_id: record.plan_id || merged.payment_plan || null,
        },
      });
    }
  }
}

let ledgerSync = null;

export async function rebuildPlatformRevenueLedger() {
  const platformSchoolId = await findPlatformSchoolId(supabase);
  if (!platformSchoolId) return;
  await ensureWallet(platformSchoolId);

  const { data: schools, error } = await supabase.from('schools').select('*');
  if (error) throw error;
  const tenantSchools = (schools || []).filter((school) => String(school.role || '') !== 'super_admin');
  const transactions = await listWalletTransactions(platformSchoolId, { limit: 5000 });
  const claimed = await claimPlatformLedgerRebuild();

  if (claimed) {
    try {
      await clearDemoMoneyBaseline();
    } catch (err) {
      console.warn('Could not clear demo revenue baseline:', err.message || err);
    }
    const keepers = pickSignupKeepers(transactions);
    const keepRefs = new Set(keepers.map((tx) => tx.reference).filter(Boolean));
    const drop = transactions
      .map((tx) => tx.reference)
      .filter((reference) => reference && !keepRefs.has(reference));
    await deleteWalletTransactionsByReferences(drop);
    const remaining = transactions.filter((tx) => keepRefs.has(tx.reference));
    await setWalletBalances(platformSchoolId, ledgerBalancesFromTransactions(remaining));
    await rewriteSchoolTotalsFromKeepers(tenantSchools, remaining);
    return;
  }

  const fake = transactions.filter(isFakeOrDemoWalletTx);
  if (fake.length) {
    await deleteWalletTransactionsByReferences(fake.map((tx) => tx.reference));
  }
  await creditMissingRealPayments(tenantSchools, platformSchoolId);
  const remaining = await listWalletTransactions(platformSchoolId, { limit: 5000 });
  const live = remaining.filter((tx) => !isFakeOrDemoWalletTx(tx));
  await setWalletBalances(platformSchoolId, ledgerBalancesFromTransactions(live));
}

async function syncPlatformWalletFromRealPayments() {
  if (ledgerSync) return ledgerSync;
  ledgerSync = rebuildPlatformRevenueLedger().finally(() => {
    ledgerSync = null;
  });
  return ledgerSync;
}

function sendStoreError(res, err, fallback) {
  console.error(fallback, err);
  const status = Number(err.status) || 500;
  const expose = status === 400 || status === 503;
  return res.status(status >= 400 ? status : 500).json({
    error: expose && err.message ? err.message : fallback,
  });
}

function handlePaystackError(res, err) {
  const rawMessage = err.message || 'Paystack request failed';
  // Never show Paystack's internal success phrasing as an error toast
  const friendly =
    /charge attempted/i.test(rawMessage)
      ? 'Payment prompt sent. Approve it on your phone to complete the deposit.'
      : rawMessage;
  const status = err.status || 500;
  return res.status(status >= 400 ? status : 502).json({
    error: friendly,
    code: err.code || 'PAYSTACK_ERROR',
    details: err.payload || undefined,
  });
}

export function registerWalletRoutes(app, { authenticateToken, enforcePlanApproval, onSchoolCheckoutPaid }) {
  app.get('/api/wallet', authenticateToken, enforcePlanApproval, async (req, res) => {
    try {
      const schoolId = req.user.schoolId;
      const { currency } = getPaystackConfig();
      await ensureWallet(schoolId, currency);
      try {
        await syncSchoolFeeCredits(schoolId);
      } catch (syncErr) {
        console.warn('School fee wallet sync failed:', syncErr.message || syncErr);
      }
      const platformSchoolId = await findPlatformSchoolId(supabase);
      if (platformSchoolId && schoolId === platformSchoolId) {
        try {
          await syncPlatformWalletFromRealPayments();
        } catch (syncErr) {
          console.warn('Platform revenue wallet sync failed:', syncErr.message || syncErr);
        }
      }
      const [wallet, accounts, transactions] = await Promise.all([
        getWallet(schoolId),
        listWalletAccounts(schoolId),
        listWalletTransactions(schoolId, { limit: 5000 }),
      ]);

      res.json({
        wallet: {
          ...formatMoney(wallet),
          ...feeSourceTotals(transactions),
        },
        accounts,
        transactions: transactions.slice(0, 20).map(formatTransaction),
        paystack: {
          configured: getPaystackConfig().configured,
          public_key: getPaystackConfig().publicKey || null,
          currency: getPaystackConfig().currency,
        },
      });
    } catch (err) {
      sendStoreError(res, err, 'Failed to load wallet');
    }
  });

  app.get('/api/wallet/banks', authenticateToken, enforcePlanApproval, async (req, res) => {
    try {
      const type = req.query.type === 'mobile_money' ? 'mobile_money' : undefined;
      const { currency } = getPaystackConfig();
      const banks = await listBanks({ currency, type });
      res.json({ banks: banks || [] });
    } catch (err) {
      handlePaystackError(res, err);
    }
  });

  app.get('/api/wallet/accounts', authenticateToken, enforcePlanApproval, async (req, res) => {
    try {
      const accounts = await listWalletAccounts(req.user.schoolId);
      res.json({ accounts });
    } catch (err) {
      sendStoreError(res, err, 'Failed to load bank settings');
    }
  });

  app.post('/api/wallet/accounts', authenticateToken, enforcePlanApproval, async (req, res) => {
    try {
      const schoolId = req.user.schoolId;
      const {
        type,
        label,
        account_name,
        account_number,
        bank_code,
        bank_name,
        is_default,
        resolve = true,
      } = req.body || {};

      if (!type || !['bank', 'mobile_money'].includes(type)) {
        return res.status(400).json({ error: 'type must be bank or mobile_money' });
      }
      if (!account_name || !account_number || !bank_code) {
        return res.status(400).json({ error: 'account_name, account_number, and bank_code are required' });
      }

      const { currency, configured } = getPaystackConfig();
      let resolvedName = account_name;
      let provider = type === 'mobile_money' ? momoProviderFromBankCode(bank_code) : null;
      let recipientCode = null;
      let subaccountCode = null;

      if (configured && type === 'bank' && resolve) {
        try {
          const resolved = await resolveAccountNumber({
            accountNumber: account_number,
            bankCode: bank_code,
          });
          if (resolved?.account_name) resolvedName = resolved.account_name;
        } catch (err) {
          // Ghana resolve may not always be available; continue with provided name
          console.warn('Account resolve skipped:', err.message);
        }
      }

      if (configured) {
        const recipientType = type === 'mobile_money' ? 'mobile_money' : 'ghipss';
        const recipient = await createTransferRecipient({
          type: recipientType,
          name: resolvedName,
          accountNumber: account_number,
          bankCode: bank_code,
          currency,
        });
        recipientCode = recipient?.recipient_code || null;
        if (type === 'mobile_money' && !provider) {
          provider = momoProviderFromBankCode(bank_code);
        }
        try {
          const schoolName = req.user?.schoolName || req.user?.name || resolvedName;
          const sub = await createSubaccount({
            businessName: schoolName || resolvedName,
            bankCode: bank_code,
            accountNumber: account_number,
            description: `Schootype fees · ${schoolName || schoolId}`,
          });
          subaccountCode = sub?.subaccount_code || null;
        } catch (err) {
          console.warn('Paystack subaccount create skipped:', err.message);
        }
      }

      const account = await createWalletAccount(schoolId, {
        type,
        label: label || (type === 'mobile_money' ? 'MoMo' : 'Bank account'),
        account_name: resolvedName,
        account_number: String(account_number).trim(),
        bank_code: String(bank_code).trim(),
        bank_name: bank_name || null,
        provider,
        currency,
        paystack_recipient_code: recipientCode,
        paystack_subaccount_code: subaccountCode,
        is_default: Boolean(is_default),
      });

      res.status(201).json({
        account,
        warning: configured
          ? null
          : 'Saved locally. Set PAYSTACK_SECRET_KEY to enable Paystack deposits and withdrawals.',
      });
    } catch (err) {
      if (err.code?.startsWith('PAYSTACK') || err.status) return handlePaystackError(res, err);
      console.error('Create wallet account error:', err);
      res.status(500).json({ error: 'Failed to save bank settings' });
    }
  });

  app.patch('/api/wallet/accounts/:id', authenticateToken, enforcePlanApproval, async (req, res) => {
    try {
      const schoolId = req.user.schoolId;
      const account = await getWalletAccount(schoolId, req.params.id);
      if (!account) return res.status(404).json({ error: 'Account not found' });

      const patch = {};
      if (req.body.label !== undefined) patch.label = req.body.label;
      if (req.body.is_default) patch.is_default = true;

      const updated = await updateWalletAccount(schoolId, req.params.id, patch);
      res.json({ account: updated });
    } catch (err) {
      console.error('Update wallet account error:', err);
      res.status(500).json({ error: 'Failed to update bank settings' });
    }
  });

  app.delete('/api/wallet/accounts/:id', authenticateToken, enforcePlanApproval, async (req, res) => {
    try {
      const deleted = await deleteWalletAccount(req.user.schoolId, req.params.id);
      if (!deleted) return res.status(404).json({ error: 'Account not found' });
      res.json({ success: true });
    } catch (err) {
      console.error('Delete wallet account error:', err);
      res.status(500).json({ error: 'Failed to delete bank settings' });
    }
  });

  app.post('/api/wallet/deposit', authenticateToken, enforcePlanApproval, async (req, res) => {
    try {
      const schoolId = req.user.schoolId;
      const { account_id, amount } = req.body || {};
      const amountMajor = Number(amount);

      if (!account_id) return res.status(400).json({ error: 'account_id is required' });
      if (!Number.isFinite(amountMajor) || amountMajor < 1) {
        return res.status(400).json({ error: 'Minimum deposit is 1.00' });
      }

      const account = await getWalletAccount(schoolId, account_id);
      if (!account) return res.status(404).json({ error: 'Select a saved MoMo account first' });

      if (account.type !== 'mobile_money') {
        return res.status(400).json({
          error: 'Wallet deposits are MoMo only. Select a Mobile Money account, then confirm the payment on your phone.',
        });
      }

      const { currency, configured } = getPaystackConfig();
      if (!configured) {
        return res.status(503).json({
          error: 'Paystack is not configured. Add PAYSTACK_SECRET_KEY to backend/.env',
        });
      }

      const provider = account.provider || momoProviderFromBankCode(account.bank_code);
      if (!provider) {
        return res.status(400).json({
          error: 'MoMo provider is missing. Re-save this account in Bank Settings.',
        });
      }

      const phone = normalizeGhanaPhone(account.account_number);
      if (!/^0\d{9}$/.test(phone)) {
        return res.status(400).json({
          error: 'MoMo number looks invalid. Use a Ghana number like 0551234567.',
        });
      }

      const amountMinor = toMinorUnits(amountMajor);
      const reference = makeWalletReference('dep');
      const email = req.user.email;
      const metadata = {
        school_id: schoolId,
        account_id: account.id,
        wallet_action: 'deposit',
        channel: 'mobile_money',
        phone,
        provider,
      };

      await createWalletTransaction(schoolId, {
        type: 'deposit',
        amount: amountMinor,
        status: 'pending',
        channel: 'mobile_money',
        account_id: account.id,
        reference,
        description: `MoMo deposit from ${account.label || account.bank_name || phone}`,
        metadata,
      });

      const charge = await chargeMobileMoney({
        email,
        amountMinor,
        currency,
        phone,
        provider,
        reference,
        metadata,
      });

      const paystackStatus = charge?.status || 'pay_offline';
      const displayText =
        charge?.display_text ||
        `A payment prompt was sent to ${phone}. Open the MoMo message on your phone and approve to complete the deposit.`;

      // "Charge attempted" is Paystack's success message for starting MoMo — never surface it as an error.
      const awaitingConfirmation = !['success', 'failed', 'timeout', 'abandoned'].includes(
        String(paystackStatus).toLowerCase()
      );

      await updateWalletTransaction(reference, {
        provider_reference: charge?.reference || reference,
        metadata: {
          display_text: displayText,
          paystack_status: paystackStatus,
          paystack_message: charge?._paystack_message || null,
          phone,
          provider,
        },
      });

      if (String(paystackStatus).toLowerCase() === 'success') {
        await creditDeposit(reference);
      }

      if (String(paystackStatus).toLowerCase() === 'failed') {
        await updateWalletTransaction(reference, { status: 'failed' });
        recordPlatformEvent({
          eventType: 'payment_failed',
          schoolId,
          email: req.user.email,
          role: req.user.role,
          path: '/school-wallet',
          meta: {
            reason: 'provider_declined',
            message: displayText || 'MoMo payment declined',
            reference,
            channel: 'mobile_money',
          },
        }).catch(() => {});
        return res.status(400).json({
          error: displayText || 'MoMo payment failed. Try again.',
          reference,
          status: paystackStatus,
        });
      }

      return res.json({
        mode: 'mobile_money',
        reference,
        status: paystackStatus,
        awaiting_confirmation: awaitingConfirmation,
        display_text: displayText,
        phone,
        provider,
        transaction: formatTransaction(await getWalletTransactionByReference(reference)),
        wallet:
          String(paystackStatus).toLowerCase() === 'success'
            ? formatMoney(await getWallet(schoolId))
            : undefined,
      });
    } catch (err) {
      if (err.code?.startsWith('PAYSTACK') || err.status) return handlePaystackError(res, err);
      console.error('Deposit error:', err);
      res.status(500).json({ error: 'Failed to start deposit' });
    }
  });

  const pendingWithdrawals = new Map();

  async function saveWithdrawalApproval(row) {
    pendingWithdrawals.set(row.id, row);
    if (!supabase) return;
    const { error } = await supabase.from('withdrawal_approvals').insert([
      {
        id: row.id,
        school_id: row.school_id,
        reference: row.reference,
        amount_minor: row.amount_minor,
        account_id: row.account_id,
        requested_by: row.requested_by,
        status: 'pending',
      },
    ]);
    if (error && error.code !== '42P01' && error.code !== '23505') {
      console.warn('Withdrawal approval persist failed:', error.message);
    }
  }

  async function loadWithdrawalApproval(schoolId, id) {
    const cached = pendingWithdrawals.get(id);
    if (cached && cached.school_id === schoolId) return cached;
    if (!supabase) return null;
    const { data, error } = await supabase
      .from('withdrawal_approvals')
      .select('*')
      .eq('id', id)
      .eq('school_id', schoolId)
      .maybeSingle();
    if (error || !data) return null;
    pendingWithdrawals.set(id, data);
    return data;
  }

  async function markWithdrawalConfirmed(id, confirmedBy) {
    const now = new Date().toISOString();
    const cached = pendingWithdrawals.get(id);
    if (cached) pendingWithdrawals.set(id, { ...cached, status: 'confirmed', confirmed_by: confirmedBy, confirmed_at: now });
    if (!supabase) return;
    await supabase
      .from('withdrawal_approvals')
      .update({ status: 'confirmed', confirmed_by: confirmedBy, confirmed_at: now })
      .eq('id', id);
  }

  app.post('/api/wallet/withdraw', authenticateToken, enforcePlanApproval, async (req, res) => {
    try {
      const schoolId = req.user.schoolId;
      const { account_id, amount, reason, confirm, approval_id } = req.body || {};
      const amountMajor = Number(amount);

      if (confirm && approval_id) {
        return res.status(400).json({ error: 'Use POST /api/wallet/withdraw/:id/confirm to send the money.' });
      }

      if (!account_id) return res.status(400).json({ error: 'account_id is required' });
      if (!Number.isFinite(amountMajor) || amountMajor < 1) {
        return res.status(400).json({ error: 'Minimum withdrawal is 1.00' });
      }

      const account = await getWalletAccount(schoolId, account_id);
      if (!account) return res.status(404).json({ error: 'Select a saved bank or MoMo account first' });

      const { configured } = getPaystackConfig();
      if (!configured) {
        return res.status(503).json({
          error: 'Paystack is not configured. Add PAYSTACK_SECRET_KEY to backend/.env',
        });
      }
      if (!account.paystack_recipient_code) {
        return res.status(400).json({
          error: 'This account has no Paystack recipient. Delete and re-add it after configuring Paystack.',
        });
      }

      const approval = {
        id: randomUUID(),
        school_id: schoolId,
        reference: makeWalletReference('wdr'),
        amount_minor: toMinorUnits(amountMajor),
        amount_major: amountMajor,
        account_id: account.id,
        requested_by: req.user.email || req.user.schoolId,
        reason: reason || `Withdrawal to ${account.label || account.bank_name || account.type}`,
        status: 'pending',
      };
      await saveWithdrawalApproval(approval);

      return res.json({
        status: 'awaiting_confirmation',
        approval_id: approval.id,
        reference: approval.reference,
        amount: amountMajor,
        display_text: 'Confirm this withdrawal. Money leaves the wallet only after the second confirmation.',
      });
    } catch (err) {
      if (err.status === 400) return res.status(400).json({ error: err.message });
      console.error('Withdraw request error:', err);
      res.status(500).json({ error: 'Failed to start withdrawal' });
    }
  });

  app.post('/api/wallet/withdraw/:id/confirm', authenticateToken, enforcePlanApproval, async (req, res) => {
    try {
      const schoolId = req.user.schoolId;
      const approval = await loadWithdrawalApproval(schoolId, req.params.id);
      if (!approval) return res.status(404).json({ error: 'Withdrawal request not found' });
      if (approval.status && approval.status !== 'pending') {
        return res.status(409).json({ error: 'This withdrawal was already confirmed or cancelled.' });
      }

      const account = await getWalletAccount(schoolId, approval.account_id);
      if (!account) return res.status(404).json({ error: 'Select a saved bank or MoMo account first' });

      const { currency, configured } = getPaystackConfig();
      if (!configured) {
        return res.status(503).json({
          error: 'Paystack is not configured. Add PAYSTACK_SECRET_KEY to backend/.env',
        });
      }

      const amountMinor = Number(approval.amount_minor);
      const reference = approval.reference || makeWalletReference('wdr');
      const confirmedBy = req.user.email || req.user.schoolId;

      await markWithdrawalConfirmed(approval.id, confirmedBy);
      await reserveWithdrawal(schoolId, amountMinor);
      await createWalletTransaction(schoolId, {
        type: 'withdrawal',
        amount: amountMinor,
        status: 'processing',
        channel: account.type,
        account_id: account.id,
        reference,
        description: approval.reason || `Withdrawal to ${account.label || account.bank_name || account.type}`,
        metadata: {
          school_id: schoolId,
          account_id: account.id,
          wallet_action: 'withdrawal',
          requested_by: approval.requested_by,
          confirmed_by: confirmedBy,
        },
      });

      try {
        const transfer = await initiateTransfer({
          amountMinor,
          currency,
          recipientCode: account.paystack_recipient_code,
          reference,
          reason: approval.reason || 'School wallet withdrawal',
        });

        await updateWalletTransaction(reference, {
          provider_reference: transfer?.transfer_code || transfer?.reference || reference,
          metadata: { paystack_status: transfer?.status, confirmed_by: confirmedBy },
        });

        if (transfer?.status === 'success') {
          await completeWithdrawal(reference);
        }

        return res.json({
          reference,
          status: transfer?.status || 'pending',
          confirmed_by: confirmedBy,
          wallet: formatMoney(await getWallet(schoolId)),
          transaction: formatTransaction(await getWalletTransactionByReference(reference)),
        });
      } catch (transferErr) {
        await failWithdrawal(reference, transferErr.message);
        return handlePaystackError(res, transferErr);
      }
    } catch (err) {
      if (err.status === 400) return res.status(400).json({ error: err.message });
      if (err.code?.startsWith('PAYSTACK') || err.status) return handlePaystackError(res, err);
      console.error('Withdraw confirm error:', err);
      res.status(500).json({ error: 'Failed to confirm withdrawal' });
    }
  });

  app.get('/api/wallet/transactions', authenticateToken, enforcePlanApproval, async (req, res) => {
    try {
      const platformSchoolId = await findPlatformSchoolId(supabase);
      if (platformSchoolId && req.user.schoolId === platformSchoolId) {
        try {
          await syncPlatformWalletFromRealPayments();
        } catch (syncErr) {
          console.warn('Platform revenue wallet sync failed:', syncErr.message || syncErr);
        }
      }
      const transactions = await listWalletTransactions(req.user.schoolId, { limit: 100 });
      res.json({ transactions: transactions.map(formatTransaction) });
    } catch (err) {
      console.error('List transactions error:', err);
      res.status(500).json({ error: 'Failed to load transactions' });
    }
  });

  app.post('/api/wallet/verify/:reference', authenticateToken, enforcePlanApproval, async (req, res) => {
    try {
      const reference = req.params.reference;
      const tx = await getWalletTransactionByReference(reference);
      if (!tx || tx.school_id !== req.user.schoolId) {
        return res.status(404).json({ error: 'Transaction not found' });
      }

      if (tx.type === 'deposit' && tx.status !== 'success') {
        const verified = await verifyTransaction(reference);
        if (verified?.status === 'success') {
          await creditDeposit(reference);
        } else if (verified?.status === 'failed' || verified?.status === 'abandoned') {
          await updateWalletTransaction(reference, { status: 'failed' });
          recordPlatformEvent({
            eventType: 'payment_failed',
            schoolId: req.user.schoolId,
            email: req.user.email,
            role: req.user.role,
            path: '/school-wallet',
            meta: {
              reason: String(verified.status).toLowerCase() === 'abandoned' ? 'abandoned' : 'provider_declined',
              message:
                String(verified.status).toLowerCase() === 'abandoned'
                  ? 'Payment abandoned before completion'
                  : 'Payment declined by provider',
              reference,
              status: verified.status,
            },
          }).catch(() => {});
        }
      }

      res.json({
        wallet: formatMoney(await getWallet(req.user.schoolId)),
        transaction: formatTransaction(await getWalletTransactionByReference(reference)),
      });
    } catch (err) {
      if (err.code?.startsWith('PAYSTACK') || err.status) return handlePaystackError(res, err);
      console.error('Verify transaction error:', err);
      res.status(500).json({ error: 'Failed to verify transaction' });
    }
  });

  // Paystack webhooks — no JWT; signature verified with secret key
  app.post('/api/webhooks/paystack', async (req, res) => {
    try {
      const signature = req.headers['x-paystack-signature'];
      const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body || {}));
      if (!verifyPaystackSignature(rawBody, signature)) {
        return res.status(401).json({ error: 'Invalid signature' });
      }

      const event = req.body?.event;
      const data = req.body?.data || {};
      const reference = data.reference || data.transfer_code;

      if (event === 'charge.success' || event === 'transaction.success') {
        const ref = data.reference;
        const metadata = parsePaystackMetadata(data.metadata);
        if (metadata.kind === 'school_fee') {
          await settleSchoolFeeFromPaystack(data);
        } else if (metadata.kind === 'school_signup' || metadata.kind === 'school_plan') {
          if (ref && onSchoolCheckoutPaid) await onSchoolCheckoutPaid(ref);
        } else if (ref && (String(ref).startsWith('signup_') || String(ref).startsWith('splan_'))) {
          if (onSchoolCheckoutPaid) await onSchoolCheckoutPaid(ref);
        } else if (ref) {
          await creditDeposit(ref);
        }
      }

      if (event === 'transfer.success') {
        const ref = data.reference;
        if (ref && !String(ref).startsWith('feeout_')) await completeWithdrawal(ref);
      }

      if (event === 'transfer.failed' || event === 'transfer.reversed') {
        const ref = data.reference;
        if (ref && !String(ref).startsWith('feeout_')) {
          const failed = await failWithdrawal(ref, data.reason || event);
          recordPlatformEvent({
            eventType: 'payment_failed',
            schoolId: failed?.transaction?.school_id || failed?.wallet?.school_id || null,
            path: '/school-wallet',
            meta: {
              reason: 'transfer_failed',
              message: data.reason || 'Withdrawal or transfer failed',
              reference: ref,
              event,
            },
          }).catch(() => {});
        }
      }

      // unused but keeps linter happy if reference used in future logging
      void reference;

      res.sendStatus(200);
    } catch (err) {
      console.error('Paystack webhook error:', err);
      res.status(500).json({ error: 'Webhook processing failed' });
    }
  });
}
