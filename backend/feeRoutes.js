import {
  getPaystackConfig,
  initializeTransaction,
  verifyTransaction,
  fetchCharge,
  isPaystackFailedStatus,
  isPaystackPendingStatus,
  isPaystackUserCancelled,
  chargeMobileMoney,
  submitChargeOtp,
  submitChargePin,
  GHANA_CHECKOUT_CHANNELS,
  toMinorUnits,
  fromMinorUnits,
  normalizeGhanaPhone,
  momoProviderFromGhanaPhone,
} from './paystack.js';
import { getFrontendBaseUrl } from './emailVerification.js';
import { attachFeePayLink, sendSmsBatch } from './smsProvider.js';
import { settleSmsPayment, refundSchoolAndPlatformUnits, quoteSmsForPhones } from './smsBilling.js';
import { buildOwingFeeSmsBodies, groupOwingParents } from './feeReminderSms.js';
import { makeWalletReference } from './schoolWalletStore.js';
import { supabase } from './supabaseClient.js';
import { isSchoolHeadRole } from './staffAdminRoutes.js';
import {
  getClassFeeAmount,
  resolveStudentFeeAmount,
  findSuccessfulFeePayment,
  settleSchoolFeeFromPaystack,
  getFeePayoutAccount,
  listStudentFeePayments,
  buildFeeBalance,
  refreshStudentFeeStatus,
  recordFeePayment,
  updateManualFeePayment,
  roundMoney,
  isSuccessfulFeeStatus,
  isManualFeePayment,
  creditCashedFeeToWallet,
  describeFeeRecorder,
  studentRecordedByLabel,
  parsePaystackMetadata,
} from './feePayments.js';
import {
  listAcademicTerms,
  replaceAcademicTerms,
  resolveFeePeriod,
  getFeePeriodByKey,
  formatPeriodLabel,
} from './academicTerms.js';
import { recordPlatformEvent } from './platformTelemetry.js';

const notedFeeFailureRefs = new Set();
const cancelledFeeRefs = new Set();

function rememberCancelledFee(reference) {
  const ref = String(reference || '').trim();
  if (!ref) return;
  cancelledFeeRefs.add(ref);
  if (cancelledFeeRefs.size > 4000) {
    const first = cancelledFeeRefs.values().next().value;
    if (first) cancelledFeeRefs.delete(first);
  }
}

