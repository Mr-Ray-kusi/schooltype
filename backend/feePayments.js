import { supabase } from './supabaseClient.js';
import { creditInternalFunds, listWalletAccounts, updateWalletAccount } from './schoolWalletStore.js';
import { createSubaccount, fromMinorUnits, initiateTransfer, toMinorUnits } from './paystack.js';

export function currentFeeMonth() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Accra',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  return `${year}-${month}`;
}

function isMissingTable(error) {
  const msg = String(error?.message || error?.details || '').toLowerCase();
  return error?.code === '42P01' || msg.includes('does not exist') || msg.includes('could not find the table');
}

export async function getClassFeeAmount(schoolId, className) {
  if (!schoolId || !className) return 0;
  const { data: classRow } = await supabase
    .from('classes')
    .select('fee_amount, name')
    .eq('school_id', schoolId)
    .eq('name', className)
    .maybeSingle();
  if (classRow && Number(classRow.fee_amount) > 0) return Number(classRow.fee_amount);

  const { data: named } = await supabase
    .from('class_fees')
    .select('fee_amount')
    .eq('school_id', schoolId)
    .eq('class_name', className)
    .maybeSingle();
  return Number(named?.fee_amount) || 0;
}

export function parseExtraFees(value) {
  if (!value) return [];
  let rows = value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      rows = JSON.parse(trimmed);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => {
      const label = String(row?.label || row?.reason || row?.name || '').trim();
      const amount = Number(row?.amount ?? row?.fee);
      if (!label || !Number.isFinite(amount) || amount <= 0) return null;
      return { label, amount: roundMoney(amount) };
    })
    .filter(Boolean);
}

export function extraFeesTotal(student) {
  return roundMoney(
    parseExtraFees(student?.extra_fees ?? student?.extraFees).reduce((sum, row) => sum + row.amount, 0)
  );
}

export function extraFeesJson(value) {
  const rows = parseExtraFees(value);
  return rows.length ? rows : null;
}

export function extraFeesText(value) {
  const rows = parseExtraFees(value);
  return rows.length ? JSON.stringify(rows) : null;
}

export function resolveStudentFeeAmount(student, classFee) {
  const extra = extraFeesTotal(student);
  const classAmount = Number(classFee) || 0;
  if (extra > 0) return roundMoney(classAmount + extra);
  const personal = Number(student?.monthly_fee);
  if (Number.isFinite(personal) && personal > 0) return personal;
  return classAmount;
}

export function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

export function isSuccessfulFeeStatus(status) {
  const value = String(status || 'success').toLowerCase();
  return value === 'success' || value === 'paid';
}

export function describeFeeRecorder(payment) {
  const role = String(payment?.recorded_by_role || '').toLowerCase();
  const name = String(payment?.recorded_by_name || '').trim();
  if (role === 'accountant') {
    const accountantName = name && !/^accountant$/i.test(name) ? name : '';
    return accountantName ? `Accountant · ${accountantName}` : 'Accountant';
  }
  if (role === 'admin') return 'Admin';
  if (role === 'parent' || role === 'system') return 'Online';
  if (isManualFeePayment(payment)) return 'Admin';
  return 'Online';
}

export function studentRecordedByLabel(payments) {
  const labels = [...new Set((payments || []).map((row) => describeFeeRecorder(row)))];
  return labels.length ? labels.join(' · ') : '—';
}

export function isManualFeePayment(row) {
  const method = String(row?.payment_method || '').toLowerCase();
  const channel = String(row?.channel || '').toLowerCase();
  const ref = String(row?.payment_reference || '');
  if (ref.startsWith('fee_')) return false;
  if (method === 'manual' || method === 'cash') return true;
  if (ref.startsWith('manual_') || ref.startsWith('manual:')) return true;
  return ['cash', 'momo', 'bank'].includes(method) && !/^T\d|^sk_/.test(ref);
}

export function sumFeePayments(payments) {
  return roundMoney(
    (payments || []).reduce((sum, row) => {
      if (!isSuccessfulFeeStatus(row?.status)) return sum;
      return sum + (Number(row.amount) || 0);
    }, 0)
  );
}

