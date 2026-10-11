import crypto from 'crypto';

const PAYSTACK_BASE = 'https://api.paystack.co';

export const GHANA_CHECKOUT_CHANNELS = ['card', 'bank', 'bank_transfer', 'mobile_money'];

export function getPaystackConfig() {
  const secretKey = process.env.PAYSTACK_SECRET_KEY || '';
  const publicKey = process.env.PAYSTACK_PUBLIC_KEY || '';
  const currency = (process.env.PAYSTACK_CURRENCY || 'GHS').toUpperCase();
  return {
    secretKey,
    publicKey,
    currency,
    configured: Boolean(secretKey),
  };
}

async function paystackRequest(path, { method = 'GET', body } = {}) {
  const { secretKey } = getPaystackConfig();
  if (!secretKey) {
    const err = new Error('Paystack is not configured. Set PAYSTACK_SECRET_KEY in backend/.env');
    err.code = 'PAYSTACK_NOT_CONFIGURED';
    err.status = 503;
    throw err;
  }

  const response = await fetch(`${PAYSTACK_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const payload = await response.json().catch(() => ({}));

  // Charge + OTP/PIN follow-ups use "Charge attempted" with data.status
  // like pay_offline / pending / send_otp / success — that is NOT a failure.
  const isChargePath = path === '/charge' || path.startsWith('/charge/');
  const chargeStarted =
    isChargePath &&
    payload?.data &&
    (payload.status === true ||
      String(payload.message || '').toLowerCase() === 'charge attempted');

  if (chargeStarted) {
    return {
      ...payload.data,
      _paystack_message: payload.message || null,
    };
  }

  if (!response.ok || payload.status === false) {
    const err = new Error(payload.message || `Paystack request failed (${response.status})`);
    err.code = 'PAYSTACK_API_ERROR';
    err.status = response.status >= 400 ? response.status : 502;
    err.payload = payload;
    throw err;
  }

  return payload.data;
}

export function toMinorUnits(amountMajor) {
  return Math.round(Number(amountMajor) * 100);
}

export function fromMinorUnits(amountMinor) {
  return Number(amountMinor || 0) / 100;
}

export function verifyPaystackSignature(rawBody, signature) {
  const { secretKey } = getPaystackConfig();
  if (!secretKey || !signature || rawBody == null) return false;
  const hash = crypto.createHmac('sha512', secretKey).update(rawBody).digest('hex');
  try {
    const expected = Buffer.from(hash, 'utf8');
    const received = Buffer.from(String(signature), 'utf8');
    if (expected.length !== received.length) return false;
    return crypto.timingSafeEqual(expected, received);
  } catch {
    return false;
  }
}

export async function listBanks({ currency = 'GHS', type } = {}) {
  const params = new URLSearchParams({ currency });
  if (type) params.set('type', type);
  return paystackRequest(`/bank?${params.toString()}`);
}

export async function resolveAccountNumber({ accountNumber, bankCode }) {
  const params = new URLSearchParams({
    account_number: String(accountNumber),
    bank_code: String(bankCode),
  });
  return paystackRequest(`/bank/resolve?${params.toString()}`);
}

export async function createTransferRecipient({ type, name, accountNumber, bankCode, currency }) {
  return paystackRequest('/transferrecipient', {
    method: 'POST',
    body: {
      type,
      name,
      account_number: String(accountNumber),
      bank_code: String(bankCode),
      currency,
    },
  });
}

/** Percent of each fee payment kept by the platform. Schools receive the rest. */
export function getPlatformFeePercent() {
  const n = Number(process.env.PAYSTACK_PLATFORM_PERCENT);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : 0;
}

/**
 * Creates a Paystack split subaccount so parent fee payments settle into
 * this school's own bank (or MoMo) instead of the platform merchant.
 */
export async function createSubaccount({
  businessName,
  bankCode,
  accountNumber,
  percentageCharge,
  description,
}) {
  return paystackRequest('/subaccount', {
    method: 'POST',
    body: {
      business_name: businessName,
      settlement_bank: String(bankCode),
      account_number: String(accountNumber),
      percentage_charge:
        percentageCharge == null ? getPlatformFeePercent() : Number(percentageCharge),
      description: description || undefined,
    },
  });
}

export async function initializeTransaction({
  email,
  amountMinor,
  currency,
  reference,
  callbackUrl,
  channels,
  metadata,
  subaccount,
  bearer,
}) {
  const body = {
    email,
    amount: amountMinor,
    currency,
    reference,
    callback_url: callbackUrl,
    channels,
    metadata,
  };
  if (subaccount) {
    body.subaccount = subaccount;
    body.bearer = bearer || 'subaccount';
  }
  return paystackRequest('/transaction/initialize', {
    method: 'POST',
    body,
  });
}

/** Ghana local format Paystack expects, e.g. 0551234567 */
export function normalizeGhanaPhone(phone) {
  let digits = String(phone || '').replace(/\D/g, '');
  if (digits.startsWith('233') && digits.length >= 12) {
    digits = `0${digits.slice(3)}`;
  }
  if (digits.length === 9) {
    digits = `0${digits}`;
  }
  return digits;
}

/** Map UI/network labels to Paystack Ghana MoMo provider codes. */
export function ghanaMomoProvider(provider) {
  const value = String(provider || '').toLowerCase();
  if (value === 'mtn' || value.includes('mtn')) return 'mtn';
  if (value === 'vod' || value.includes('vod') || value.includes('telecel')) return 'vod';
  if (
    value === 'tgo' ||
    value === 'atl' ||
    value.includes('airtel') ||
    value.includes('tigo') ||
    value === 'at'
  ) {
    return 'atl';
  }
  return value;
}

/** Paystack requires the telco that owns the MSISDN, not the dropdown label. */
export function momoProviderFromGhanaPhone(phone) {
  const local = normalizeGhanaPhone(phone);
  const prefix = local.slice(0, 3);
  if (['024', '025', '053', '054', '055', '059', '023'].includes(prefix)) return 'mtn';
  if (['020', '050'].includes(prefix)) return 'vod';
  if (['026', '027', '056', '057'].includes(prefix)) return 'atl';
  return null;
}

export async function chargeMobileMoney({
  email,
  amountMinor,
  currency,
  phone,
  provider,
  reference,
  metadata,
}) {
  const phoneLocal = normalizeGhanaPhone(phone);
  if (!/^0\d{9}$/.test(phoneLocal)) {
    const err = new Error('Enter a Ghana MoMo number like 0551234567.');
    err.status = 400;
    err.code = 'INVALID_MOMO_NUMBER';
    throw err;
  }

  // Do not send subaccount/bearer here. Extra split fields make Paystack treat
  // the charge like card checkout and SMS a PIN instead of the MoMo prompt.
  const providerCode = momoProviderFromGhanaPhone(phoneLocal) || ghanaMomoProvider(provider);
  return paystackRequest('/charge', {
    method: 'POST',
    body: {
      email,
      amount: amountMinor,
      currency: 'GHS',
      reference,
      metadata,
      mobile_money: {
        phone: phoneLocal,
        provider: providerCode,
      },
    },
  });
}

export async function submitChargeOtp({ reference, otp }) {
  return paystackRequest('/charge/submit_otp', {
    method: 'POST',
    body: {
      reference,
      otp: String(otp || '').trim(),
    },
  });
}

export async function submitChargePin({ reference, pin }) {
  return paystackRequest('/charge/submit_pin', {
    method: 'POST',
    body: {
      reference,
      pin: String(pin || '').trim(),
    },
  });
}

export async function verifyTransaction(reference) {
  return paystackRequest(`/transaction/verify/${encodeURIComponent(reference)}`);
}

/** Charge API status for MoMo/OTP flows. Do not use transaction/verify for this. */
export async function fetchCharge(reference) {
  return paystackRequest(`/charge/${encodeURIComponent(reference)}`);
}

export function chargeNeedsCode(status) {
  const value = String(status || '').toLowerCase();
  return value === 'send_otp' || value === 'send_pin';
}

export function chargeLooksLikeCodePrompt(charge) {
  if (chargeNeedsCode(charge?.status)) return true;
  const text = `${charge?.display_text || ''} ${charge?.gateway_response || ''} ${charge?._paystack_message || ''}`.toLowerCase();
  return /\botp\b|voucher|verification code|enter (the )?(pin|code)|one[- ]time/.test(text);
}

export function chargeInstructionReady(status) {
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

export async function waitForMomoInstruction(reference, initial, { attempts = 2, delayMs = 180 } = {}) {
  let charge = initial;
  for (let i = 0; i < attempts; i++) {
    const status = String(charge?.status || '').toLowerCase();
    if (chargeInstructionReady(status) || chargeLooksLikeCodePrompt(charge)) return charge;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    try {
      charge = (await fetchCharge(reference)) || charge;
    } catch {
      // Keep the last known charge while Paystack catches up.
    }
  }
  return charge;
}

export function isPaystackPendingStatus(status) {
  const value = String(status || '').toLowerCase();
  return [
    'pending',
    'ongoing',
    'processing',
    'queued',
    'pay_offline',
    'send_otp',
    'send_pin',
    'send_birthday',
    'send_phone',
    'open_url',
  ].includes(value);
}

export function isPaystackFailedStatus(status) {
  const value = String(status || '').toLowerCase();
  return value === 'failed' || value === 'timeout' || value === 'reversed';
}

export function isPaystackUserCancelled(charge) {
  const status = String(charge?.status || '').toLowerCase();
  if (
    status === 'success' ||
    status === 'send_otp' ||
    status === 'send_pin' ||
    status === 'pay_offline' ||
    status === 'pending' ||
    status === 'ongoing' ||
    status === 'open_url'
  ) {
    return false;
  }
  const text = `${charge?.display_text || ''} ${charge?.gateway_response || ''} ${charge?._paystack_message || ''}`.toLowerCase();
  if (!text.trim()) return false;
  return (
    (status === 'failed' || status === 'timeout') &&
    /(cancelled by (the )?(user|customer|holder)|user cancelled|customer cancelled|canceled by (the )?(user|customer)|declined by (the )?(user|customer))/i.test(
      text
    )
  );
}

export async function initiateTransfer({
  amountMinor,
  currency,
  recipientCode,
  reference,
  reason,
}) {
  return paystackRequest('/transfer', {
    method: 'POST',
    body: {
      source: 'balance',
      amount: amountMinor,
      currency,
      recipient: recipientCode,
      reference,
      reason,
    },
  });
}

export function momoProviderFromBankCode(bankCode) {
  const code = String(bankCode || '').toUpperCase();
  if (code === 'MTN' || code.includes('MTN')) return 'mtn';
  // Paystack accepts atl (docs) and some bank lists use ATL / AIRTELTIGO / TGO
  if (
    code === 'ATL' ||
    code === 'TGO' ||
    code.includes('AIRTEL') ||
    code.includes('TIGO') ||
    code.includes('AT ')
  ) {
    return 'atl';
  }
  if (code === 'VOD' || code.includes('VOD') || code.includes('TELECEL')) return 'vod';
  return String(bankCode || '').toLowerCase();
}
