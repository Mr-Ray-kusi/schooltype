/**
 * Twilio SMS delivery for school broadcasts.
 *
 * Env:
 *   TWILIO_ACCOUNT_SID
 *   TWILIO_AUTH_TOKEN
 *   TWILIO_FROM_NUMBER          (+E.164)  OR
 *   TWILIO_MESSAGING_SERVICE_SID
 *   SMS_DEFAULT_COUNTRY_CODE   (default 233 for Ghana)
 *   SMS_DRY_RUN=true           log only, do not call Twilio
 */

import twilio from 'twilio';

const DEFAULT_COUNTRY = String(process.env.SMS_DEFAULT_COUNTRY_CODE || '233').replace(/\D/g, '');
const CONCURRENCY = Math.min(10, Math.max(1, Number(process.env.SMS_SEND_CONCURRENCY) || 5));

let client = null;

function isDryRun() {
  return String(process.env.SMS_DRY_RUN || '').toLowerCase() === 'true';
}

export function getTwilioConfig() {
  const accountSid = String(process.env.TWILIO_ACCOUNT_SID || '').trim();
  const authToken = String(process.env.TWILIO_AUTH_TOKEN || '').trim();
  const fromNumber = String(process.env.TWILIO_FROM_NUMBER || '').trim();
  const messagingServiceSid = String(process.env.TWILIO_MESSAGING_SERVICE_SID || '').trim();

  const configured = Boolean(
    accountSid &&
      authToken &&
      accountSid.startsWith('AC') &&
      (fromNumber.startsWith('+') || messagingServiceSid.startsWith('MG'))
  );

  return {
    configured,
    dryRun: isDryRun(),
    accountSid: configured ? accountSid : null,
    fromNumber: fromNumber || null,
    messagingServiceSid: messagingServiceSid || null,
    defaultCountryCode: DEFAULT_COUNTRY,
  };
}

export function getSmsProviderStatus() {
  const cfg = getTwilioConfig();
  if (cfg.dryRun) {
    return {
      provider: 'twilio',
      ready: true,
      mode: 'dry_run',
      message: 'SMS_DRY_RUN is on — messages are logged, not sent via Twilio.',
    };
  }
  if (!cfg.configured) {
    return {
      provider: 'twilio',
      ready: false,
      mode: 'unconfigured',
      message:
        'Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER (or TWILIO_MESSAGING_SERVICE_SID).',
    };
  }
  return {
    provider: 'twilio',
    ready: true,
    mode: 'live',
    message: `Twilio ready (${cfg.messagingServiceSid ? 'Messaging Service' : cfg.fromNumber}).`,
  };
}

export async function fetchTwilioAccountBalance() {
  const cfg = getTwilioConfig();
  if (cfg.dryRun || !cfg.configured) return null;
  try {
    const bal = await getClient().balance.fetch();
    return {
      amount: Number(bal.balance),
      currency: String(bal.currency || 'USD').toUpperCase(),
    };
  } catch (err) {
    console.warn('Twilio balance fetch failed:', err.message || err);
    return null;
  }
}

function getClient() {
  const cfg = getTwilioConfig();
  if (!cfg.configured) {
    const err = new Error(getSmsProviderStatus().message);
    err.code = 'SMS_PROVIDER_NOT_CONFIGURED';
    err.status = 503;
    throw err;
  }
  if (!client) {
    client = twilio(process.env.TWILIO_ACCOUNT_SID.trim(), process.env.TWILIO_AUTH_TOKEN.trim());
  }
  return client;
}

/**
 * Normalize to E.164. Ghana-friendly defaults (0XXXXXXXXX → +233XXXXXXXXX).
 * Returns null when the number cannot be used.
 */
export function toE164(phone, defaultCountryCode = DEFAULT_COUNTRY) {
  if (phone == null) return null;
  let raw = String(phone).trim();
  if (!raw) return null;

  // Keep leading + for international; strip other punctuation
  const hasPlus = raw.startsWith('+');
  let digits = raw.replace(/\D/g, '');
  if (!digits) return null;

  if (hasPlus) {
    if (digits.length < 8 || digits.length > 15) return null;
    return `+${digits}`;
  }

  // Ghana local 0XXXXXXXXX (10 digits)
  if (digits.startsWith('0') && digits.length === 10) {
    return `+${defaultCountryCode}${digits.slice(1)}`;
  }

  // Already starts with country code without +
  if (digits.startsWith(defaultCountryCode) && digits.length >= 11 && digits.length <= 15) {
    return `+${digits}`;
  }

  // 9-digit national (missing leading 0)
  if (digits.length === 9 && defaultCountryCode === '233') {
    return `+${defaultCountryCode}${digits}`;
  }

  // Bare international without +
  if (digits.length >= 10 && digits.length <= 15) {
    return `+${digits}`;
  }

  return null;
}