function isCancelledFee(reference) {
  return cancelledFeeRefs.has(String(reference || '').trim());
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function readCharge(reference) {
  try {
    return await fetchCharge(reference);
  } catch {
    return null;
  }
}

function chargeNeedsCode(status) {
  const value = String(status || '').toLowerCase();
  return value === 'send_otp' || value === 'send_pin';
}

function chargeLooksLikeCodePrompt(charge) {
  if (chargeNeedsCode(charge?.status)) return true;
  const text = `${charge?.display_text || ''} ${charge?.gateway_response || ''} ${charge?._paystack_message || ''}`.toLowerCase();
  return /\botp\b|voucher|verification code|enter (the )?(pin|code)|one[- ]time/.test(text);
}

function chargeInstructionReady(status) {
  const value = String(status || '').toLowerCase();
  return (
    value === 'success' ||
    value === 'failed' ||
    value === 'timeout' ||
    value === 'pay_offline' ||
    value === 'open_url' ||
    chargeNeedsCode(value)
  );
}

async function waitForMomoInstruction(reference, initial, { attempts = 2, delayMs = 180 } = {}) {
  let charge = initial;
  for (let i = 0; i < attempts; i++) {
    const status = String(charge?.status || '').toLowerCase();
    if (chargeInstructionReady(status) || chargeLooksLikeCodePrompt(charge)) return charge;
    await sleep(delayMs);
    charge = (await readCharge(reference)) || charge;
  }
  return charge;
}

function momoChargePublicView(resolved, reference) {
  const payload = resolved.payload || {};
  const status = String(resolved.status || '').toLowerCase();
  return {
    status: chargeNeedsCode(status) ? 'pending' : status || 'pending',
    reference: payload.reference || reference,
    needs_code: Boolean(resolved.needs_code),
    code_type: status === 'send_pin' ? 'pin' : resolved.needs_code ? 'otp' : null,
    display_text: resolved.display_text || null,
    authorization_url: payload.url || payload.redirecturl || null,
  };
}

function studentFromPaystackMeta(raw) {
  const meta = parsePaystackMetadata(raw);
  if (!meta.student_id && !meta.payer_name && !meta.school_id && !meta.barcode) return null;
  return {
    id: meta.student_id || null,
    name: meta.payer_name || null,
    class: meta.payer_class || null,
    school_id: meta.school_id || null,
    barcode: meta.barcode || null,
    roll_number: meta.roll_number || null,
  };
}

async function resolveFailedFeeSchoolId({ schoolId, student, meta, studentCode }) {
  const parsed = parsePaystackMetadata(meta);
  const direct = String(schoolId || student?.school_id || parsed.school_id || '').trim();
  if (direct) return direct;
  const studentId = student?.id || parsed.student_id;
  const code = String(studentCode || student?.barcode || parsed.barcode || parsed.roll_number || '').trim();
  if (studentId) {
    const { data } = await supabase.from('students').select('school_id').eq('id', studentId).maybeSingle();
    if (data?.school_id) return data.school_id;
  }
  if (code) {
    const byBarcode = await supabase.from('students').select('school_id').eq('barcode', code).maybeSingle();
    if (byBarcode.data?.school_id) return byBarcode.data.school_id;
    const byRoll = await supabase.from('students').select('school_id').eq('roll_number', code).limit(2);
    if (byRoll.data?.length === 1) return byRoll.data[0].school_id;
  }
  return null;
}

const noteFeePaymentFailed = ({
  schoolId,
  email,
  reason,
  message,
  reference,
  student,
  studentCode,
  amount,
  channel,
  meta,
} = {}) => {
  const ref = String(reference || '').trim();
  if (ref) {
    if (notedFeeFailureRefs.has(ref)) return;
    notedFeeFailureRefs.add(ref);
    if (notedFeeFailureRefs.size > 3000) notedFeeFailureRefs.clear();
  }
  const parsed = parsePaystackMetadata(meta);
  const code = String(
    studentCode || student?.barcode || student?.roll_number || parsed.barcode || parsed.roll_number || ''
  ).trim();
  Promise.resolve()
    .then(async () => {
      const resolvedSchoolId = await resolveFailedFeeSchoolId({
        schoolId,
        student,
        meta: parsed,
        studentCode: code,
      });
      let schoolName = null;
      if (resolvedSchoolId) {
        const { data: school } = await supabase
          .from('schools')
          .select('name')
          .eq('id', resolvedSchoolId)
          .maybeSingle();
        schoolName = school?.name || null;
      }
      await recordPlatformEvent({
        eventType: 'payment_failed',
        schoolId: resolvedSchoolId,
        schoolName,
        email: email || null,
        path: '/fees',
        meta: {
          kind: 'school_fee',
          school_id: resolvedSchoolId,
          school_name: schoolName,
          reason: reason || 'provider_declined',
          message: message || 'Payment attempt failed',
          reference: ref || null,
          student_id: student?.id || parsed.student_id || null,
          student_name: student?.name || parsed.payer_name || null,
          student_class: student?.class || parsed.payer_class || null,
          student_code: code || null,
        },
      });
    })
    .catch(() => {});
};

const noteUnknownStudentId = ({ schoolId, studentCode }) => {
  const code = String(studentCode || '').trim();
  if (!code) return;
  noteFeePaymentFailed({
    schoolId,
    reason: 'student_not_found',
    message: `Student ID entered: ${code}`,
    studentCode: code,
  });
};

function handlePaystackError(res, err) {
  const status = err.status || 500;
  return res.status(status >= 400 ? status : 502).json({
    error: err.message || 'Paystack request failed',
    code: err.code || 'PAYSTACK_ERROR',
  });
}

function publicStudentSummary(student, school, amount, month, balance, period) {
  const feeAmount = Number(balance?.fee_amount ?? amount) || 0;
  const paidAmount = Number(balance?.paid_amount) || 0;
  const outstanding = Number(balance?.outstanding ?? feeAmount) || 0;
  const fullyPaid = Boolean(balance?.fully_paid);
  return {
    school_id: student.school_id,
    school_name: school?.name || 'School',
    school_logo_url: school?.logo_url || null,
    student_id: student.id,
    student_name: student.name,
    class_name: student.class || null,
    roll_number: student.roll_number || null,
    barcode: student.barcode,
    amount: outstanding > 0 ? outstanding : feeAmount,
    fee_amount: feeAmount,
    paid_amount: paidAmount,
    outstanding,
    currency: getPaystackConfig().currency,
    payment_month: month,
    term_name: period?.name || month,
    term_starts_on: period?.starts_on || null,
    term_ends_on: period?.ends_on || null,
    period_label: formatPeriodLabel(period) || month,
    paid: fullyPaid,
    paid_at: balance?.payments?.[0]?.created_at || null,
    paystack_configured: getPaystackConfig().configured,
    channels: ['mobile_money', 'bank'],
  };
}

async function loadFeeBalance(student, amount, month) {
  const payments = await listStudentFeePayments({
    schoolId: student.school_id,
    studentId: student.id,
    month,
  });
  return buildFeeBalance({ feeAmount: amount, payments });
}

async function loadStudentFeeContext(barcode) {
  const code = String(barcode || '').trim();
  if (!code) return null;
  const { data: student, error } = await supabase.from('students').select('*').eq('barcode', code).maybeSingle();
  if (error || !student) return null;
  const [{ data: school }, classFee] = await Promise.all([
    supabase.from('schools').select('id, name, logo_url, email').eq('id', student.school_id).maybeSingle(),
    getClassFeeAmount(student.school_id, student.class),
  ]);
  const period = await resolveFeePeriod(student.school_id);
  const month = period.key;
  const amount = resolveStudentFeeAmount(student, classFee);
  const balance = await loadFeeBalance(student, amount, month);
  return { student, school, amount, month, balance, period };
}

async function findStudentInSchool(schoolId, studentId) {
  const school = String(schoolId || '').trim();
  const code = String(studentId || '').trim();
  if (!school || !code) return null;

  const byBarcode = await supabase
    .from('students')
    .select('*')
    .eq('school_id', school)
    .eq('barcode', code)
    .maybeSingle();
  if (byBarcode.data) return byBarcode.data;

  const byRoll = await supabase
    .from('students')
    .select('*')
    .eq('school_id', school)
    .eq('roll_number', code)
    .maybeSingle();
  if (byRoll.data) return byRoll.data;

  const byId = await supabase
    .from('students')
    .select('*')
    .eq('school_id', school)
    .eq('id', code)
    .maybeSingle();
  return byId.data || null;
}

async function loadStudentFeeBySchool(schoolId, studentId) {
  const student = await findStudentInSchool(schoolId, studentId);
  if (!student) return null;
  const [{ data: school }, classFee] = await Promise.all([
    supabase.from('schools').select('id, name, logo_url, email').eq('id', student.school_id).maybeSingle(),
    getClassFeeAmount(student.school_id, student.class),
  ]);
  const period = await resolveFeePeriod(student.school_id);
  const month = period.key;
  const amount = resolveStudentFeeAmount(student, classFee);
  const balance = await loadFeeBalance(student, amount, month);
  return { student, school, amount, month, balance, period };
}

function feePayloadFromRecord(row, reference) {
  return {
    reference: row.payment_reference || reference,
    amount: toMinorUnits(row.amount),
    currency: row.currency || 'GHS',
    channel: row.channel || null,
    metadata: {
      kind: 'school_fee',
      school_id: row.school_id,
      student_id: row.payer_id,
      payer_name: row.payer_name,
      payment_month: row.payment_month,
    },
  };
}

async function resolveFeePayment(reference) {
  const alreadyPaid = await findSuccessfulFeePayment({ reference });
  if (alreadyPaid) {
    if (isCancelledFee(reference)) cancelledFeeRefs.delete(String(reference || '').trim());
    return {
      status: 'success',
      payload: feePayloadFromRecord(alreadyPaid, reference),
      needs_code: false,
      display_text: null,
    };
  }

  let charge = await readCharge(reference);
  if (!charge) {
    await sleep(400);
    charge = await readCharge(reference);
  }

  const chargeStatus = String(charge?.status || '').toLowerCase();
  if (chargeStatus === 'success') {
    let payload = charge;
    try {
      const verified = await verifyTransaction(reference);
      if (verified) {
        payload = {
          ...charge,
          ...verified,
          metadata: verified.metadata || charge.metadata,
          reference: verified.reference || charge.reference || reference,
        };
      }
    } catch {
      // Charge success is enough to settle.
    }
    await settleSchoolFeeFromPaystack(payload);
    if (isCancelledFee(reference)) cancelledFeeRefs.delete(String(reference || '').trim());
    return {
      status: 'success',
      payload,
      needs_code: false,
      display_text: payload?.display_text || null,
    };
  }

  if (chargeLooksLikeCodePrompt(charge) || chargeStatus === 'send_otp' || chargeStatus === 'send_pin') {
    return {
      status: chargeNeedsCode(chargeStatus) ? chargeStatus : 'send_otp',
      payload: charge,
      needs_code: true,
      display_text: charge?.display_text || 'Enter the 6-digit code sent for this payment.',
    };
  }

  if (isCancelledFee(reference)) {
    return {
      status: 'cancelled',
      payload: charge || { reference },
      needs_code: false,
      display_text: 'This payment was cancelled. Tap Continue to payment to start again.',
    };
  }

  if (charge && isPaystackUserCancelled(charge)) {
    rememberCancelledFee(reference);
    const meta = parsePaystackMetadata(charge.metadata);
    noteFeePaymentFailed({
      schoolId: meta.school_id,
      reason: 'abandoned',
      message: charge.display_text || charge.gateway_response || 'Payment cancelled on the phone',
      reference: charge.reference || reference,
      student: studentFromPaystackMeta(meta),
      amount: fromMinorUnits(charge.amount) || meta.amount_major,
      channel: charge.channel,
      meta,
    });
    return {
      status: 'cancelled',
      payload: charge,
      needs_code: false,
      display_text: 'Payment was cancelled on the phone. Tap Continue to payment to start again.',
    };
  }

  if (charge && isPaystackFailedStatus(chargeStatus)) {
    const meta = parsePaystackMetadata(charge.metadata);
    noteFeePaymentFailed({
      schoolId: meta.school_id,
      reason: 'provider_declined',
      message: charge.display_text || charge.gateway_response || 'Payment declined by provider',
      reference: charge.reference,
      student: studentFromPaystackMeta(meta),
      amount: fromMinorUnits(charge.amount) || meta.amount_major,
      channel: charge.channel,
      meta,
    });
    return {
      status: 'failed',
      payload: charge,
      needs_code: false,
      display_text: charge.display_text || charge.gateway_response || null,
    };
  }

  if (charge && isPaystackPendingStatus(chargeStatus)) {
    try {
      const verified = await verifyTransaction(reference);
      const txStatus = String(verified?.status || '').toLowerCase();
      if (txStatus === 'success') {
        await settleSchoolFeeFromPaystack(verified);
        return { status: 'success', payload: verified, needs_code: false, display_text: null };
      }
      if (chargeLooksLikeCodePrompt(verified) || chargeNeedsCode(txStatus)) {
        return {
          status: chargeNeedsCode(txStatus) ? txStatus : 'send_otp',
          payload: verified,
          needs_code: true,
          display_text: verified?.display_text || charge.display_text || 'Enter the 6-digit code sent for this payment.',
        };
      }
    } catch {
      // Charge is still waiting for the phone prompt or 6-digit code.
    }
    return {
      status: 'pending',
      payload: charge,
      needs_code: false,
      display_text: charge.display_text || 'Waiting for confirmation.',
    };
  }

  try {
    const verified = await verifyTransaction(reference);
    const txStatus = String(verified?.status || '').toLowerCase();
    if (txStatus === 'success') {
      await settleSchoolFeeFromPaystack(verified);
      return { status: 'success', payload: verified, needs_code: false, display_text: null };
    }
    if (chargeLooksLikeCodePrompt(verified) || chargeNeedsCode(txStatus)) {
      return {
        status: chargeNeedsCode(txStatus) ? txStatus : 'send_otp',
        payload: verified,
        needs_code: true,
        display_text: verified?.display_text || 'Enter the 6-digit code sent for this payment.',
      };
    }
    if (txStatus === 'abandoned' || isPaystackPendingStatus(txStatus)) {
      return {
        status: 'pending',
        payload: verified,
        needs_code: false,
        display_text: verified?.display_text || charge?.display_text || 'Waiting for confirmation.',
      };
    }
    if (isPaystackUserCancelled(verified)) {
      rememberCancelledFee(reference);
      const meta = parsePaystackMetadata(verified?.metadata);
      noteFeePaymentFailed({
        schoolId: meta.school_id,
        reason: 'abandoned',
        message: verified?.gateway_response || 'Payment cancelled on the phone',
        reference: verified?.reference || reference,
        student: studentFromPaystackMeta(meta),
        amount: fromMinorUnits(verified?.amount) || meta.amount_major,
        channel: verified?.channel,
        meta,
      });
      return {
        status: 'cancelled',
        payload: verified,
        needs_code: false,
        display_text: 'Payment was cancelled on the phone. Tap Continue to payment to start again.',
      };
    }
    if (isPaystackFailedStatus(txStatus)) {
      const meta = parsePaystackMetadata(verified?.metadata);
      noteFeePaymentFailed({
        schoolId: meta.school_id,
        reason: 'provider_declined',
        message: verified?.gateway_response || 'Payment attempt failed',
        reference: verified?.reference || reference,
        student: studentFromPaystackMeta(meta),
        amount: fromMinorUnits(verified?.amount) || meta.amount_major,
        channel: verified?.channel,
        meta,
      });
      return {
        status: 'failed',
        payload: verified,
        needs_code: false,
        display_text: verified?.gateway_response || null,
      };
    }
    return {
      status: 'pending',
      payload: verified,
      needs_code: false,
      display_text: null,
    };
  } catch {
    return { status: 'pending', payload: charge, needs_code: false, display_text: null };
  }
}

function normalizePayMethod(method) {
  const value = String(method || '').toLowerCase();
  if (value === 'momo' || value === 'mobile_money') return 'momo';
  if (value === 'bank' || value === 'bank_transfer') return 'bank';
  return '';
}

function throwIfFullyPaid(ctx) {
  if (!ctx?.balance?.fully_paid) return;
  const label = ctx.period?.name || 'this term';
  const err = new Error(`There is no outstanding payment to make for ${label}.`);
  err.status = 409;
  err.code = 'FULLY_PAID';
  throw err;
}

function normalizeManualMethod(method) {
  const value = String(method || '').toLowerCase();
  if (value === 'cash') return 'cash';
  if (value === 'momo' || value === 'mobile_money') return 'momo';
  return '';
}

function accraYear() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Accra', year: 'numeric' }).format(new Date());
}