export function buildFeeBalance({ feeAmount, payments }) {
  const due = roundMoney(feeAmount);
  const paidAmount = sumFeePayments(payments);
  const outstanding = roundMoney(Math.max(0, due - paidAmount));
  return {
    fee_amount: due,
    paid_amount: paidAmount,
    outstanding,
    fully_paid: due > 0 && outstanding < 0.01,
    payments: payments || [],
  };
}

export async function listStudentFeePayments({ schoolId, studentId, month }) {
  if (!schoolId || !studentId || !month) return [];
  const { data, error } = await supabase
    .from('fee_payments')
    .select('*')
    .eq('school_id', schoolId)
    .eq('payer_id', studentId)
    .eq('payment_month', month)
    .order('created_at', { ascending: false });
  if (error) {
    if (isMissingTable(error)) return [];
    return [];
  }
  return (data || []).filter((row) => isSuccessfulFeeStatus(row.status));
}

export async function refreshStudentFeeStatus({ schoolId, studentId, month }) {
  if (!schoolId || !studentId) return null;
  let { data: student, error } = await supabase
    .from('students')
    .select('id, monthly_fee, extra_fees, class')
    .eq('id', studentId)
    .eq('school_id', schoolId)
    .maybeSingle();
  if (error && String(error.message || '').toLowerCase().includes('extra_fees')) {
    const retry = await supabase
      .from('students')
      .select('id, monthly_fee, class')
      .eq('id', studentId)
      .eq('school_id', schoolId)
      .maybeSingle();
    student = retry.data;
    error = retry.error;
  }
  if (error || !student) return null;
  const classFee = await getClassFeeAmount(schoolId, student.class);
  const feeAmount = resolveStudentFeeAmount(student, classFee);
  const payments = await listStudentFeePayments({
    schoolId,
    studentId,
    month: month || currentFeeMonth(),
  });
  const balance = buildFeeBalance({ feeAmount, payments });
  await supabase
    .from('students')
    .update({
      fee_status: balance.fully_paid ? 'paid' : balance.paid_amount > 0 ? 'partial' : 'unpaid',
    })
    .eq('id', studentId)
    .eq('school_id', schoolId);
  return { student, ...balance };
}

export async function findSuccessfulFeePayment({ schoolId, studentId, month, reference }) {
  if (reference) {
    const { data, error } = await supabase
      .from('fee_payments')
      .select('*')
      .eq('payment_reference', reference)
      .maybeSingle();
    if (!error && data) return data;
  }
  if (!schoolId || !studentId || !month) return null;
  const { data, error } = await supabase
    .from('fee_payments')
    .select('*')
    .eq('school_id', schoolId)
    .eq('payer_id', studentId)
    .eq('payment_month', month)
    .in('status', ['success', 'paid'])
    .limit(1)
    .maybeSingle();
  if (error) {
    if (isMissingTable(error)) return null;
    const { data: fallback } = await supabase
      .from('fee_payments')
      .select('*')
      .eq('school_id', schoolId)
      .eq('payer_id', studentId)
      .eq('payment_month', month)
      .limit(1)
      .maybeSingle();
    return fallback || null;
  }
  return data || null;
}

export async function recordFeePayment(row) {
  const payload = {
    school_id: row.school_id,
    payer_type: row.payer_type || 'student',
    payer_id: row.payer_id || null,
    payer_name: row.payer_name || null,
    payer_class: row.payer_class || null,
    amount: Number(row.amount) || 0,
    payment_method: row.payment_method || 'paystack',
    payment_month: row.payment_month || currentFeeMonth(),
    payment_reference: row.payment_reference || null,
    status: row.status || 'success',
    channel: row.channel || null,
    currency: row.currency || 'GHS',
    recorded_by_role: row.recorded_by_role || null,
    recorded_by_staff_id: row.recorded_by_staff_id || null,
    recorded_by_name: row.recorded_by_name || null,
    created_at: row.created_at || new Date().toISOString(),
  };

  const optional = [
    'payment_reference',
    'status',
    'channel',
    'currency',
    'payer_id',
    'payer_class',
    'recorded_by_role',
    'recorded_by_staff_id',
    'recorded_by_name',
  ];
  let attempt = { ...payload };
  for (let i = 0; i <= optional.length; i++) {
    const { data, error } = await supabase.from('fee_payments').insert([attempt]).select().maybeSingle();
    if (!error) return data;
    if (isMissingTable(error)) {
      const err = new Error(
        'fee_payments table is missing. Run database/migrations.sql in the Supabase SQL editor.'
      );
      err.status = 503;
      throw err;
    }
    if (String(error.message || '').toLowerCase().includes('duplicate') || error.code === '23505') {
      const { data: existing } = await supabase
        .from('fee_payments')
        .select('*')
        .eq('payment_reference', payload.payment_reference)
        .maybeSingle();
      return existing;
    }
    const missing = optional.find(
      (column) =>
        attempt[column] !== undefined &&
        String(error.message || error.details || '').includes(column)
    );
    if (missing) {
      delete attempt[missing];
      continue;
    }
    throw error;
  }
  return null;
}

