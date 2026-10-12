import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { supabase } from './supabaseClient.js';
import { getPlan, resolvePlanId } from './plans.js';
import { initializeSubscription } from './subscription.js';
import { upsertSchoolExtras, deleteSchoolExtras, getSchoolExtrasSync, parsePaymentRecords } from './schoolPlanStore.js';
import {
  getPaystackConfig,
  initializeTransaction,
  verifyTransaction,
  toMinorUnits,
  GHANA_CHECKOUT_CHANNELS,
  chargeMobileMoney,
  fetchCharge,
  submitChargeOtp,
  submitChargePin,
  normalizeGhanaPhone,
  momoProviderFromGhanaPhone,
  ghanaMomoProvider,
  chargeNeedsCode,
  chargeLooksLikeCodePrompt,
  chargeInstructionReady,
  waitForMomoInstruction,
  isPaystackUserCancelled,
  isPaystackPendingStatus,
  isPaystackFailedStatus,
} from './paystack.js';
import { parsePaystackMetadata } from './feePayments.js';
import { creditInternalFunds, makeWalletReference } from './schoolWalletStore.js';
import { findPlatformSchoolId } from './smsBilling.js';
import {
  createEmailVerificationToken,
  buildVerifyEmailUrl,
  buildVerificationEmail,
  PASSWORD_SETUP_MARKER,
  getFrontendBaseUrl,
} from './emailVerification.js';

const SIGNUP_KIND = 'school_signup';
const PLAN_KIND = 'school_plan';
const memoryPending = new Map();
const inFlight = new Map();
const cancelledSignupRefs = new Set();
const PLAN_CHECKOUT_CHANNELS = ['mobile_money', ...GHANA_CHECKOUT_CHANNELS.filter((c) => c !== 'mobile_money')];
let tableAvailable = true;
let deps = {};

export function initSchoolSignupPayment(handlers = {}) {
  deps = handlers;
}

function isMissingTable(error) {
  const msg = String(error?.message || error?.details || error?.hint || '').toLowerCase();
  return error?.code === '42P01' || msg.includes('does not exist') || msg.includes('could not find the table');
}

function requirePaystack() {
  const config = getPaystackConfig();
  if (!config.configured) {
    const err = new Error(
      'Online payment is not configured. Set PAYSTACK_SECRET_KEY on the server before creating an account.'
    );
    err.status = 503;
    err.code = 'PAYSTACK_NOT_CONFIGURED';
    throw err;
  }
  return config;
}

function requirePlan(paymentPlan) {
  const resolved = resolvePlanId(paymentPlan);
  const plan = getPlan(resolved);
  if (!plan || !Number.isFinite(Number(plan.price)) || Number(plan.price) < 1) {
    const err = new Error('A valid payment plan is required');
    err.status = 400;
    throw err;
  }
  return { resolved, plan };
}

function rememberPending(row) {
  if (row?.paystack_reference) memoryPending.set(row.paystack_reference, row);
  return row;
}

async function savePendingSignup(row) {
  const payload = {
    email: row.email,
    school_name: row.school_name,
    logo_url: row.logo_url || null,
    payment_plan: row.payment_plan,
    google_signup: Boolean(row.google_signup),
    paystack_reference: row.paystack_reference,
    status: 'pending',
    created_at: new Date().toISOString(),
  };

  if (tableAvailable) {
    try {
      await supabase
        .from('pending_signups')
        .update({ status: 'replaced' })
        .eq('email', row.email)
        .eq('status', 'pending');
    } catch {
      // ignore — insert below is the source of truth
    }

    const { data, error } = await supabase.from('pending_signups').insert([payload]).select().single();
    if (!error && data) return rememberPending({ ...payload, ...data });
    if (error && isMissingTable(error)) {
      tableAvailable = false;
    } else if (error) {
      console.warn('pending_signups insert failed, using memory fallback:', error.message);
    }
  }

  return rememberPending({ id: row.paystack_reference, ...payload });
}

async function getPendingByReference(reference) {
  const cached = memoryPending.get(reference);
  if (tableAvailable) {
    const { data, error } = await supabase
      .from('pending_signups')
      .select('*')
      .eq('paystack_reference', reference)
      .maybeSingle();
    if (!error && data) return rememberPending(data);
    if (error && isMissingTable(error)) tableAvailable = false;
  }
  return cached || null;
}