function annotatePayments(payments) {
  return (payments || []).map((payment) => ({
    ...payment,
    manual: isManualFeePayment(payment),
    recorded_by_label: describeFeeRecorder(payment),
  }));
}

export async function getFeeOverviewPayload(schoolId, query = {}) {
  const scope = String(query.scope || '').toLowerCase() === 'year' ? 'year' : 'term';
  const period = query.month
    ? await getFeePeriodByKey(schoolId, String(query.month))
    : await resolveFeePeriod(schoolId);
  const month = period.key;
  const year = accraYear();
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(query.limit, 10) || 8));
  const tab = String(query.tab || query.status || 'paid').toLowerCase();
  const search = String(query.q || '').trim().toLowerCase();
  const pagedMode = query.page != null || query.limit != null || query.tab != null;

  const TERM_PAY_COLUMNS =
    'id, payer_id, payer_name, payer_class, amount, status, channel, payment_method, recorded_by, payment_reference, payment_month, created_at';

  let [{ data: students, error: studentError }, { data: classes }, termPayRes, yearPayRes] = await Promise.all([
    supabase
      .from('students')
      .select('id, name, class, roll_number, barcode, parent_phone, monthly_fee, extra_fees, fee_status')
      .eq('school_id', schoolId)
      .order('name', { ascending: true }),
    supabase.from('classes').select('id, name, fee_amount').eq('school_id', schoolId),
    supabase
      .from('fee_payments')
      .select(TERM_PAY_COLUMNS)
      .eq('school_id', schoolId)
      .eq('payment_month', month)
      .order('created_at', { ascending: false })
      .limit(500),
    supabase
      .from('fee_payments')
      .select('amount, status')
      .eq('school_id', schoolId)
      .gte('created_at', `${year}-01-01`)
      .limit(2000),
  ]);
  if (studentError && String(studentError.message || '').toLowerCase().includes('extra_fees')) {
    const retry = await supabase
      .from('students')
      .select('id, name, class, roll_number, barcode, parent_phone, monthly_fee, fee_status')
      .eq('school_id', schoolId)
      .order('name', { ascending: true });
    students = retry.data;
    studentError = retry.error;
  }
  if (studentError) throw studentError;

  const payments = termPayRes.data || [];
  const yearPayments = yearPayRes.data || [];
  const classFeeByName = new Map((classes || []).map((row) => [row.name, Number(row.fee_amount) || 0]));
  const paymentsByStudent = new Map();
  for (const payment of payments) {
    if (!payment.payer_id || !isSuccessfulFeeStatus(payment.status)) continue;
    const list = paymentsByStudent.get(payment.payer_id) || [];
    list.push(payment);
    paymentsByStudent.set(payment.payer_id, list);
  }

  const rows = (students || []).map((student) => {
    const amount = resolveStudentFeeAmount(student, classFeeByName.get(student.class) || 0);
    const studentPayments = annotatePayments(paymentsByStudent.get(student.id) || []);
    const balance = buildFeeBalance({ feeAmount: amount, payments: studentPayments });
    return {
      ...student,
      fee_amount: balance.fee_amount,
      paid_amount: balance.paid_amount,
      outstanding: balance.outstanding,
      payment_month: month,
      paid: balance.paid_amount > 0,
      fully_paid: balance.fully_paid,
      payment: studentPayments[0] || null,
      payments: studentPayments,
      recorded_by: studentRecordedByLabel(studentPayments),
      pay_path: student.barcode ? `/pay/${encodeURIComponent(student.barcode)}` : null,
    };
  });

  const billed = rows.filter((row) => row.fee_amount > 0 || row.paid_amount > 0);
  const paid = billed.filter((row) => row.paid_amount > 0);
  const unpaid = billed.filter((row) => row.outstanding >= 0.01);
  const paidAmount = paid.reduce((sum, row) => sum + Number(row.paid_amount || 0), 0);
  const unpaidAmount = unpaid.reduce((sum, row) => sum + Number(row.outstanding || 0), 0);

  const classesChart = [...classFeeByName.keys()]
    .concat(billed.map((row) => row.class || 'Unassigned'))
    .filter((name, index, list) => name && list.indexOf(name) === index)
    .map((className) => {
      const inClass = billed.filter((row) => (row.class || 'Unassigned') === className);
      return {
        className,
        students: inClass.length,
        paid_amount: roundMoney(inClass.reduce((sum, row) => sum + Number(row.paid_amount || 0), 0)),
        outstanding: roundMoney(inClass.reduce((sum, row) => sum + Number(row.outstanding || 0), 0)),
      };
    })
    .filter((row) => row.students > 0);

  const yearCollected = roundMoney(
    yearPayments.filter((row) => isSuccessfulFeeStatus(row.status)).reduce((sum, row) => sum + (Number(row.amount) || 0), 0)
  );

  const yearLedgerRes = await supabase
    .from('fee_payments')
    .select(TERM_PAY_COLUMNS, { count: 'exact' })
    .eq('school_id', schoolId)
    .gte('created_at', `${year}-01-01`)
    .order('created_at', { ascending: false })
    .range((page - 1) * limit, page * limit - 1);
  const yearLedger = annotatePayments(
    (yearLedgerRes.data || []).filter((row) => isSuccessfulFeeStatus(row.status))
  ).map((row) => ({
    id: row.id,
    student_name: row.payer_name,
    class_name: row.payer_class,
    amount: Number(row.amount) || 0,
    channel: row.channel || row.payment_method,
    recorded_by: row.recorded_by_label,
    reference: row.payment_reference,
    payment_month: row.payment_month,
    created_at: row.created_at,
    manual: row.manual,
  }));

  const list = tab === 'unpaid' ? unpaid : paid;
  const searched = search
    ? list.filter((row) =>
        [row.name, row.class, row.recorded_by, row.roll_number, row.barcode]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(search))
      )
    : list;
  const paged = pagedMode ? searched.slice((page - 1) * limit, page * limit) : searched;

  return {
    month,
    term_name: period.name,
    term_starts_on: period.starts_on,
    term_ends_on: period.ends_on,
    period_label: formatPeriodLabel(period),
    year,
    scope,
    terms: await listAcademicTerms(schoolId),
    totals: {
      billed: billed.length,
      paid: paid.length,
      unpaid: unpaid.length,
      paid_amount: roundMoney(paidAmount),
      unpaid_amount: roundMoney(unpaidAmount),
      year_collected: yearCollected,
    },
    chart: { classes: classesChart },
    paid: tab === 'unpaid' && pagedMode ? [] : pagedMode ? paged : paid,
    unpaid: pagedMode ? (tab === 'unpaid' ? paged : []) : unpaid,
    students: pagedMode ? paged : rows,
    items: paged,
    total: searched.length,
    page,
    limit,
    classes: (classes || []).map((row) => row.name).filter(Boolean),
    payments: annotatePayments(payments.filter((row) => paged.some((student) => student.id === row.payer_id))),
    year_ledger: yearLedger,
    year_ledger_total: yearLedgerRes.count || yearLedger.length,
    pay_error: termPayRes.error?.message || yearPayRes.error?.message || yearLedgerRes.error?.message || null,
  };
}

