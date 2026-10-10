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
  sumSuccessfulCreditsByKind,
  reserveWithdrawal,
  completeWithdrawal,
  failWithdrawal,
  makeWalletReference,
} from './schoolWalletStore.js';
import { parsePaystackMetadata, settleSchoolFeeFromPaystack, syncSchoolFeeCredits } from './feePayments.js';
import { recordPlatformEvent } from './platformTelemetry.js';
import { findPlatformSchoolId } from './smsBilling.js';
import { getDemoMoneyClearBaselineMinor } from './platformSmsStore.js';
import { supabase } from './supabaseClient.js';
import { mergeSchoolWithExtras } from './schoolPlanStore.js';

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

async function syncSubscriptionRevenueIntoPlatformWallet() {
  const platformSchoolId = await findPlatformSchoolId(supabase);
  if (!platformSchoolId) return;
  const lifetimeMinor = await getRecordedSubscriptionRevenueMinor();
  let baselineMinor = 0;
  try {
    baselineMinor = await getDemoMoneyClearBaselineMinor();
  } catch {
    baselineMinor = 0;
  }
  const expectedMinor = Math.max(0, lifetimeMinor - baselineMinor);
  if (expectedMinor <= 0) return;
  await ensureWallet(platformSchoolId);
  const creditedMinor = await sumSuccessfulCreditsByKind(platformSchoolId, 'subscription_payment');
  const gapMinor = expectedMinor - creditedMinor;
  if (gapMinor <= 0) return;
  await creditInternalFunds(platformSchoolId, gapMinor, {
    reference: `subrev_gap_${expectedMinor}`,
    description: 'Subscription revenue available to withdraw',
    metadata: { kind: 'subscription_payment', sync: true },
  });
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
          await syncSubscriptionRevenueIntoPlatformWallet();
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

  app.post('/api/wallet/withdraw', authenticateToken, enforcePlanApproval, async (req, res) => {
    try {
      const schoolId = req.user.schoolId;
      const { account_id, amount, reason } = req.body || {};
      const amountMajor = Number(amount);

      if (!account_id) return res.status(400).json({ error: 'account_id is required' });
      if (!Number.isFinite(amountMajor) || amountMajor < 1) {
        return res.status(400).json({ error: 'Minimum withdrawal is 1.00' });
      }

      const account = await getWalletAccount(schoolId, account_id);
      if (!account) return res.status(404).json({ error: 'Select a saved bank or MoMo account first' });

      const { currency, configured } = getPaystackConfig();
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

      const amountMinor = toMinorUnits(amountMajor);
      const reference = makeWalletReference('wdr');

      await reserveWithdrawal(schoolId, amountMinor);
      await createWalletTransaction(schoolId, {
        type: 'withdrawal',
        amount: amountMinor,
        status: 'processing',
        channel: account.type,
        account_id: account.id,
        reference,
        description: reason || `Withdrawal to ${account.label || account.bank_name || account.type}`,
        metadata: { school_id: schoolId, account_id: account.id, wallet_action: 'withdrawal' },
      });

      try {
        const transfer = await initiateTransfer({
          amountMinor,
          currency,
          recipientCode: account.paystack_recipient_code,
          reference,
          reason: reason || `School wallet withdrawal`,
        });

        await updateWalletTransaction(reference, {
          provider_reference: transfer?.transfer_code || transfer?.reference || reference,
          metadata: { paystack_status: transfer?.status },
        });

        if (transfer?.status === 'success') {
          await completeWithdrawal(reference);
        }

        return res.json({
          reference,
          status: transfer?.status || 'pending',
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
      console.error('Withdraw error:', err);
      res.status(500).json({ error: 'Failed to start withdrawal' });
    }
  });

  app.get('/api/wallet/transactions', authenticateToken, enforcePlanApproval, async (req, res) => {
    try {
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