async function markPendingFulfilled(reference, schoolId) {
  memoryPending.delete(reference);
  if (!tableAvailable) return;
  const { error } = await supabase
    .from('pending_signups')
    .update({
      status: 'fulfilled',
      school_id: schoolId || null,
      fulfilled_at: new Date().toISOString(),
    })
    .eq('paystack_reference', reference);
  if (error && isMissingTable(error)) tableAvailable = false;
}

function checkoutCallbackUrl(reference) {
  return `${getFrontendBaseUrl()}/signup/complete?reference=${encodeURIComponent(reference)}`;
}

function momoChargeView(charge, reference, extras = {}) {
  const status = String(charge?.status || extras.status || 'pending').toLowerCase();
  const needsCode = extras.needs_code != null ? extras.needs_code : chargeLooksLikeCodePrompt(charge);
  const nextUrl = charge?.url || charge?.redirecturl || extras.authorization_url || null;
  return {
    mode: extras.mode || 'momo',
    requiresPayment: true,
    authorization_url: nextUrl,
    access_code: extras.access_code || null,
    public_key: extras.public_key || getPaystackConfig().publicKey || null,
    reference: charge?.reference || reference,
    status: extras.status || (needsCode && !chargeNeedsCode(status) ? 'send_otp' : status || 'pending'),
    needs_code: Boolean(needsCode),
    code_type: status === 'send_pin' ? 'pin' : needsCode ? 'otp' : extras.code_type || null,
    display_text: extras.display_text || charge?.display_text || null,
    amount: extras.amount,
    currency: 'GHS',
    plan: extras.plan,
    live_mode: extras.live_mode,
  };
}

async function chargePlanWithMomo({ email, amountMajor, reference, metadata, phone, provider }) {
  const phoneLocal = normalizeGhanaPhone(phone);
  if (!/^0\d{9}$/.test(phoneLocal)) {
    const err = new Error('Enter a Ghana MoMo number like 0551234567.');
    err.status = 400;
    err.code = 'INVALID_MOMO_NUMBER';
    throw err;
  }
  const momoNetwork = momoProviderFromGhanaPhone(phoneLocal) || ghanaMomoProvider(provider);
  if (!momoNetwork) {
    const err = new Error('Enter the MoMo number so Paystack can send the PIN prompt to the phone.');
    err.status = 400;
    throw err;
  }

  cancelledSignupRefs.delete(reference);

  let charge = await chargeMobileMoney({
    email,
    amountMinor: toMinorUnits(amountMajor),
    currency: 'GHS',
    phone: phoneLocal,
    provider: momoNetwork,
    reference,
    metadata,
  });
  if (!chargeInstructionReady(charge?.status)) {
    charge = await waitForMomoInstruction(charge?.reference || reference, charge, {
      attempts: 10,
      delayMs: 300,
    });
  }

  const status = String(charge?.status || '').toLowerCase();
  const nextUrl = charge?.url || charge?.redirecturl || null;
  const needsCode = chargeLooksLikeCodePrompt(charge);
  const liveMode = String(getPaystackConfig().secretKey || '').startsWith('sk_live_');
  const isTelecel = /vod|telecel/i.test(String(momoNetwork || ''));
  const phoneCancelled = !needsCode && isPaystackUserCancelled(charge);

  // Paystack sometimes returns open_url instead of pay_offline. Opening that
  // URL is what actually triggers the telco PIN prompt.
  if ((status === 'open_url' || nextUrl) && !needsCode && !phoneCancelled && status !== 'success') {
    return momoChargeView(charge, reference, {
      status: 'open_url',
      needs_code: false,
      authorization_url: nextUrl,
      display_text: charge?.display_text || 'Continue on Paystack to approve the MoMo PIN on your phone.',
      amount: amountMajor,
      plan: metadata.payment_plan,
      live_mode: liveMode,
    });
  }

  let displayText = charge?.display_text || '';
  if (phoneCancelled) {
    displayText = 'Payment was cancelled on the phone. Start payment again.';
  } else if (!displayText) {
    if (needsCode && isTelecel) {
      displayText = 'Dial the Telecel USSD to get a voucher, then enter that voucher here.';
    } else if (needsCode) {
      displayText = 'Enter the 6-digit code sent for this payment.';
    } else if (status === 'pay_offline') {
      displayText = `A confirmation prompt was sent to ${phoneLocal}. Approve it on your phone.`;
    } else {
      displayText = 'Waiting for the MoMo confirmation prompt.';
    }
  }

  return momoChargeView(charge, reference, {
    status: phoneCancelled ? 'cancelled' : needsCode && !chargeNeedsCode(status) ? 'send_otp' : status || 'pending',
    needs_code: needsCode,
    display_text: displayText,
    amount: amountMajor,
    plan: metadata.payment_plan,
    live_mode: liveMode,
  });
}