async function sendOwingFeeReminders({
  schoolId,
  schoolName,
  senderName,
  senderRole,
  message,
  confirmSmsPayment,
}) {
  const text = String(message || '').trim();
  if (!text) {
    const err = new Error('Enter a reminder message.');
    err.status = 400;
    throw err;
  }

  const overview = await getFeeOverviewPayload(schoolId);
  const groups = groupOwingParents(overview.unpaid);
  const phones = groups.map((group) => group.phone);
  const bodiesByPhone = buildOwingFeeSmsBodies(text, groups);
  const sample =
    Object.values(bodiesByPhone).sort((left, right) => right.length - left.length)[0] || text;

  if (!confirmSmsPayment) {
    const quote = await quoteSmsForPhones({ schoolId, message: sample, phones });
    return {
      ...quote,
      owing_students: groups.reduce((sum, group) => sum + group.links.length, 0),
      quoted: true,
    };
  }

  const smsSettlement = await settleSmsPayment({
    supabase,
    schoolId,
    schoolName,
    message: sample,
    phones,
  });

  let smsDelivery;
  try {
    smsDelivery = await sendSmsBatch({
      phones: smsSettlement.phones,
      body: sample,
      schoolName,
      bodiesByPhone,
    });
  } catch (sendErr) {
    const refundUnits = smsSettlement.quote?.units_required || 0;
    if (refundUnits > 0) {
      try {
        await refundSchoolAndPlatformUnits({
          schoolId,
          schoolName,
          units: refundUnits,
          reference: smsSettlement.reference,
          reason: 'Refund after fee reminder SMS failed to send',
        });
      } catch (refundErr) {
        console.error('Fee reminder SMS refund failed:', refundErr.message || refundErr);
      }
    }
    throw sendErr;
  }

  const segments = smsSettlement.quote?.segments || 1;
  const failedUnits = (smsDelivery.failed || 0) * segments;
  if (failedUnits > 0) {
    try {
      const refund = await refundSchoolAndPlatformUnits({
        schoolId,
        schoolName,
        units: failedUnits,
        reference: smsSettlement.reference,
        reason: `Refund for ${smsDelivery.failed} failed fee reminder SMS`,
      });
      smsSettlement.school_sms_units = refund.school_balance.units_available;
      smsSettlement.refunded_units = refund.refunded_units;
    } catch (refundErr) {
      console.error('Fee reminder SMS refund failed:', refundErr.message || refundErr);
    }
  }

  if (smsDelivery.sent === 0 && smsDelivery.failed > 0) {
    const err = new Error(
      'SMS provider could not deliver to any owing parent. Units were refunded where possible.'
    );
    err.status = 502;
    err.code = 'SMS_DELIVERY_FAILED';
    err.sms_billing = smsSettlement;
    err.sms_delivery = smsDelivery;
    throw err;
  }

  const stored = attachFeePayLink(
    text,
    groups[0]?.links?.length === 1
      ? groups[0].links[0].url
      : '{each owing student payment link}'
  );
  await supabase.from('messages').insert([
    {
      school_id: schoolId,
      sender_name: senderName,
      sender_role: senderRole,
      send_mode: 'Group',
      recipients: 'Parents (owing fees)',
      message: stored,
      delivery_channel: 'sms',
      created_at: new Date(),
    },
  ]);

  return {
    ok: true,
    owing_students: groups.reduce((sum, group) => sum + group.links.length, 0),
    sms_billing: smsSettlement,
    sms_delivery: {
      sent: smsDelivery.sent,
      failed: smsDelivery.failed,
      total: smsDelivery.total,
      dryRun: smsDelivery.dryRun,
    },
  };
}

export async function recordManualSchoolFee({ schoolId, studentId, amount, method, reference, month, operator }) {
  const period = month ? await getFeePeriodByKey(schoolId, String(month)) : await resolveFeePeriod(schoolId);
  const periodKey = period.key;
  const note = String(reference || '').trim();
  const payMethod = normalizeManualMethod(method);
  const payAmount = roundMoney(amount);
  if (!studentId) {
    const err = new Error('Select a student.');
    err.status = 400;
    throw err;
  }
  if (!payMethod) {
    const err = new Error('Select cash at school or MoMo.');
    err.status = 400;
    throw err;
  }
  if (!(payAmount >= 0.01)) {
    const err = new Error('Enter an amount of at least GHS 0.01.');
    err.status = 400;
    throw err;
  }

  const { data: student, error } = await supabase
    .from('students')
    .select('*')
    .eq('id', studentId)
    .eq('school_id', schoolId)
    .maybeSingle();
  if (error || !student) {
    const err = new Error('Student not found');
    err.status = 404;
    throw err;
  }

  const payment = await recordFeePayment({
    school_id: schoolId,
    payer_type: 'student',
    payer_id: student.id,
    payer_name: student.name,
    payer_class: student.class || null,
    amount: payAmount,
    payment_method: 'manual',
    payment_month: periodKey,
    payment_reference: note ? `manual:${note}` : `manual_${student.id.slice(0, 8)}_${Date.now()}`,
    status: 'success',
    channel: payMethod,
    currency: 'GHS',
    recorded_by_role: operator?.role || 'admin',
    recorded_by_staff_id: operator?.staffId || null,
    recorded_by_name: operator?.name || 'School admin',
  });

  const balance = await refreshStudentFeeStatus({
    schoolId,
    studentId: student.id,
    month: periodKey,
  });

  await creditCashedFeeToWallet({
    schoolId,
    amount: payAmount,
    reference: `feecash_${payment?.payment_reference || payment?.id || Date.now()}`,
    studentName: student.name,
    periodLabel: period.name || periodKey,
  });

  return {
    payment: { ...payment, manual: true, recorded_by_label: describeFeeRecorder(payment) },
    student: {
      id: student.id,
      name: student.name,
      class: student.class || null,
    },
    month: periodKey,
    fee_amount: balance?.fee_amount || 0,
    paid_amount: balance?.paid_amount || payAmount,
    outstanding: balance?.outstanding || 0,
    fully_paid: Boolean(balance?.fully_paid),
  };
}

async function startOfficeMomoCheckout({ schoolId, studentId, amount, month, phone, provider, email }) {
  const { data: student, error } = await supabase
    .from('students')
    .select('*')
    .eq('id', studentId)
    .eq('school_id', schoolId)
    .maybeSingle();
  if (error || !student) {
    const err = new Error('Student not found');
    err.status = 404;
    throw err;
  }

  const period = month ? await getFeePeriodByKey(schoolId, String(month)) : await resolveFeePeriod(schoolId);
  const [classFee, { data: school }] = await Promise.all([
    getClassFeeAmount(schoolId, student.class),
    supabase.from('schools').select('id, name, email').eq('id', schoolId).maybeSingle(),
  ]);
  const feeAmount = resolveStudentFeeAmount(student, classFee);
  const balance = await loadFeeBalance(student, feeAmount, period.key);
  if (balance.fully_paid) {
    const err = new Error(`There is no outstanding payment to make for ${period.name || 'this term'}.`);
    err.status = 409;
    err.code = 'FULLY_PAID';
    throw err;
  }

  const phoneLocal = normalizeGhanaPhone(phone || student.parent_phone);
  if (!/^0\d{9}$/.test(phoneLocal)) {
    const err = new Error('Enter the parent Ghana MoMo number, like 0551234567.');
    err.status = 400;
    throw err;
  }

  if (phoneLocal !== String(student.parent_phone || '').trim()) {
    await supabase.from('students').update({ parent_phone: phoneLocal }).eq('id', student.id).eq('school_id', schoolId);
  }

  const requested = Number(amount);
  const payAmount =
    Number.isFinite(requested) && requested > 0 ? requested : balance.outstanding || feeAmount;

  return startFeePayment({
    student: { ...student, parent_phone: phoneLocal },
    school,
    amount: payAmount,
    month: period.key,
    termName: period.name,
    email: student.parent_email || school?.email || email,
    method: 'momo',
    phone: phoneLocal,
    provider: provider || momoProviderFromGhanaPhone(phoneLocal),
  });
}

