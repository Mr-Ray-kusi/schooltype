import { supabase } from './supabaseClient.js';

export const ABSENT_SMS_TEMPLATE =
  '{student_name} did not come to school today. Please contact {school_name} if this is unexpected.';

export const OWING_SMS_TEMPLATE =
  'Dear Parent, please settle outstanding school fees this term. Pay here: {pay_link} You can pay with MoMo, bank transfer, or USSD.';

const MAX_TEMPLATE_LENGTH = 480;

const cache = new Map();

const defaultTemplates = () => ({
  absent: ABSENT_SMS_TEMPLATE,
  owing: OWING_SMS_TEMPLATE,
});

const isMissingColumn = (error, column) => {
  const msg = String(error?.message || error?.details || error?.hint || '');
  return (
    msg.includes(column) &&
    (msg.includes('does not exist') ||
      msg.includes('Could not find') ||
      msg.includes('schema cache') ||
      error?.code === 'PGRST204')
  );
};

export function requireSmsTemplate(value) {
  const text = String(value || '')
    .replace(/\u0000/g, '')
    .trim();
  if (!text) {
    const err = new Error('Enter a message.');
    err.status = 400;
    throw err;
  }
  if (text.length > MAX_TEMPLATE_LENGTH) {
    const err = new Error(`Keep the message under ${MAX_TEMPLATE_LENGTH} characters.`);
    err.status = 400;
    throw err;
  }
  return text;
}

export function fillSmsTemplate(template, values = {}) {
  return String(template || '')
    .replace(/\{(student_name|school_name|school|class|pay_link)\}/g, (_, key) => {
      if (key === 'school') return String(values.school_name || values.school || '');
      return String(values[key] ?? '');
    })
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

async function readFromDb(schoolId) {
  const { data, error } = await supabase
    .from('schools')
    .select('absent_sms_template, owing_sms_template')
    .eq('id', schoolId)
    .maybeSingle();
  if (error || !data) return null;
  return {
    absent: String(data.absent_sms_template || '').trim() || ABSENT_SMS_TEMPLATE,
    owing: String(data.owing_sms_template || '').trim() || OWING_SMS_TEMPLATE,
  };
}

export async function getSchoolSmsTemplates(schoolId) {
  if (!schoolId) return defaultTemplates();
  if (cache.has(schoolId)) return cache.get(schoolId);
  try {
    const loaded = await readFromDb(schoolId);
    if (loaded) {
      cache.set(schoolId, loaded);
      return loaded;
    }
  } catch (error) {
    console.warn('SMS template load failed:', error.message || error);
  }
  return defaultTemplates();
}

async function persistTemplates(schoolId, next) {
  let payload = {
    absent_sms_template: next.absent,
    owing_sms_template: next.owing,
  };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (!Object.keys(payload).length) return;
    const { error } = await supabase.from('schools').update(payload).eq('id', schoolId);
    if (!error) return;
    const missing = Object.keys(payload).find((column) => isMissingColumn(error, column));
    if (!missing) {
      console.warn('SMS template save failed:', error.message || error);
      return;
    }
    const rest = { ...payload };
    delete rest[missing];
    payload = rest;
  }
}

export async function saveSchoolSmsTemplates(schoolId, patch = {}) {
  if (!schoolId) return defaultTemplates();
  const current = cache.get(schoolId) || (await getSchoolSmsTemplates(schoolId));
  const next = {
    absent: patch.absent !== undefined ? requireSmsTemplate(patch.absent) : current.absent,
    owing: patch.owing !== undefined ? requireSmsTemplate(patch.owing) : current.owing,
  };
  cache.set(schoolId, next);
  try {
    await persistTemplates(schoolId, next);
  } catch (error) {
    console.warn('SMS template save failed:', error.message || error);
  }
  return next;
}