async function initializePlanCheckout({ email, amountMajor, reference, metadata }) {
  const init = await initializeTransaction({
    email,
    amountMinor: toMinorUnits(amountMajor),
    currency: 'GHS',
    reference,
    callbackUrl: checkoutCallbackUrl(reference),
    channels: PLAN_CHECKOUT_CHANNELS,
    metadata,
  });
  return {
    mode: 'checkout',
    authorization_url: init.authorization_url,
    access_code: init.access_code,
    public_key: getPaystackConfig().publicKey || null,
    reference: init.reference || reference,
    requiresPayment: true,
    amount: amountMajor,
    currency: 'GHS',
    plan: metadata.payment_plan,
  };
}

async function startPlanPayment({ email, amountMajor, reference, metadata }) {
  return initializePlanCheckout({ email, amountMajor, reference, metadata });
}

export async function startSchoolSignupCheckout({
  email,
  schoolName,
  logo,
  paymentPlan,
  googleSignup = false,
  method,
  phone,
  provider,
}) {
  requirePaystack();
  const { resolved, plan } = requirePlan(paymentPlan);
  const reference = makeWalletReference('signup');

  await savePendingSignup({
    email,
    school_name: schoolName,
    logo_url: logo || null,
    payment_plan: resolved,
    google_signup: googleSignup,
    paystack_reference: reference,
  });

  return startPlanPayment({
    email,
    amountMajor: plan.price,
    reference,
    metadata: {
      kind: SIGNUP_KIND,
      payment_plan: resolved,
      email,
      school_name: String(schoolName || '').slice(0, 80),
      google_signup: googleSignup ? '1' : '0',
      custom_fields: [
        { display_name: 'School', variable_name: 'school_name', value: String(schoolName || '').slice(0, 40) },
        { display_name: 'Plan', variable_name: 'plan', value: plan.name },
      ],
    },
  });
}

export async function startSchoolPlanCheckout({ schoolId, email, schoolName, paymentPlan, method, phone, provider }) {
  requirePaystack();
  const { resolved, plan } = requirePlan(paymentPlan);
  const reference = makeWalletReference('splan');

  return startPlanPayment({
    email,
    amountMajor: plan.price,
    reference,
    metadata: {
      kind: PLAN_KIND,
      school_id: schoolId,
      payment_plan: resolved,
      email,
      school_name: String(schoolName || '').slice(0, 80),
      custom_fields: [
        { display_name: 'School', variable_name: 'school_name', value: String(schoolName || '').slice(0, 40) },
        { display_name: 'Plan', variable_name: 'plan', value: plan.name },
      ],
    },
  });
}

function isSignupChargeReference(reference, pending) {
  const ref = String(reference || '');
  if (pending) return true;
  return ref.startsWith('signup_') || ref.startsWith('splan_');
}

async function readSignupCharge(reference) {
  try {
    return await fetchCharge(reference);
  } catch {
    return null;
  }
}