async function receiptDetailsForPayment(reference) {
  const resolved = await resolveFeePayment(reference);
  const payload = resolved.payload || {};
  const meta = parsePaystackMetadata(payload.metadata);
  const schoolId = meta.school_id;
  const studentId = meta.student_id;
  const base = {
    status: resolved.status,
    reference: payload.reference || reference,
    amount: fromMinorUnits(payload.amount),
    currency: payload.currency || 'GHS',
    channel: payload.channel || null,
    student_name: meta.payer_name || null,
    class_name: meta.payer_class || null,
    payment_month: meta.payment_month || null,
    needs_code: resolved.needs_code,
    code_type: String(resolved.status || '') === 'send_pin' ? 'pin' : resolved.needs_code ? 'otp' : null,
    display_text: resolved.display_text,
    recorded_by: 'Online',
  };
  if (!schoolId || !studentId) return base;

  const [{ data: student }, { data: school }] = await Promise.all([
    supabase.from('students').select('*').eq('id', studentId).eq('school_id', schoolId).maybeSingle(),
    supabase.from('schools').select('id, name, logo_url').eq('id', schoolId).maybeSingle(),
  ]);
  if (!student) return { ...base, school_name: school?.name || null };
  const classFee = await getClassFeeAmount(schoolId, student.class);
  const period = await resolveFeePeriod(schoolId);
  const feeAmount = resolveStudentFeeAmount(student, classFee);
  const balance = await loadFeeBalance(student, feeAmount, period.key);
  return {
    ...base,
    school_name: school?.name || null,
    school_logo_url: school?.logo_url || null,
    student_name: student.name,
    class_name: student.class || meta.payer_class || null,
    roll_number: student.roll_number || null,
    term_name: period.name,
    period_label: formatPeriodLabel(period),
    payment_month: period.key,
    fee_amount: balance.fee_amount,
    paid_amount: balance.paid_amount,
    outstanding: balance.outstanding,
    fully_paid: balance.fully_paid,
    payments: annotatePayments(balance.payments),
  };
}

async function startFeePayment({
  student,
  school,
  amount,
  month,
  email,
  method = 'bank',
  phone,
  provider,
  termName,
}) {
  const { configured, publicKey } = getPaystackConfig();
  if (!configured) {
    const err = new Error('Paystack is not configured. Add live PAYSTACK_SECRET_KEY on the server.');
    err.status = 503;
    err.code = 'PAYSTACK_NOT_CONFIGURED';
    throw err;
  }
  const payAmount = Number(amount);
  if (!Number.isFinite(payAmount) || payAmount < 1) {
    const err = new Error('Enter an amount of at least GHS 1.00.');
    err.status = 400;
    throw err;
  }

  const payMethod = normalizePayMethod(method) || 'bank';
  const reference = makeWalletReference('fee');
  const frontend = getFrontendBaseUrl();
  const metadata = {
    kind: 'school_fee',
    school_id: student.school_id,
    student_id: student.id,
    payer_name: student.name,
    payer_class: student.class || null,
    barcode: student.barcode || null,
    roll_number: student.roll_number || null,
    payment_month: month,
    term_name: termName || month,
    amount_major: payAmount,
    payment_method: payMethod,
    settle_mode: 'wallet',
    subaccount_code: null,
    recipient_code: null,
    account_id: null,
    cancel_action: `${frontend}/fees`,
  };

  const chargeArgs = {
    email: email || school?.email || `fees+${student.id}@schootype.app`,
    amountMinor: toMinorUnits(payAmount),
    currency: 'GHS',
    reference,
    metadata,
  };

  if (payMethod === 'momo') {
    if (!phone) {
      const err = new Error('Enter the MoMo number, then confirm the PIN on your phone.');
      err.status = 400;
      throw err;
    }
    const phoneLocal = normalizeGhanaPhone(phone);
    if (!/^0\d{9}$/.test(phoneLocal)) {
      const err = new Error('Enter a Ghana MoMo number like 0551234567.');
      err.status = 400;
      throw err;
    }
    const momoNetwork = momoProviderFromGhanaPhone(phoneLocal) || provider;
    if (!momoNetwork) {
      const err = new Error('Enter the MoMo number and network, then confirm the PIN on your phone.');
      err.status = 400;
      throw err;
    }
    // Do not look up/create a payout subaccount first — that extra Paystack
    // call delayed the telco PIN prompt. Settle to the school after success.
    metadata.settle_mode = 'transfer';
    metadata.subaccount_code = null;

    const charge = await chargeMobileMoney({
      ...chargeArgs,
      phone: phoneLocal,
      provider: momoNetwork,
    });
    const status = String(charge?.status || 'pay_offline').toLowerCase();
    const needsCode = chargeLooksLikeCodePrompt(charge);
    const liveMode = String(getPaystackConfig().secretKey || '').startsWith('sk_live_');
    const isTelecel = /vod|telecel/i.test(String(momoNetwork || ''));
    const phoneCancelled = !needsCode && isPaystackUserCancelled(charge);
    let displayText = charge?.display_text || '';
    if (phoneCancelled) {
      displayText = 'Payment was cancelled on the phone. Tap Continue to payment to start again.';
    } else if (!displayText) {
      if (needsCode && isTelecel) {
        displayText = 'Dial the Telecel USSD to get a voucher, then enter that voucher here.';
      } else if (needsCode) {
        displayText = 'Enter the 6-digit code sent for this payment.';
      } else {
        displayText = `A confirmation prompt was sent to ${phoneLocal}. Approve it on your phone.`;
      }
    }
    return {
      mode: 'momo',
      reference: charge?.reference || reference,
      status: phoneCancelled ? 'cancelled' : needsCode && !chargeNeedsCode(status) ? 'send_otp' : status,
      needs_code: needsCode,
      code_type: status === 'send_pin' ? 'pin' : needsCode ? 'otp' : null,
      display_text: displayText,
      authorization_url: charge?.url || charge?.redirecturl || null,
      public_key: publicKey || null,
      amount: payAmount,
      currency: 'GHS',
      month,
      payout_ready: false,
      live_mode: liveMode,
    };
  }

  const payout = await getFeePayoutAccount(student.school_id, school?.name);
  metadata.settle_mode = payout.subaccountCode ? 'subaccount' : payout.recipientCode ? 'transfer' : 'wallet';
  metadata.subaccount_code = payout.subaccountCode || null;
  metadata.recipient_code = payout.recipientCode || null;
  metadata.account_id = payout.account?.id || null;

  const checkoutArgs = {
    ...chargeArgs,
    callbackUrl: `${frontend}/pay/receipt?reference=${encodeURIComponent(reference)}`,
    channels: payMethod === 'bank' ? ['bank', 'bank_transfer'] : GHANA_CHECKOUT_CHANNELS,
    subaccount: payout.subaccountCode || undefined,
    bearer: payout.subaccountCode ? 'subaccount' : undefined,
  };
  let initialized;
  try {
    initialized = await initializeTransaction(checkoutArgs);
  } catch (err) {
    if (checkoutArgs.subaccount) {
      console.warn('Fee checkout without subaccount:', err.message);
      metadata.settle_mode = payout.recipientCode ? 'transfer' : 'wallet';
      metadata.subaccount_code = null;
      initialized = await initializeTransaction({
        ...checkoutArgs,
        subaccount: undefined,
        bearer: undefined,
      });
    } else {
      throw err;
    }
  }
  return {
    mode: 'checkout',
    authorization_url: initialized.authorization_url,
    access_code: initialized.access_code,
    reference,
    public_key: publicKey || null,
    amount: payAmount,
    currency: 'GHS',
    month,
    payout_ready: payout.hasPayout,
  };
}