export async function updateManualFeePayment({ schoolId, paymentId, amount, method, reference }) {
  const { data: existing, error } = await supabase
    .from('fee_payments')
    .select('*')
    .eq('id', paymentId)
    .eq('school_id', schoolId)
    .maybeSingle();
  if (error || !existing) {
    const err = new Error('Payment not found');
    err.status = 404;
    throw err;
  }
  if (!isManualFeePayment(existing)) {
    const err = new Error('Online payments cannot be edited.');
    err.status = 403;
    err.code = 'ONLINE_LOCKED';
    throw err;
  }

  const next = {};
  if (amount != null) next.amount = roundMoney(amount);
  if (method) {
    next.payment_method = 'manual';
    next.channel = method;
  }
  if (reference !== undefined) {
    const note = String(reference || '').trim();
    if (note.startsWith('fee_')) {
      const err = new Error('That reference belongs to an online payment and cannot be used here.');
      err.status = 400;
      throw err;
    }
    next.payment_reference = note
      ? note.startsWith('manual')
        ? note
        : `manual:${note}`
      : existing.payment_reference || `manual_${existing.payer_id || 'fee'}_${Date.now()}`;
  }

  const { data, error: updateError } = await supabase
    .from('fee_payments')
    .update(next)
    .eq('id', paymentId)
    .eq('school_id', schoolId)
    .select()
    .maybeSingle();
  if (updateError) throw updateError;
  return { payment: data || { ...existing, ...next }, previousAmount: Number(existing.amount) || 0 };
}

/**
 * Resolve the school's Bank Settings payout destination.
 * Bank accounts become Paystack subaccounts (split at charge time).
 * MoMo (or failed subaccount) uses a transfer recipient after success.
 */
export async function getFeePayoutAccount(schoolId, schoolName) {
  if (!schoolId) return { hasPayout: false, account: null, subaccountCode: null, recipientCode: null };
  const accounts = await listWalletAccounts(schoolId);
  if (!accounts.length) return { hasPayout: false, account: null, subaccountCode: null, recipientCode: null };

  const preferred =
    accounts.find((row) => row.is_default) ||
    accounts.find((row) => row.type === 'bank') ||
    accounts[0];

  let subaccountCode = preferred.paystack_subaccount_code || null;
  if (!subaccountCode && preferred.account_number && preferred.bank_code) {
    try {
      const created = await createSubaccount({
        businessName: schoolName || preferred.account_name || 'School',
        bankCode: preferred.bank_code,
        accountNumber: preferred.account_number,
        description: `Schootype fees · ${schoolName || schoolId}`,
      });
      subaccountCode = created?.subaccount_code || null;
      if (subaccountCode) {
        await updateWalletAccount(schoolId, preferred.id, {
          paystack_subaccount_code: subaccountCode,
        });
      }
    } catch (err) {
      console.warn('Paystack subaccount create skipped:', err.message);
    }
  }

  const recipientCode = preferred.paystack_recipient_code || null;
  return {
    hasPayout: Boolean(subaccountCode || recipientCode),
    account: preferred,
    subaccountCode,
    recipientCode,
  };
}