export async function resolveSignupCharge(reference) {
  const ref = String(reference || '').trim();
  if (!ref) {
    const err = new Error('Payment reference is required');
    err.status = 400;
    throw err;
  }
  const pending = await getPendingByReference(ref);
  if (!isSignupChargeReference(ref, pending)) {
    const err = new Error('Payment not found');
    err.status = 404;
    throw err;
  }

  let charge = await readSignupCharge(ref);
  if (!charge) {
    await new Promise((resolve) => setTimeout(resolve, 400));
    charge = await readSignupCharge(ref);
  }
  const chargeStatus = String(charge?.status || '').toLowerCase();
  const nextUrl = charge?.url || charge?.redirecturl || null;

  if (chargeStatus === 'success') {
    const fulfilled = await fulfillSchoolCheckout(ref);
    return {
      ...momoChargeView(charge, ref, {
        status: fulfilled?.ok === false ? 'pending' : 'success',
        needs_code: false,
        display_text: fulfilled?.ok === false ? fulfilled.error : charge?.display_text,
      }),
      fulfillment: fulfilled?.ok ? fulfilled : null,
      pending: fulfilled?.ok === false ? Boolean(fulfilled.pending) : false,
    };
  }

  if (chargeLooksLikeCodePrompt(charge) || chargeStatus === 'send_otp' || chargeStatus === 'send_pin') {
    return momoChargeView(charge, ref, {
      status: chargeNeedsCode(chargeStatus) ? chargeStatus : 'send_otp',
      needs_code: true,
      display_text: charge?.display_text || 'Enter the 6-digit code sent for this payment.',
    });
  }

  if ((chargeStatus === 'open_url' || nextUrl) && chargeStatus !== 'failed') {
    return momoChargeView(charge, ref, {
      status: 'open_url',
      needs_code: false,
      authorization_url: nextUrl,
      display_text: charge?.display_text || 'Continue on Paystack to approve the MoMo PIN on your phone.',
    });
  }

  if (cancelledSignupRefs.has(ref)) {
    return momoChargeView(charge || { reference: ref }, ref, {
      status: 'cancelled',
      needs_code: false,
      display_text: 'This payment was cancelled. Start payment again.',
    });
  }

  if (charge && isPaystackUserCancelled(charge)) {
    cancelledSignupRefs.add(ref);
    return momoChargeView(charge, ref, {
      status: 'cancelled',
      needs_code: false,
      display_text: 'Payment was cancelled on the phone. Start payment again.',
    });
  }

  if (charge && isPaystackFailedStatus(chargeStatus)) {
    return momoChargeView(charge, ref, {
      status: 'failed',
      needs_code: false,
      display_text: charge.display_text || charge.gateway_response || 'Payment declined.',
    });
  }

  if (charge && isPaystackPendingStatus(chargeStatus)) {
    try {
      const verified = await verifyTransaction(ref);
      const txStatus = String(verified?.status || '').toLowerCase();
      if (txStatus === 'success') {
        const fulfilled = await fulfillSchoolCheckout(ref);
        return {
          ...momoChargeView(verified, ref, { status: 'success', needs_code: false }),
          fulfillment: fulfilled?.ok ? fulfilled : null,
        };
      }
    } catch {
      // Still waiting for the phone PIN.
    }
    return momoChargeView(charge, ref, {
      status: chargeStatus === 'pay_offline' ? 'pay_offline' : 'pending',
      needs_code: false,
      display_text: charge.display_text || 'Waiting for confirmation on the phone.',
    });
  }

  try {
    const verified = await verifyTransaction(ref);
    const txStatus = String(verified?.status || '').toLowerCase();
    if (txStatus === 'success') {
      const fulfilled = await fulfillSchoolCheckout(ref);
      return {
        ...momoChargeView(verified, ref, { status: 'success', needs_code: false }),
        fulfillment: fulfilled?.ok ? fulfilled : null,
      };
    }
  } catch {
    // Keep waiting.
  }

  return momoChargeView(charge || { reference: ref }, ref, {
    status: 'pending',
    needs_code: false,
    display_text: charge?.display_text || 'Waiting for confirmation.',
  });
}