function uniquePhones(phones) {
  const seen = new Set();
  const out = [];
  for (const p of phones) {
    const e164 = toE164(p);
    if (!e164 || seen.has(e164)) continue;
    seen.add(e164);
    out.push(e164);
  }
  return out;
}

/**
 * Resolve concrete E.164 numbers for a school broadcast.
 * Only returns numbers that can actually be dialed — no phoneless inflation.
 */
export async function resolveSmsRecipients(supabase, schoolId, { sendMode, recipients, recipientPhone }) {
  if (sendMode === 'Individual') {
    const e164 = toE164(recipientPhone);
    return e164 ? [e164] : [];
  }

  const group = String(recipients || 'Parents');
  const phones = [];

  const wantsParents =
    group === 'Parents' ||
    group === 'All Parents' ||
    group === 'All' ||
    group.includes('Parents');

  const wantsTeachers = group === 'Teachers' || group.includes('Teachers');
  const wantsStaff = group === 'Staff' || group.includes('Staff');
  const wantsNonStaff = group === 'Non-Staff' || group === 'NonStaff' || group.includes('Non-Staff');

  if (wantsParents) {
    const { data, error } = await supabase
      .from('students')
      .select('parent_phone')
      .eq('school_id', schoolId)
      .not('parent_phone', 'is', null)
      .neq('parent_phone', '');

    if (error) throw error;
    for (const row of data || []) {
      phones.push(row.parent_phone);
    }
  }

  // Staff/teachers: no phone column yet — skip silently (quote will show 0 if only those groups)
  if (wantsTeachers || wantsStaff) {
    // Reserved for future staff.phone support
  }
  if (wantsNonStaff) {
    // Reserved for future nonstaff.phone support
  }

  return uniquePhones(phones);
}

async function sendOne(to, body) {
  if (isDryRun()) {
    console.log(`[SMS dry-run] → ${to}: ${String(body).slice(0, 80)}`);
    return { to, ok: true, sid: `DRY_${Date.now()}`, error: null };
  }

  const cfg = getTwilioConfig();
  const twilioClient = getClient();
  const payload = { to, body };
  if (cfg.messagingServiceSid) {
    payload.messagingServiceSid = cfg.messagingServiceSid;
  } else {
    payload.from = cfg.fromNumber;
  }

  try {
    const msg = await twilioClient.messages.create(payload);
    return { to, ok: true, sid: msg.sid, error: null };
  } catch (err) {
    const message = err?.message || String(err);
    console.warn(`[SMS] Failed to ${to}:`, message);
    return { to, ok: false, sid: null, error: message };
  }
}

/**
 * Send SMS to many recipients with limited concurrency.
 * Does not throw on per-recipient failure — returns a summary.
 */
export function attachFeePayLink(message, payUrl) {
  const url = String(payUrl || '').trim();
  const trimmed = String(message || '')
    .replace(/\s*https?:\/\/[^\s]+\/fees\/?\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!url) return trimmed;
  if (trimmed.includes(url)) return trimmed;
  if (trimmed.includes('{pay_link}')) return trimmed.split('{pay_link}').join(url);
  if (/the payment link/i.test(trimmed)) return trimmed.replace(/the payment link/gi, url);
  if (/payment link/i.test(trimmed)) return trimmed.replace(/payment link/gi, url);
  return `${trimmed}\nPay here: ${url}`;
}

export async function sendSmsBatch({ phones, body, schoolName, bodiesByPhone }) {
  const status = getSmsProviderStatus();
  if (!status.ready) {
    const err = new Error(status.message);
    err.code = 'SMS_PROVIDER_NOT_CONFIGURED';
    err.status = 503;
    throw err;
  }

  const list = uniquePhones(phones);
  if (!list.length) {
    return { sent: 0, failed: 0, total: 0, results: [], dryRun: isDryRun() };
  }

  const prefix = schoolName ? `${String(schoolName).slice(0, 40)}: ` : '';

  const results = [];
  for (let i = 0; i < list.length; i += CONCURRENCY) {
    const chunk = list.slice(i, i + CONCURRENCY);
    const chunkResults = await Promise.all(
      chunk.map((to) => {
        const raw = bodiesByPhone?.[to] || body;
        return sendOne(to, `${prefix}${String(raw || '')}`.slice(0, 1500));
      })
    );
    results.push(...chunkResults);
  }

  const sent = results.filter((r) => r.ok).length;
  const failed = results.length - sent;

  return {
    sent,
    failed,
    total: results.length,
    results,
    dryRun: isDryRun(),
  };
}