async function payoutFeeToSchoolAccount(data, metadata, amountMinor) {
  if (metadata.settle_mode === 'subaccount' && metadata.subaccount_code) return;
  const recipientCode = metadata.recipient_code;
  if (!recipientCode || !amountMinor) return;
  const payoutRef = `feeout_${String(data.reference || '').slice(0, 40)}`;
  try {
    await initiateTransfer({
      amountMinor,
      currency: data.currency || 'GHS',
      recipientCode,
      reference: payoutRef,
      reason: `School fees · ${metadata.payer_name || 'Student'}`.trim(),
    });
  } catch (err) {
    // Wallet is already credited; the school can withdraw from School Wallet if this transfer fails.
    console.warn('Fee payout transfer skipped:', err.message);
  }
}

export function parsePaystackMetadata(raw) {
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
}

export async function syncSchoolFeeCredits(schoolId) {
  if (!schoolId) return;
  const { data: payments, error } = await supabase
    .from('fee_payments')
    .select('id, amount, payer_name, payer_id, payment_reference, payment_method, payment_month, channel, status')
    .eq('school_id', schoolId)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error || !payments?.length) return;

  for (const payment of payments) {
    if (!isSuccessfulFeeStatus(payment.status)) continue;
    const amount = Number(payment.amount) || 0;
    if (amount <= 0) continue;
    const manual = isManualFeePayment(payment);
    const source = manual ? 'cashed' : 'online';
    const reference = manual
      ? `feecash_${payment.payment_reference || payment.id}`
      : payment.payment_reference;
    if (!reference) continue;
    try {
      await creditInternalFunds(schoolId, toMinorUnits(amount), {
        reference,
        description: `School fees · ${source === 'cashed' ? 'Cashed' : 'Paid online'} · ${payment.payer_name || 'Student'} · ${payment.payment_month || ''}`.trim(),
        metadata: {
          kind: 'school_fee',
          source,
          student_id: payment.payer_id || null,
        },
      });
    } catch (err) {
      console.warn('Fee wallet sync skipped:', err.message);
    }
  }
}

export async function creditCashedFeeToWallet({ schoolId, amount, reference, studentName, periodLabel }) {
  const amountMinor = toMinorUnits(amount);
  if (!schoolId || !reference || amountMinor <= 0) return null;
  return creditInternalFunds(schoolId, amountMinor, {
    reference,
    description: `School fees · Cashed · ${studentName || 'Student'} · ${periodLabel || ''}`.trim(),
    metadata: {
      kind: 'school_fee',
      source: 'cashed',
    },
  });
}

export async function settleSchoolFeeFromPaystack(data = {}) {
  const metadata = parsePaystackMetadata(data.metadata);
  if (metadata.kind !== 'school_fee') return null;

  const reference = data.reference;
  const schoolId = metadata.school_id;
  const amountMinor = Number(data.amount) || toMinorUnits(metadata.amount_major || 0);
  if (!reference || !schoolId || amountMinor <= 0) return null;

  await creditInternalFunds(schoolId, amountMinor, {
    reference,
    description: `School fees · Paid online · ${metadata.payer_name || 'Student'} · ${metadata.term_name || metadata.payment_month || ''}`.trim(),
    metadata: {
      kind: 'school_fee',
      source: 'online',
      student_id: metadata.student_id || null,
      channel: data.channel || null,
      payment_month: metadata.payment_month || currentFeeMonth(),
      settle_mode: metadata.settle_mode || null,
      settled_externally: metadata.settle_mode === 'subaccount' || metadata.settle_mode === 'transfer',
    },
  });

  await recordFeePayment({
    school_id: schoolId,
    payer_type: 'student',
    payer_id: metadata.student_id || null,
    payer_name: metadata.payer_name || null,
    payer_class: metadata.payer_class || null,
    amount: fromMinorUnits(amountMinor),
    payment_method: data.channel || metadata.payment_method || 'paystack',
    payment_month: metadata.payment_month || currentFeeMonth(),
    payment_reference: reference,
    status: 'success',
    channel: data.channel || null,
    currency: data.currency || 'GHS',
    recorded_by_role: 'parent',
    recorded_by_name: 'Online',
  });

  if (metadata.student_id) {
    await refreshStudentFeeStatus({
      schoolId,
      studentId: metadata.student_id,
      month: metadata.payment_month || currentFeeMonth(),
    });
  }

  await payoutFeeToSchoolAccount(data, metadata, amountMinor);

  return { reference, schoolId };
}