export async function authorizeSignupCharge({ reference, otp, codeType }) {
  const ref = String(reference || '').trim();
  const code = String(otp || '').trim();
  if (!ref || !code) {
    const err = new Error('Enter the code from the prompt to continue.');
    err.status = 400;
    throw err;
  }
  const submitCode = async (type) =>
    type === 'pin' ? submitChargePin({ reference: ref, pin: code }) : submitChargeOtp({ reference: ref, otp: code });

  let submitted;
  try {
    submitted = await submitCode(String(codeType || 'otp').toLowerCase() === 'pin' ? 'pin' : 'otp');
  } catch (submitErr) {
    try {
      submitted = await submitCode(String(codeType || 'otp').toLowerCase() === 'pin' ? 'otp' : 'pin');
    } catch {
      throw submitErr;
    }
  }

  const submittedStatus = String(submitted?.status || '').toLowerCase();
  const submittedRef = submitted?.reference || ref;
  const nextUrl = submitted?.url || submitted?.redirecturl || null;

  if (submittedStatus === 'success') {
    const fulfilled = await fulfillSchoolCheckout(submittedRef);
    return {
      ...momoChargeView(submitted, submittedRef, { status: 'success', needs_code: false }),
      fulfillment: fulfilled?.ok ? fulfilled : null,
    };
  }

  if ((submittedStatus === 'open_url' || nextUrl) && nextUrl) {
    return momoChargeView(submitted, submittedRef, {
      status: 'open_url',
      needs_code: false,
      authorization_url: nextUrl,
    });
  }

  if (isPaystackFailedStatus(submittedStatus)) {
    return momoChargeView(submitted, submittedRef, {
      status: 'failed',
      needs_code: false,
      display_text: submitted?.display_text || submitted?.gateway_response || 'That code was not accepted.',
    });
  }

  return resolveSignupCharge(submittedRef);
}

export async function cancelSignupCharge(reference) {
  const ref = String(reference || '').trim();
  if (!ref) {
    const err = new Error('Payment reference is required');
    err.status = 400;
    throw err;
  }
  const resolved = await resolveSignupCharge(ref).catch(() => null);
  if (resolved?.status === 'success') return resolved;
  cancelledSignupRefs.add(ref);
  return momoChargeView({ reference: ref }, ref, {
    status: 'cancelled',
    needs_code: false,
    display_text: 'Payment cancelled. Start payment again.',
  });
}

function isSuccessfulCharge(status) {
  return String(status || '').toLowerCase() === 'success';
}

function checkoutKindFrom(metadata, reference, pending) {
  if (metadata.kind === SIGNUP_KIND || metadata.kind === PLAN_KIND) return metadata.kind;
  if (pending) return SIGNUP_KIND;
  const ref = String(reference || '');
  if (ref.startsWith('signup_')) return SIGNUP_KIND;
  if (ref.startsWith('splan_')) return PLAN_KIND;
  return null;
}

async function creditPlatformSubscription({ school, plan, reference }) {
  const amountMinor = toMinorUnits(plan.price);
  const platformSchoolId = await findPlatformSchoolId(supabase);
  if (!platformSchoolId || amountMinor <= 0) return;
  try {
    await creditInternalFunds(platformSchoolId, amountMinor, {
      reference,
      description: `Subscription payment · ${school.name || 'school'}`,
      metadata: {
        kind: 'subscription_payment',
        from_school_id: school.id,
        plan_id: plan.id,
      },
    });
  } catch (walletErr) {
    console.warn('Failed to credit platform wallet from signup payment:', walletErr.message || walletErr);
  }
}

function paymentRecordsFor(schoolId, plan) {
  const extras = getSchoolExtrasSync(schoolId) || {};
  const records = parsePaymentRecords(extras);
  records.unshift({
    amount: plan.price,
    plan_id: plan.id,
    plan_name: plan.name,
    recorded_at: new Date().toISOString(),
    source: 'paystack',
  });
  return records;
}

async function persistApprovedSchool(schoolId, { plan }) {
  const subscription = initializeSubscription();
  const extras = {
    payment_plan: plan.id,
    plan_status: 'approved',
    plan_selected_at: new Date().toISOString(),
    ...subscription,
    subscription_frozen: false,
    total_paid: (Number(getSchoolExtrasSync(schoolId)?.total_paid) || 0) + Number(plan.price || 0),
    payment_records: JSON.stringify(paymentRecordsFor(schoolId, plan)),
  };

  if (deps.updateSchoolRecord) {
    await deps.updateSchoolRecord(schoolId, {
      payment_plan: plan.id,
      plan_selected_at: new Date(),
      plan_status: 'approved',
      ...subscription,
      subscription_frozen: false,
    });
  }

  await upsertSchoolExtras(schoolId, extras);
  return extras;
}