export function registerFeeRoutes(app, { authenticateToken, enforcePlanApproval }) {
  app.get('/api/academic-terms', authenticateToken, enforcePlanApproval, async (req, res) => {
    try {
      const terms = await listAcademicTerms(req.user.schoolId);
      const current = await resolveFeePeriod(req.user.schoolId);
      res.json({ terms, current });
    } catch (err) {
      console.error('List academic terms error:', err);
      res.status(500).json({ error: err.message || 'Failed to load academic terms' });
    }
  });

  app.put('/api/academic-terms', authenticateToken, enforcePlanApproval, async (req, res) => {
    try {
      const terms = await replaceAcademicTerms(req.user.schoolId, req.body?.terms || []);
      const current = await resolveFeePeriod(req.user.schoolId);
      res.json({ terms, current });
    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message });
      console.error('Save academic terms error:', err);
      res.status(500).json({ error: err.message || 'Failed to save academic terms' });
    }
  });

  app.get('/api/public/fees/verify/:reference', async (req, res) => {
    try {
      const details = await receiptDetailsForPayment(req.params.reference);
      res.json(details);
    } catch (err) {
      if (err.code?.startsWith('PAYSTACK') || err.status) return handlePaystackError(res, err);
      console.error('Fee verify error:', err);
      res.status(500).json({ error: 'Failed to verify fee payment' });
    }
  });

  app.get('/api/public/fees/charge/:reference', async (req, res) => {
    try {
      const resolved = await resolveFeePayment(req.params.reference);
      res.json(momoChargePublicView(resolved, req.params.reference));
    } catch (err) {
      if (err.code?.startsWith('PAYSTACK') || err.status) return handlePaystackError(res, err);
      console.error('Fee charge status error:', err);
      res.status(500).json({ error: 'Failed to check payment status' });
    }
  });

  app.post('/api/public/fees/cancel', async (req, res) => {
    try {
      const reference = String(req.body?.reference || '').trim();
      if (!reference) {
        return res.status(400).json({ error: 'Payment reference is required.' });
      }
      const alreadyPaid = await findSuccessfulFeePayment({ reference });
      if (alreadyPaid) {
        return res.json({ status: 'success', reference, already_paid: true });
      }
      const charge = await readCharge(reference);
      const chargeStatus = String(charge?.status || '').toLowerCase();
      if (chargeStatus === 'success') {
        const resolved = await resolveFeePayment(reference);
        return res.json({ status: 'success', reference, already_paid: true, display_text: resolved.display_text });
      }
      rememberCancelledFee(reference);
      const meta = parsePaystackMetadata(charge?.metadata);
      noteFeePaymentFailed({
        schoolId: meta.school_id,
        reason: 'abandoned',
        message: 'Payment cancelled before MoMo PIN confirmation',
        reference,
        student: studentFromPaystackMeta(meta),
        amount: fromMinorUnits(charge?.amount) || meta.amount_major,
        channel: charge?.channel,
        meta,
      });
      res.json({
        status: 'cancelled',
        reference,
        display_text: 'Payment cancelled. Tap Continue to payment to start again.',
      });
    } catch (err) {
      if (err.code?.startsWith('PAYSTACK') || err.status) return handlePaystackError(res, err);
      console.error('Fee cancel error:', err);
      res.status(500).json({ error: 'Could not cancel this payment' });
    }
  });

  app.get('/api/public/schools', async (_req, res) => {
    try {
      let rows;
      const first = await supabase.from('schools').select('id, name, role').order('name', { ascending: true });
      if (first.error) {
        const retry = await supabase.from('schools').select('id, name').order('name', { ascending: true });
        if (retry.error) throw retry.error;
        rows = retry.data || [];
      } else {
        rows = first.data || [];
      }
      const schools = rows
        .filter((school) => school.name && String(school.role || '') !== 'super_admin')
        .map((school) => ({ id: school.id, name: school.name }));
      res.json({ schools });
    } catch (err) {
      console.error('Public schools list error:', err);
      res.status(500).json({ error: 'Failed to load schools' });
    }
  });

  app.post('/api/public/fees/lookup', async (req, res) => {
    try {
      const schoolId = String(req.body?.schoolId || '').trim();
      const studentId = String(req.body?.studentId || '').trim();
      if (!schoolId || !studentId) {
        return res.status(400).json({ error: 'Select a school and enter the student ID.' });
      }
      const ctx = await loadStudentFeeBySchool(schoolId, studentId);
      if (!ctx) {
        noteUnknownStudentId({ schoolId, studentCode: studentId });
        return res.status(404).json({ error: 'No student with that ID was found at the selected school.' });
      }
      res.json(publicStudentSummary(ctx.student, ctx.school, ctx.amount, ctx.month, ctx.balance, ctx.period));
    } catch (err) {
      console.error('Public fee lookup error:', err);
      res.status(500).json({ error: 'Failed to find this student' });
    }
  });

  app.post('/api/public/fees/pay', async (req, res) => {
    try {
      const schoolId = String(req.body?.schoolId || '').trim();
      const studentId = String(req.body?.studentId || '').trim();
      const method = normalizePayMethod(req.body?.method);
      const amount = Number(req.body?.amount);
      if (!method) return res.status(400).json({ error: 'Select MoMo or bank.' });
      const ctx = await loadStudentFeeBySchool(schoolId, studentId);
      if (!ctx) {
        noteUnknownStudentId({ schoolId, studentCode: studentId });
        return res.status(404).json({ error: 'No student with that ID was found at the selected school.' });
      }
      throwIfFullyPaid(ctx);
      const payment = await startFeePayment({
        student: ctx.student,
        school: ctx.school,
        amount: Number.isFinite(amount) && amount > 0 ? amount : ctx.amount,
        month: ctx.month,
        termName: ctx.period?.name,
        email: req.body?.email || ctx.student.parent_email || ctx.school?.email,
        method,
        phone: req.body?.phone,
        provider: req.body?.provider,
      });
      res.json(payment);
    } catch (err) {
      if (err.code === 'FULLY_PAID' || err.status === 409) {
        return res.status(409).json({ error: err.message, code: 'FULLY_PAID' });
      }
      if (err.code?.startsWith('PAYSTACK') || err.status) {
        noteFeePaymentFailed({
          schoolId: String(req.body?.schoolId || '').trim(),
          reason: 'provider_declined',
          message: err.message || 'Could not start fee payment',
          studentCode: String(req.body?.studentId || '').trim(),
        });
        return handlePaystackError(res, err);
      }
      console.error('Public fee pay error:', err);
      res.status(500).json({ error: 'Failed to start fee payment' });
    }
  });

  app.post('/api/public/fees/authorize', async (req, res) => {
    try {
      const reference = String(req.body?.reference || '').trim();
      const code = String(req.body?.otp || req.body?.pin || req.body?.code || '').trim();
      const codeType = String(req.body?.code_type || req.body?.type || 'otp').toLowerCase();
      if (!reference || !code) {
        return res.status(400).json({ error: 'Enter the code from the prompt to continue.' });
      }
      if (isCancelledFee(reference)) {
        const alreadyPaid = await findSuccessfulFeePayment({ reference });
        if (!alreadyPaid) {
          return res.json({
            mode: 'momo',
            reference,
            status: 'cancelled',
            needs_code: false,
            display_text: 'This payment was cancelled. Tap Continue to payment to start again.',
          });
        }
      }
      const submitCode = async (type) =>
        type === 'pin'
          ? submitChargePin({ reference, pin: code })
          : submitChargeOtp({ reference, otp: code });

      let submitted;
      try {
        submitted = await submitCode(codeType === 'pin' ? 'pin' : 'otp');
      } catch (submitErr) {
        try {
          submitted = await submitCode(codeType === 'pin' ? 'otp' : 'pin');
        } catch {
          throw submitErr;
        }
      }
      const submittedStatus = String(submitted?.status || '').toLowerCase();
      const nextUrl = submitted?.url || submitted?.redirecturl || null;
      const submittedRef = submitted?.reference || reference;

      if (submittedStatus === 'success') {
        await settleSchoolFeeFromPaystack(submitted);
        return res.json({
          mode: 'momo',
          reference: submittedRef,
          status: 'success',
          needs_code: false,
          display_text: submitted?.display_text || null,
          authorization_url: null,
        });
      }

      if (submittedStatus === 'open_url' && nextUrl) {
        return res.json({
          mode: 'momo',
          reference: submittedRef,
          status: 'open_url',
          needs_code: false,
          display_text: submitted?.display_text || null,
          authorization_url: nextUrl,
        });
      }

      if (isPaystackFailedStatus(submittedStatus)) {
        const meta = parsePaystackMetadata(submitted?.metadata);
        noteFeePaymentFailed({
          schoolId: meta.school_id || req.user?.schoolId,
          email: req.user?.email,
          reason: 'provider_declined',
          message: submitted?.display_text || submitted?.gateway_response || 'That code was not accepted.',
          reference: submittedRef,
          student: studentFromPaystackMeta(meta),
          amount: fromMinorUnits(submitted?.amount) || meta.amount_major,
          channel: submitted?.channel,
          meta,
        });
        return res.json({
          mode: 'momo',
          reference: submittedRef,
          status: 'failed',
          needs_code: false,
          display_text: submitted?.display_text || submitted?.gateway_response || 'That code was not accepted.',
          authorization_url: null,
        });
      }

      if (
        submittedStatus &&
        isPaystackPendingStatus(submittedStatus) &&
        submittedStatus !== 'send_otp' &&
        submittedStatus !== 'send_pin'
      ) {
        return res.json({
          mode: 'momo',
          reference: submittedRef,
          status: 'pending',
          needs_code: false,
          display_text:
            submitted?.display_text ||
            'Code accepted. Approve the confirmation on your phone if it appears.',
          authorization_url: null,
        });
      }

      const resolved = await resolveFeePayment(submittedRef);
      const waitingOnPhone = resolved.status === 'pending' && !resolved.needs_code;
      res.json({
        mode: 'momo',
        reference: submittedRef,
        status: resolved.status,
        needs_code: resolved.needs_code,
        display_text:
          resolved.display_text ||
          submitted?.display_text ||
          (waitingOnPhone
            ? 'Code accepted. Approve the confirmation on your phone if it appears.'
            : null),
        authorization_url: null,
      });
    } catch (err) {
      if (err.code?.startsWith('PAYSTACK') || err.status) return handlePaystackError(res, err);
      console.error('Fee authorize error:', err);
      res.status(500).json({ error: 'Could not submit that code' });
    }
  });

  app.get('/api/public/fees/:barcode', async (req, res) => {
    try {
      const ctx = await loadStudentFeeContext(req.params.barcode);
      if (!ctx) {
        noteUnknownStudentId({ studentCode: req.params.barcode });
        return res.status(404).json({ error: 'Student not found' });
      }
      const { student, school, amount, month, balance, period } = ctx;
      res.json(publicStudentSummary(student, school, amount, month, balance, period));
    } catch (err) {
      console.error('Public fee lookup error:', err);
      res.status(500).json({ error: 'Failed to load fee details' });
    }
  });

  app.post('/api/public/fees/:barcode/checkout', async (req, res) => {
    try {
      const ctx = await loadStudentFeeContext(req.params.barcode);
      if (!ctx) {
        noteUnknownStudentId({ studentCode: req.params.barcode });
        return res.status(404).json({ error: 'Student not found' });
      }
      const { student, school, amount, month, period } = ctx;
      throwIfFullyPaid(ctx);
      const requested = Number(req.body?.amount);
      const payAmount = Number.isFinite(requested) && requested > 0 ? requested : amount;
      if (!(payAmount > 0)) {
        return res.status(400).json({ error: 'Enter an amount, or ask the school to set a class fee in Setup.' });
      }
      const checkout = await startFeePayment({
        student,
        school,
        amount: payAmount,
        month,
        termName: period?.name,
        email: req.body?.email || student.parent_email || school?.email,
        method: req.body?.method || 'bank',
        phone: req.body?.phone,
        provider: req.body?.provider,
      });
      res.json(checkout);
    } catch (err) {
      if (err.code === 'FULLY_PAID' || err.status === 409) {
        return res.status(409).json({ error: err.message, code: 'FULLY_PAID' });
      }
      if (err.code?.startsWith('PAYSTACK') || err.status) {
        noteFeePaymentFailed({
          reason: 'provider_declined',
          message: err.message || 'Could not start fee payment',
          studentCode: req.params.barcode,
        });
        return handlePaystackError(res, err);
      }
      console.error('Fee checkout error:', err);
      res.status(500).json({ error: 'Failed to start fee payment' });
    }
  });

  app.get('/api/fees/overview', authenticateToken, enforcePlanApproval, async (req, res) => {
    try {
      const payload = await getFeeOverviewPayload(req.user.schoolId, req.query);
      res.json(payload);
    } catch (err) {
      console.error('Fee overview error:', err);
      res.status(500).json({ error: err.message || 'Failed to load fees' });
    }
  });

  app.post('/api/fees/reminder', authenticateToken, enforcePlanApproval, async (req, res) => {
    try {
      const { data: school } = await supabase
        .from('schools')
        .select('id, name')
        .eq('id', req.user.schoolId)
        .maybeSingle();
      const result = await sendOwingFeeReminders({
        schoolId: req.user.schoolId,
        schoolName: school?.name || 'School',
        senderName: req.user.email || 'Admin',
        senderRole: 'Admin',
        message: req.body?.message,
        confirmSmsPayment: Boolean(req.body?.confirmSmsPayment),
      });
      res.json(result);
    } catch (err) {
      if (err.status) {
        return res.status(err.status).json({
          error: err.message,
          code: err.code || undefined,
          sms_billing: err.sms_billing,
          sms_delivery: err.sms_delivery,
        });
      }
      console.error('Fee reminder SMS error:', err);
      res.status(500).json({ error: err.message || 'Failed to send fee reminders' });
    }
  });

  app.post('/api/fees/manual', authenticateToken, enforcePlanApproval, async (req, res) => {
    try {
      const result = await recordManualSchoolFee({
        schoolId: req.user.schoolId,
        studentId: String(req.body?.studentId || '').trim(),
        amount: req.body?.amount,
        method: req.body?.method,
        reference: req.body?.reference || req.body?.note,
        month: req.body?.month,
        operator: {
          role: 'admin',
          name: req.user.email || 'School admin',
        },
      });
      res.json(result);
    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message });
      console.error('Manual fee record error:', err);
      res.status(500).json({ error: err.message || 'Failed to record this payment' });
    }
  });

  app.patch('/api/fees/manual/:paymentId', authenticateToken, enforcePlanApproval, async (req, res) => {
    try {
      const schoolId = req.user.schoolId;
      const paymentId = String(req.params.paymentId || '').trim();
      const amount = req.body?.amount == null ? undefined : roundMoney(req.body.amount);
      const method = req.body?.method == null ? undefined : normalizeManualMethod(req.body.method);
      if (amount != null && !(amount >= 0.01)) {
        return res.status(400).json({ error: 'Enter an amount of at least GHS 0.01.' });
      }
      if (req.body?.method != null && !method) {
        return res.status(400).json({ error: 'Select cash at school or MoMo.' });
      }

      const updated = await updateManualFeePayment({
        schoolId,
        paymentId,
        amount,
        method,
        reference: req.body?.reference,
      });
      const payment = updated.payment || updated;
      const previousAmount = Number(updated.previousAmount) || Number(payment.amount) || 0;
      const balance = await refreshStudentFeeStatus({
        schoolId,
        studentId: payment.payer_id,
        month: payment.payment_month,
      });
      const nextAmount = Number(payment.amount) || 0;
      if (nextAmount > previousAmount + 0.009) {
        const period = await getFeePeriodByKey(schoolId, payment.payment_month);
        await creditCashedFeeToWallet({
          schoolId,
          amount: roundMoney(nextAmount - previousAmount),
          reference: `feecash_adj_${payment.id}_${Date.now()}`,
          studentName: payment.payer_name,
          periodLabel: period.name || payment.payment_month,
        });
      }

      res.json({
        payment: { ...payment, manual: true },
        month: payment.payment_month,
        fee_amount: balance?.fee_amount || 0,
        paid_amount: balance?.paid_amount || 0,
        outstanding: balance?.outstanding || 0,
        fully_paid: Boolean(balance?.fully_paid),
      });
    } catch (err) {
      if (err.status === 403 || err.status === 404 || err.status === 400) {
        return res.status(err.status).json({ error: err.message, code: err.code || undefined });
      }
      console.error('Manual fee update error:', err);
      res.status(500).json({ error: err.message || 'Failed to update this payment' });
    }
  });

  app.post('/api/fees/:studentId/checkout', authenticateToken, enforcePlanApproval, async (req, res) => {
    try {
      const { data: student, error } = await supabase
        .from('students')
        .select('*')
        .eq('id', req.params.studentId)
        .eq('school_id', req.user.schoolId)
        .maybeSingle();
      if (error || !student) return res.status(404).json({ error: 'Student not found' });
      const [classFee, { data: school }] = await Promise.all([
        getClassFeeAmount(student.school_id, student.class),
        supabase.from('schools').select('id, name, email').eq('id', student.school_id).maybeSingle(),
      ]);
      const period = await resolveFeePeriod(student.school_id);
      const month = period.key;
      const amount = resolveStudentFeeAmount(student, classFee);
      if (!(amount > 0)) {
        return res.status(400).json({ error: 'Set a class fee in Setup before collecting payment.' });
      }
      const balance = await loadFeeBalance(student, amount, month);
      if (balance.fully_paid) {
        return res.status(409).json({
          error: `There is no outstanding payment to make for ${period.name}.`,
          code: 'ALREADY_PAID',
        });
      }
      const payMethod = normalizePayMethod(req.body?.method) || 'momo';
      if (payMethod === 'momo') {
        const checkout = await startOfficeMomoCheckout({
          schoolId: req.user.schoolId,
          studentId: student.id,
          amount: req.body?.amount,
          month: req.body?.month || month,
          phone: req.body?.phone,
          provider: req.body?.provider,
          email: student.parent_email || req.user.email,
        });
        return res.json({
          ...checkout,
          pay_url: `${getFrontendBaseUrl()}/pay/${encodeURIComponent(student.barcode)}`,
        });
      }
      const checkout = await startFeePayment({
        student,
        school,
        amount: Number(req.body?.amount) > 0 ? Number(req.body.amount) : balance.outstanding || amount,
        month,
        termName: period.name,
        email: student.parent_email || req.user.email,
        method: payMethod,
        phone: req.body?.phone,
        provider: req.body?.provider,
      });
      res.json({
        ...checkout,
        pay_url: `${getFrontendBaseUrl()}/pay/${encodeURIComponent(student.barcode)}`,
      });
    } catch (err) {
      if (err.code?.startsWith('PAYSTACK') || err.status) return handlePaystackError(res, err);
      console.error('Admin fee checkout error:', err);
      res.status(500).json({ error: 'Failed to start fee payment' });
    }
  });
}