async function loadSchoolById(schoolId) {
  const { data, error } = await supabase.from('schools').select('*').eq('id', schoolId).maybeSingle();
  if (error) throw error;
  return data;
}

async function activateExistingSchool(school, { plan, reference }) {
  const alreadyApproved = (school.plan_status || '') === 'approved' && school.subscription_started_at;
  if (!alreadyApproved) {
    await persistApprovedSchool(school.id, { plan });
  }
  await creditPlatformSubscription({ school, plan, reference });
  const fresh = (await loadSchoolById(school.id)) || school;
  return fresh;
}

async function createPaidSchool({ pending, metadata, plan, reference, googleSignup }) {
  const email = String(pending?.email || metadata.email || '').trim().toLowerCase();
  const schoolName = String(pending?.school_name || metadata.school_name || '').trim();
  if (!email || !schoolName) {
    const err = new Error('Paid checkout is missing school details. Start signup again.');
    err.status = 400;
    throw err;
  }

  const existing = deps.findSchoolByEmail ? await deps.findSchoolByEmail(email) : null;
  if (existing) {
    const activated = await activateExistingSchool(existing, { plan, reference });
    await markPendingFulfilled(reference, activated.id);
    return { school: activated, created: false, googleSignup: Boolean(existing.email_verified) };
  }

  const hashedPassword = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
  const subscription = initializeSubscription();
  const schoolRecord = {
    name: schoolName,
    email,
    password_hash: hashedPassword,
    initial_password: googleSignup ? null : PASSWORD_SETUP_MARKER,
    role: 'admin',
    created_at: new Date(),
    payment_plan: plan.id,
    plan_selected_at: new Date(),
    plan_status: 'approved',
    email_verified: Boolean(googleSignup),
    ...subscription,
    subscription_frozen: false,
    total_paid: plan.price,
  };
  if (pending?.logo_url) schoolRecord.logo_url = pending.logo_url;

  let rawToken = null;
  if (!googleSignup) {
    const tokens = createEmailVerificationToken();
    rawToken = tokens.rawToken;
    schoolRecord.email_verification_token = tokens.tokenHash;
    schoolRecord.email_verification_expires_at = tokens.expiresAt;
  }

  const inserted = await deps.insertSchoolRecord(schoolRecord);
  if (inserted.error?.duplicate) {
    const again = deps.findSchoolByEmail ? await deps.findSchoolByEmail(email) : null;
    if (!again) {
      const err = new Error('An account with this email already exists. Please log in instead.');
      err.status = 409;
      throw err;
    }
    const activated = await activateExistingSchool(again, { plan, reference });
    await markPendingFulfilled(reference, activated.id);
    return { school: activated, created: false, googleSignup: Boolean(again.email_verified), rawToken: null };
  }
  if (inserted.error || !inserted.data) {
    const err = new Error(inserted.error?.message || 'Failed to create school after payment.');
    err.status = 500;
    err.code = inserted.error?.code;
    throw err;
  }

  const school = inserted.data;
  try {
    await upsertSchoolExtras(school.id, {
      payment_plan: plan.id,
      plan_status: 'approved',
      plan_selected_at: new Date().toISOString(),
      logo_url: pending?.logo_url || null,
      ...subscription,
      subscription_frozen: false,
      total_paid: plan.price,
      payment_records: JSON.stringify([
        {
          amount: plan.price,
          plan_id: plan.id,
          plan_name: plan.name,
          recorded_at: new Date().toISOString(),
          source: 'paystack',
        },
      ]),
    });
  } catch (persistError) {
    await supabase.from('schools').delete().eq('id', school.id);
    await deleteSchoolExtras(school.id);
    throw persistError;
  }

  await creditPlatformSubscription({ school, plan, reference });
  await markPendingFulfilled(reference, school.id);

  if (deps.recordPlatformEvent) {
    deps.recordPlatformEvent({
      eventType: 'signup',
      schoolId: school.id,
      schoolName: school.name,
      email,
      role: 'admin',
      path: '/signup',
    }).catch(() => {});
  }

  return { school, created: true, googleSignup, rawToken };
}

async function sendSignupVerification(school, rawToken) {
  if (!rawToken || !deps.sendAuthEmail) return { emailSendFailed: false };
  const verifyUrl = buildVerifyEmailUrl(rawToken);
  if (!verifyUrl) return { emailSendFailed: true };
  const mail = buildVerificationEmail({
    schoolName: school.name,
    email: school.email,
    verifyUrl,
    paid: true,
  });
  try {
    await deps.sendAuthEmail({
      to: school.email,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    });
    return { emailSendFailed: false };
  } catch (mailError) {
    console.error('Verification email send failed after payment:', mailError.message);
    return { emailSendFailed: true };
  }
}

function formatResult(school, { googleSignup, created, emailSendFailed }) {
  const formatted = deps.formatSchool ? deps.formatSchool(school) : school;
  const session =
    googleSignup && deps.signAuthToken
      ? {
          token: deps.signAuthToken(school),
          ...(deps.authTokenPayload ? deps.authTokenPayload() : {}),
        }
      : {};
  return {
    ok: true,
    created: Boolean(created),
    requiresEmailVerification: !googleSignup,
    emailSendFailed: Boolean(emailSendFailed),
    email: school.email,
    school: formatted,
    ...session,
  };
}

async function fulfillSchoolCheckoutOnce(reference) {
  const verified = await verifyTransaction(reference);
  const status = String(verified?.status || '').toLowerCase();
  if (!isSuccessfulCharge(status)) {
    return {
      ok: false,
      pending: status !== 'failed' && status !== 'reversed' && status !== 'abandoned',
      status,
      error: 'Payment has not been completed yet.',
    };
  }

  const metadata = parsePaystackMetadata(verified.metadata);
  const pending = await getPendingByReference(reference);
  const kind = checkoutKindFrom(metadata, reference, pending);
  const planId = metadata.payment_plan || pending?.payment_plan;
  const { plan } = requirePlan(planId);
  const paidMinor = Number(verified.amount);
  const expectedMinor = toMinorUnits(plan.price);
  if (Number.isFinite(paidMinor) && paidMinor + 1 < expectedMinor) {
    const err = new Error('Paid amount does not match the selected plan.');
    err.status = 400;
    throw err;
  }

  if (kind === PLAN_KIND && metadata.school_id) {
    const school = await loadSchoolById(metadata.school_id);
    if (!school) {
      const err = new Error('School not found for this payment.');
      err.status = 404;
      throw err;
    }
    const activated = await activateExistingSchool(school, { plan, reference });
    return formatResult(activated, { googleSignup: true, created: false, emailSendFailed: false });
  }

  if (kind !== SIGNUP_KIND && kind !== PLAN_KIND) {
    return { ok: false, ignored: true };
  }

  if (pending?.status === 'fulfilled' && pending.school_id) {
    const existing = await loadSchoolById(pending.school_id);
    if (existing) {
      return formatResult(existing, {
        googleSignup: Boolean(pending.google_signup || existing.email_verified),
        created: false,
        emailSendFailed: false,
      });
    }
  }

  const googleSignup =
    pending?.google_signup === true ||
    metadata.google_signup === '1' ||
    metadata.google_signup === true;

  const created = await createPaidSchool({
    pending,
    metadata,
    plan,
    reference,
    googleSignup,
  });

  let emailSendFailed = false;
  if (created.created && !created.googleSignup && created.rawToken) {
    const mailed = await sendSignupVerification(created.school, created.rawToken);
    emailSendFailed = mailed.emailSendFailed;
  }

  return formatResult(created.school, {
    googleSignup: created.googleSignup,
    created: created.created,
    emailSendFailed,
  });
}

export async function fulfillSchoolCheckout(reference) {
  const ref = String(reference || '').trim();
  if (!ref) {
    const err = new Error('Payment reference is required');
    err.status = 400;
    throw err;
  }
  if (inFlight.has(ref)) return inFlight.get(ref);
  const job = fulfillSchoolCheckoutOnce(ref).finally(() => {
    inFlight.delete(ref);
  });
  inFlight.set(ref, job);
  return job;
}

export function isSchoolCheckoutKind(metadata, reference) {
  const kind = parsePaystackMetadata(metadata).kind;
  if (kind === SIGNUP_KIND || kind === PLAN_KIND) return true;
  const ref = String(reference || '');
  return ref.startsWith('signup_') || ref.startsWith('splan_');
}