export function registerStaffFeeRoutes(app, { authenticateStaffPortal }) {
  const requireAccountant = (req, res, next) => {
    if (String(req.staffPortal?.role || '').toLowerCase() !== 'accountant') {
      return res.status(403).json({ error: 'Only accountants can record payments or send reminders here' });
    }
    next();
  };

  const requireFeeViewer = (req, res, next) => {
    const role = String(req.staffPortal?.role || '').toLowerCase();
    if (role === 'accountant' || isSchoolHeadRole(role)) return next();
    return res.status(403).json({ error: 'Only the administrator or accountant can view fees here' });
  };

  app.get(
    '/api/staff-portal/session/fees/overview',
    authenticateStaffPortal,
    requireFeeViewer,
    async (req, res) => {
      try {
        const payload = await getFeeOverviewPayload(req.staffPortal.schoolId, req.query);
        res.json(payload);
      } catch (err) {
        console.error('Accountant fee overview error:', err);
        res.status(500).json({ error: err.message || 'Failed to load fees' });
      }
    }
  );

  app.post(
    '/api/staff-portal/session/fees/checkout',
    authenticateStaffPortal,
    requireAccountant,
    async (req, res) => {
      try {
        const checkout = await startOfficeMomoCheckout({
          schoolId: req.staffPortal.schoolId,
          studentId: String(req.body?.studentId || '').trim(),
          amount: req.body?.amount,
          month: req.body?.month,
          phone: req.body?.phone,
          provider: req.body?.provider,
          email: req.staffPortal.email,
        });
        res.json(checkout);
      } catch (err) {
        if (err.code === 'FULLY_PAID' || err.status === 409) {
          return res.status(409).json({ error: err.message, code: 'FULLY_PAID' });
        }
        if (err.code?.startsWith('PAYSTACK') || err.status) return handlePaystackError(res, err);
        console.error('Accountant MoMo checkout error:', err);
        res.status(500).json({ error: err.message || 'Failed to send the MoMo prompt' });
      }
    }
  );

  app.post(
    '/api/staff-portal/session/fees/manual',
    authenticateStaffPortal,
    requireAccountant,
    async (req, res) => {
      try {
        const result = await recordManualSchoolFee({
          schoolId: req.staffPortal.schoolId,
          studentId: String(req.body?.studentId || '').trim(),
          amount: req.body?.amount,
          method: req.body?.method,
          reference: req.body?.reference || req.body?.note,
          month: req.body?.month,
          operator: {
            role: 'accountant',
            staffId: req.staffPortal.staffId,
            name: req.staffPortal.staffName || 'Accountant',
          },
        });
        res.json(result);
      } catch (err) {
        if (err.status) return res.status(err.status).json({ error: err.message });
        console.error('Accountant fee record error:', err);
        res.status(500).json({ error: err.message || 'Failed to record this payment' });
      }
    }
  );

  app.patch(
    '/api/staff-portal/session/fees/manual/:paymentId',
    authenticateStaffPortal,
    requireAccountant,
    async (req, res) => {
      try {
        const schoolId = req.staffPortal.schoolId;
        const paymentId = String(req.params.paymentId || '').trim();
        const amount = req.body?.amount == null ? undefined : roundMoney(req.body.amount);
        const method = req.body?.method == null ? undefined : normalizeManualMethod(req.body.method);
        if (amount != null && !(amount >= 0.01)) {
          return res.status(400).json({ error: 'Enter an amount of at least GHS 0.01.' });
        }
        if (req.body?.method != null && !method) {
          return res.status(400).json({ error: 'Select cash at school or MoMo.' });
        }

        const updated = await updateManualFeePayment({
          schoolId,
          paymentId,
          amount,
          method,
          reference: req.body?.reference,
        });
        const payment = updated.payment || updated;
        const previousAmount = Number(updated.previousAmount) || Number(payment.amount) || 0;
        const balance = await refreshStudentFeeStatus({
          schoolId,
          studentId: payment.payer_id,
          month: payment.payment_month,
        });
        const nextAmount = Number(payment.amount) || 0;
        if (nextAmount > previousAmount + 0.009) {
          const period = await getFeePeriodByKey(schoolId, payment.payment_month);
          await creditCashedFeeToWallet({
            schoolId,
            amount: roundMoney(nextAmount - previousAmount),
            reference: `feecash_adj_${payment.id}_${Date.now()}`,
            studentName: payment.payer_name,
            periodLabel: period.name || payment.payment_month,
          });
        }

        res.json({
          payment: { ...payment, manual: true, recorded_by_label: describeFeeRecorder(payment) },
          month: payment.payment_month,
          fee_amount: balance?.fee_amount || 0,
          paid_amount: balance?.paid_amount || 0,
          outstanding: balance?.outstanding || 0,
          fully_paid: Boolean(balance?.fully_paid),
        });
      } catch (err) {
        if (err.status === 403 || err.status === 404 || err.status === 400) {
          return res.status(err.status).json({ error: err.message, code: err.code || undefined });
        }
        console.error('Accountant fee update error:', err);
        res.status(500).json({ error: err.message || 'Failed to update this payment' });
      }
    }
  );

  app.post(
    '/api/staff-portal/session/fees/reminder',
    authenticateStaffPortal,
    requireAccountant,
    async (req, res) => {
      try {
        const { data: school } = await supabase
          .from('schools')
          .select('id, name')
          .eq('id', req.staffPortal.schoolId)
          .maybeSingle();
        const result = await sendOwingFeeReminders({
          schoolId: req.staffPortal.schoolId,
          schoolName: school?.name || 'School',
          senderName: req.staffPortal.staffName || 'Accountant',
          senderRole: 'Accountant',
          message: req.body?.message,
          confirmSmsPayment: Boolean(req.body?.confirmSmsPayment),
        });
        res.json(result);
      } catch (err) {
        if (err.status) {
          return res.status(err.status).json({
            error: err.message,
            code: err.code || undefined,
            sms_billing: err.sms_billing,
            sms_delivery: err.sms_delivery,
          });
        }
        console.error('Accountant fee reminder error:', err);
        res.status(500).json({ error: err.message || 'Failed to send fee reminders' });
      }
    }
  );
}
