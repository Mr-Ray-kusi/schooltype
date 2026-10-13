import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import { openLocalDb } from './localDb.js';
import { getDataDir } from './dataPaths.js';
import { supabase } from './supabaseClient.js';

const DATA_DIR = getDataDir();
const DB_PATH = path.join(DATA_DIR, 'school-extras.db');

const SETTINGS_ID = 'platform';
/** Default: 0.05 GHS per SMS unit (5 pesewas). */
const DEFAULT_UNIT_PRICE_MINOR = 5;

let dbPromise = null;

/** Prefer Supabase on Vercel (or when SMS_STORE=supabase). */
function useCloudSms() {
  return Boolean(process.env.VERCEL) || String(process.env.SMS_STORE || '').toLowerCase() === 'supabase';
}

async function getDb() {
  if (useCloudSms()) {
    throw new Error('LOCAL_SMS_DB_SKIP');
  }
  if (!dbPromise) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    dbPromise = Promise.resolve(openLocalDb(DB_PATH)).then(async (db) => {
      await db.exec(`
        CREATE TABLE IF NOT EXISTS platform_sms_settings (
          id TEXT PRIMARY KEY,
          units_available INTEGER NOT NULL DEFAULT 0,
          unit_price_minor INTEGER NOT NULL DEFAULT ${DEFAULT_UNIT_PRICE_MINOR},
          total_revenue_minor INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT
        );

        CREATE TABLE IF NOT EXISTS platform_sms_sales (
          id TEXT PRIMARY KEY,
          school_id TEXT NOT NULL,
          school_name TEXT,
          units INTEGER NOT NULL,
          amount_minor INTEGER NOT NULL,
          recipients_count INTEGER NOT NULL,
          segments INTEGER NOT NULL,
          reference TEXT UNIQUE NOT NULL,
          message_preview TEXT,
          sale_type TEXT NOT NULL DEFAULT 'broadcast',
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS school_sms_balances (
          school_id TEXT PRIMARY KEY,
          units_available INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_sms_sales_school ON platform_sms_sales(school_id);
        CREATE INDEX IF NOT EXISTS idx_sms_sales_created ON platform_sms_sales(created_at);
      `);

      try {
        await db.exec(
          `ALTER TABLE platform_sms_sales ADD COLUMN sale_type TEXT NOT NULL DEFAULT 'broadcast'`
        );
      } catch {
        // column exists
      }

      const existing = await db.get('SELECT id FROM platform_sms_settings WHERE id = ?', [
        SETTINGS_ID,
      ]);
      if (!existing) {
        await db.run(
          `INSERT INTO platform_sms_settings
            (id, units_available, unit_price_minor, total_revenue_minor, updated_at)
           VALUES (?, 0, ?, 0, ?)`,
          [SETTINGS_ID, DEFAULT_UNIT_PRICE_MINOR, new Date().toISOString()]
        );
      }
      return db;
    });
  }
  return dbPromise;
}

function nowIso() {
  return new Date().toISOString();
}

function mapSettings(row) {
  return {
    units_available: Number(row?.units_available) || 0,
    unit_price_minor: Number(row?.unit_price_minor ?? DEFAULT_UNIT_PRICE_MINOR),
    total_revenue_minor: Number(row?.total_revenue_minor) || 0,
    updated_at: row?.updated_at || null,
  };
}

async function ensureCloudSettingsRow() {
  const { data } = await supabase
    .from('platform_sms_settings')
    .select('*')
    .eq('id', SETTINGS_ID)
    .maybeSingle();
  if (data) return data;
  const seed = {
    id: SETTINGS_ID,
    units_available: 0,
    unit_price_minor: DEFAULT_UNIT_PRICE_MINOR,
    total_revenue_minor: 0,
    updated_at: nowIso(),
  };
  const { error } = await supabase.from('platform_sms_settings').insert([seed]);
  if (error && !String(error.message || '').toLowerCase().includes('duplicate')) {
    throw error;
  }
  return seed;
}

export async function initPlatformSmsStore() {
  if (useCloudSms()) {
    if (!supabase) {
      throw new Error(
        'Supabase is required for SMS billing on Vercel. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.'
      );
    }
    await ensureCloudSettingsRow();
    return;
  }
  await getDb();
}

export async function getSmsSettings() {
  if (useCloudSms()) {
    const row = await ensureCloudSettingsRow();
    return mapSettings(row);
  }
  const db = await getDb();
  const row = await db.get('SELECT * FROM platform_sms_settings WHERE id = ?', [SETTINGS_ID]);
  return mapSettings(row);
}

export async function setSmsUnitPrice(unitPriceMinor) {
  const price = Math.max(1, Math.round(Number(unitPriceMinor) || DEFAULT_UNIT_PRICE_MINOR));
  if (useCloudSms()) {
    await ensureCloudSettingsRow();
    const { error } = await supabase
      .from('platform_sms_settings')
      .update({ unit_price_minor: price, updated_at: nowIso() })
      .eq('id', SETTINGS_ID);
    if (error) throw error;
    return getSmsSettings();
  }
  const db = await getDb();
  await db.run(
    `UPDATE platform_sms_settings
     SET unit_price_minor = ?, updated_at = ?
     WHERE id = ?`,
    [price, nowIso(), SETTINGS_ID]
  );
  return getSmsSettings();
}

export async function addSmsUnits(units) {
  const add = Math.max(0, Math.round(Number(units) || 0));
  if (!add) return getSmsSettings();
  if (useCloudSms()) {
    const current = await getSmsSettings();
    const { error } = await supabase
      .from('platform_sms_settings')
      .update({
        units_available: current.units_available + add,
        updated_at: nowIso(),
      })
      .eq('id', SETTINGS_ID);
    if (error) throw error;
    return getSmsSettings();
  }
  const db = await getDb();
  await db.run(
    `UPDATE platform_sms_settings
     SET units_available = units_available + ?, updated_at = ?
     WHERE id = ?`,
    [add, nowIso(), SETTINGS_ID]
  );
  return getSmsSettings();
}

const DEMO_FLAG_ID = 'demo_money_cleared_v1';

function isDuplicateKey(error) {
  const msg = String(error?.message || '').toLowerCase();
  return error?.code === '23505' || msg.includes('duplicate');
}

/**
 * Claim a one-time demo wipe. Returns true only for the first successful claim.
 * `baselineMinor` is the subscription revenue already on the books so wallet
 * sync does not put that demo total back after balances are zeroed.
 */
export async function claimDemoMoneyReset(baselineMinor = 0) {
  const baseline = Math.max(0, Math.round(Number(baselineMinor) || 0));
  if (useCloudSms()) {
    const { error } = await supabase.from('platform_sms_settings').insert([
      {
        id: DEMO_FLAG_ID,
        units_available: 0,
        unit_price_minor: 0,
        total_revenue_minor: baseline,
        updated_at: nowIso(),
      },
    ]);
    if (error) {
      if (isDuplicateKey(error)) return false;
      throw error;
    }
    return true;
  }
  const db = await getDb();
  const result = await db.run(
    `INSERT OR IGNORE INTO platform_sms_settings
      (id, units_available, unit_price_minor, total_revenue_minor, updated_at)
     VALUES (?, 0, 0, ?, ?)`,
    [DEMO_FLAG_ID, baseline, nowIso()]
  );
  return Number(result?.changes) > 0;
}

const LEDGER_FLAG_ID = 'platform_ledger_real_v2';

export async function claimPlatformLedgerRebuild() {
  if (useCloudSms()) {
    const { error } = await supabase.from('platform_sms_settings').insert([
      {
        id: LEDGER_FLAG_ID,
        units_available: 0,
        unit_price_minor: 0,
        total_revenue_minor: 0,
        updated_at: nowIso(),
      },
    ]);
    if (error) {
      if (isDuplicateKey(error)) return false;
      throw error;
    }
    return true;
  }
  const db = await getDb();
  const result = await db.run(
    `INSERT OR IGNORE INTO platform_sms_settings
      (id, units_available, unit_price_minor, total_revenue_minor, updated_at)
     VALUES (?, 0, 0, 0, ?)`,
    [LEDGER_FLAG_ID, nowIso()]
  );
  return Number(result?.changes) > 0;
}

export async function clearDemoMoneyBaseline() {
  if (useCloudSms()) {
    const { error } = await supabase
      .from('platform_sms_settings')
      .update({ total_revenue_minor: 0, updated_at: nowIso() })
      .eq('id', DEMO_FLAG_ID);
    if (error) throw error;
    return;
  }
  const db = await getDb();
  await db.run(`UPDATE platform_sms_settings SET total_revenue_minor = 0, updated_at = ? WHERE id = ?`, [
    nowIso(),
    DEMO_FLAG_ID,
  ]);
}

export async function getDemoMoneyClearBaselineMinor() {
  if (useCloudSms()) {
    const { data, error } = await supabase
      .from('platform_sms_settings')
      .select('total_revenue_minor')
      .eq('id', DEMO_FLAG_ID)
      .maybeSingle();
    if (error) throw error;
    return Math.max(0, Math.round(Number(data?.total_revenue_minor) || 0));
  }
  const db = await getDb();
  const row = await db.get('SELECT total_revenue_minor FROM platform_sms_settings WHERE id = ?', [
    DEMO_FLAG_ID,
  ]);
  return Math.max(0, Math.round(Number(row?.total_revenue_minor) || 0));
}

export async function resetSmsInventoryToZero() {
  if (useCloudSms()) {
    const { error: setErr } = await supabase
      .from('platform_sms_settings')
      .update({
        units_available: 0,
        total_revenue_minor: 0,
        updated_at: nowIso(),
      })
      .eq('id', SETTINGS_ID);
    if (setErr) throw setErr;
    const { error: balErr } = await supabase
      .from('school_sms_balances')
      .update({ units_available: 0, updated_at: nowIso() })
      .not('school_id', 'is', null);
    if (balErr) throw balErr;
    const { error: salesErr } = await supabase
      .from('platform_sms_sales')
      .delete()
      .neq('reference', '');
    if (salesErr) throw salesErr;
    return;
  }
  const db = await getDb();
  await db.run(
    `UPDATE platform_sms_settings
     SET units_available = 0, total_revenue_minor = 0, updated_at = ?
     WHERE id = ?`,
    [nowIso(), SETTINGS_ID]
  );
  await db.run(`UPDATE school_sms_balances SET units_available = 0, updated_at = ?`, [nowIso()]);
  await db.run(`DELETE FROM platform_sms_sales`);
}

export async function recordProviderStockPurchase({
  platformSchoolId,
  units,
  amountMinor,
  providerReference,
}) {
  const add = Math.max(0, Math.round(Number(units) || 0));
  const paid = Math.max(0, Math.round(Number(amountMinor) || 0));
  const invoice = String(providerReference || '').trim();
  if (add < 1) {
    const err = new Error('Enter how many SMS units you bought from Twilio');
    err.status = 400;
    throw err;
  }
  if (paid < 1) {
    const err = new Error('Enter the amount paid to Twilio for this purchase');
    err.status = 400;
    throw err;
  }
  if (invoice.length < 4) {
    const err = new Error('Enter the Twilio invoice or payment reference');
    err.status = 400;
    throw err;
  }
  if (!platformSchoolId) {
    const err = new Error('Platform school account is required to record a Twilio purchase');
    err.status = 400;
    throw err;
  }

  const reference = `twilio_${invoice.replace(/\s+/g, '_').slice(0, 80)}`;
  const existing = await getSmsSaleByReference(reference);
  if (existing) {
    const err = new Error('This Twilio purchase reference was already loaded');
    err.status = 409;
    throw err;
  }

  const id = randomUUID();
  const createdAt = nowIso();
  const preview = `Twilio stock · ${invoice}`;

  if (useCloudSms()) {
    const { error } = await supabase.from('platform_sms_sales').insert([
      {
        id,
        school_id: platformSchoolId,
        school_name: 'Twilio',
        units: add,
        amount_minor: paid,
        recipients_count: 0,
        segments: 0,
        reference,
        message_preview: preview,
        sale_type: 'provider_stock',
        created_at: createdAt,
      },
    ]);
    if (error) {
      if (isDuplicateKey(error)) {
        const err = new Error('This Twilio purchase reference was already loaded');
        err.status = 409;
        throw err;
      }
      throw error;
    }
    try {
      return await addSmsUnits(add);
    } catch (addErr) {
      await supabase.from('platform_sms_sales').delete().eq('reference', reference);
      throw addErr;
    }
  }

  const db = await getDb();
  await db.run('BEGIN');
  try {
    await db.run(
      `INSERT INTO platform_sms_sales (
        id, school_id, school_name, units, amount_minor, recipients_count,
        segments, reference, message_preview, sale_type, created_at
      ) VALUES (?, ?, 'Twilio', ?, ?, 0, 0, ?, ?, 'provider_stock', ?)`,
      [id, platformSchoolId, add, paid, reference, preview, createdAt]
    );
    await db.run(
      `UPDATE platform_sms_settings
       SET units_available = units_available + ?, updated_at = ?
       WHERE id = ?`,
      [add, createdAt, SETTINGS_ID]
    );
    await db.run('COMMIT');
  } catch (err) {
    await db.run('ROLLBACK');
    if (isDuplicateKey(err) || String(err?.message || '').toLowerCase().includes('unique')) {
      const dup = new Error('This Twilio purchase reference was already loaded');
      dup.status = 409;
      throw dup;
    }
    throw err;
  }
  return getSmsSettings();
}

/**
 * GSM-ish segment estimate: 160 chars per unit for basic Latin.
 * Longer Unicode messages cost more in reality; keep simple for billing.
 */
export function estimateSmsSegments(message) {
  const text = String(message || '');
  if (!text.length) return 1;
  const hasUnicode = /[^\x00-\x7F]/.test(text);
  const perSegment = hasUnicode ? 70 : 160;
  return Math.max(1, Math.ceil(text.length / perSegment));
}

export function buildSmsQuote({ message, recipientCount, unitPriceMinor }) {
  const recipients = Math.max(0, Math.round(Number(recipientCount) || 0));
  const segments = estimateSmsSegments(message);
  const units = recipients * segments;
  const price = Math.max(1, Math.round(Number(unitPriceMinor) || DEFAULT_UNIT_PRICE_MINOR));
  const amountMinor = units * price;
  return {
    recipients_count: recipients,
    segments,
    units_required: units,
    unit_price_minor: price,
    amount_minor: amountMinor,
  };
}

export async function getSchoolSmsBalance(schoolId) {
  if (useCloudSms()) {
    const { data, error } = await supabase
      .from('school_sms_balances')
      .select('*')
      .eq('school_id', schoolId)
      .maybeSingle();
    if (error) throw error;
    return {
      school_id: schoolId,
      units_available: Number(data?.units_available) || 0,
      updated_at: data?.updated_at || null,
    };
  }
  const db = await getDb();
  const row = await db.get('SELECT * FROM school_sms_balances WHERE school_id = ?', [schoolId]);
  return {
    school_id: schoolId,
    units_available: row?.units_available || 0,
    updated_at: row?.updated_at || null,
  };
}

export async function ensureSchoolSmsBalance(schoolId) {
  if (useCloudSms()) {
    const existing = await getSchoolSmsBalance(schoolId);
    if (existing.updated_at) return existing;
    const { error } = await supabase.from('school_sms_balances').insert([
      { school_id: schoolId, units_available: 0, updated_at: nowIso() },
    ]);
    if (error) {
      const again = await getSchoolSmsBalance(schoolId);
      if (again.updated_at) return again;
      throw error;
    }
    return getSchoolSmsBalance(schoolId);
  }
  const db = await getDb();
  const existing = await db.get('SELECT school_id FROM school_sms_balances WHERE school_id = ?', [
    schoolId,
  ]);
  if (!existing) {
    await db.run(
      `INSERT INTO school_sms_balances (school_id, units_available, updated_at) VALUES (?, 0, ?)`,
      [schoolId, nowIso()]
    );
  }
  return getSchoolSmsBalance(schoolId);
}

/**
 * After wallet payment: credit school units + record purchase revenue (platform inventory unchanged until send).
 */
export async function creditSchoolSmsPurchase({
  schoolId,
  schoolName,
  units,
  amountMinor,
  reference,
}) {
  await ensureSchoolSmsBalance(schoolId);
  const id = randomUUID();
  const createdAt = nowIso();

  if (useCloudSms()) {
    const school = await getSchoolSmsBalance(schoolId);
    const settings = await getSmsSettings();
    const { error: balErr } = await supabase
      .from('school_sms_balances')
      .update({
        units_available: school.units_available + units,
        updated_at: createdAt,
      })
      .eq('school_id', schoolId);
    if (balErr) throw balErr;

    const { error: setErr } = await supabase
      .from('platform_sms_settings')
      .update({
        total_revenue_minor: settings.total_revenue_minor + amountMinor,
        updated_at: createdAt,
      })
      .eq('id', SETTINGS_ID);
    if (setErr) throw setErr;

    const { error: saleErr } = await supabase.from('platform_sms_sales').insert([
      {
        id,
        school_id: schoolId,
        school_name: schoolName || null,
        units,
        amount_minor: amountMinor,
        recipients_count: 0,
        segments: 0,
        reference,
        message_preview: `Purchased ${units} SMS units`,
        sale_type: 'purchase',
        created_at: createdAt,
      },
    ]);
    if (saleErr) throw saleErr;

    return {
      sale_id: id,
      school_balance: await getSchoolSmsBalance(schoolId),
      settings: await getSmsSettings(),
    };
  }

  const db = await getDb();
  await db.run('BEGIN');
  try {
    await db.run(
      `UPDATE school_sms_balances
       SET units_available = units_available + ?, updated_at = ?
       WHERE school_id = ?`,
      [units, createdAt, schoolId]
    );
    await db.run(
      `UPDATE platform_sms_settings
       SET total_revenue_minor = total_revenue_minor + ?, updated_at = ?
       WHERE id = ?`,
      [amountMinor, createdAt, SETTINGS_ID]
    );
    await db.run(
      `INSERT INTO platform_sms_sales (
        id, school_id, school_name, units, amount_minor, recipients_count,
        segments, reference, message_preview, sale_type, created_at
      ) VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?, 'purchase', ?)`,
      [
        id,
        schoolId,
        schoolName || null,
        units,
        amountMinor,
        reference,
        `Purchased ${units} SMS units`,
        createdAt,
      ]
    );
    await db.run('COMMIT');
  } catch (err) {
    await db.run('ROLLBACK');
    throw err;
  }

  return {
    sale_id: id,
    school_balance: await getSchoolSmsBalance(schoolId),
    settings: await getSmsSettings(),
  };
}

/**
 * On send: deduct school prepaid units + platform inventory (no extra money charge).
 */
export async function consumeSchoolAndPlatformUnits({
  schoolId,
  schoolName,
  units,
  recipientsCount,
  segments,
  reference,
  messagePreview,
}) {
  await ensureSchoolSmsBalance(schoolId);
  const schoolBal = await getSchoolSmsBalance(schoolId);
  const settings = await getSmsSettings();

  if (schoolBal.units_available < units) {
    const err = new Error(
      `Not enough school SMS units. Need ${units}, you have ${schoolBal.units_available}. Convert wallet money to SMS units first.`
    );
    err.status = 400;
    err.code = 'SCHOOL_SMS_INSUFFICIENT';
    throw err;
  }
  if (settings.units_available < units) {
    const err = new Error(
      `Not enough platform SMS units. Need ${units}, available ${settings.units_available}. Contact super admin.`
    );
    err.status = 400;
    err.code = 'SMS_UNITS_INSUFFICIENT';
    throw err;
  }

  const id = randomUUID();
  const createdAt = nowIso();

  if (useCloudSms()) {
    const { error: schoolErr } = await supabase
      .from('school_sms_balances')
      .update({
        units_available: schoolBal.units_available - units,
        updated_at: createdAt,
      })
      .eq('school_id', schoolId);
    if (schoolErr) throw schoolErr;

    const { error: platErr } = await supabase
      .from('platform_sms_settings')
      .update({
        units_available: settings.units_available - units,
        updated_at: createdAt,
      })
      .eq('id', SETTINGS_ID);
    if (platErr) throw platErr;

    const { error: saleErr } = await supabase.from('platform_sms_sales').insert([
      {
        id,
        school_id: schoolId,
        school_name: schoolName || null,
        units,
        amount_minor: 0,
        recipients_count: recipientsCount,
        segments,
        reference,
        message_preview: messagePreview ? String(messagePreview).slice(0, 120) : null,
        sale_type: 'usage',
        created_at: createdAt,
      },
    ]);
    if (saleErr) throw saleErr;

    return {
      sale_id: id,
      school_balance: await getSchoolSmsBalance(schoolId),
      settings: await getSmsSettings(),
    };
  }

  const db = await getDb();
  await db.run('BEGIN');
  try {
    await db.run(
      `UPDATE school_sms_balances
       SET units_available = units_available - ?, updated_at = ?
       WHERE school_id = ?`,
      [units, createdAt, schoolId]
    );
    await db.run(
      `UPDATE platform_sms_settings
       SET units_available = units_available - ?, updated_at = ?
       WHERE id = ?`,
      [units, createdAt, SETTINGS_ID]
    );
    await db.run(
      `INSERT INTO platform_sms_sales (
        id, school_id, school_name, units, amount_minor, recipients_count,
        segments, reference, message_preview, sale_type, created_at
      ) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, 'usage', ?)`,
      [
        id,
        schoolId,
        schoolName || null,
        units,
        recipientsCount,
        segments,
        reference,
        messagePreview ? String(messagePreview).slice(0, 120) : null,
        createdAt,
      ]
    );
    await db.run('COMMIT');
  } catch (err) {
    await db.run('ROLLBACK');
    throw err;
  }

  return {
    sale_id: id,
    school_balance: await getSchoolSmsBalance(schoolId),
    settings: await getSmsSettings(),
  };
}

/**
 * Credit units back when Twilio delivery fails for some/all recipients.
 */
export async function refundSchoolAndPlatformUnits({
  schoolId,
  schoolName,
  units,
  reference,
  reason,
}) {
  const refundUnits = Math.max(0, Math.round(Number(units) || 0));
  if (!refundUnits) {
    return {
      school_balance: await getSchoolSmsBalance(schoolId),
      settings: await getSmsSettings(),
      refunded_units: 0,
    };
  }

  await ensureSchoolSmsBalance(schoolId);
  const schoolBal = await getSchoolSmsBalance(schoolId);
  const settings = await getSmsSettings();
  const id = randomUUID();
  const createdAt = nowIso();
  const refundRef = `${reference || 'sms'}_refund_${id.slice(0, 8)}`;

  if (useCloudSms()) {
    const { error: schoolErr } = await supabase
      .from('school_sms_balances')
      .update({
        units_available: schoolBal.units_available + refundUnits,
        updated_at: createdAt,
      })
      .eq('school_id', schoolId);
    if (schoolErr) throw schoolErr;

    const { error: platErr } = await supabase
      .from('platform_sms_settings')
      .update({
        units_available: settings.units_available + refundUnits,
        updated_at: createdAt,
      })
      .eq('id', SETTINGS_ID);
    if (platErr) throw platErr;

    await supabase.from('platform_sms_sales').insert([
      {
        id,
        school_id: schoolId,
        school_name: schoolName || null,
        units: refundUnits,
        amount_minor: 0,
        recipients_count: 0,
        segments: 0,
        reference: refundRef,
        message_preview: reason ? String(reason).slice(0, 120) : 'SMS delivery refund',
        sale_type: 'refund',
        created_at: createdAt,
      },
    ]);

    return {
      school_balance: await getSchoolSmsBalance(schoolId),
      settings: await getSmsSettings(),
      refunded_units: refundUnits,
    };
  }

  const db = await getDb();
  await db.run('BEGIN');
  try {
    await db.run(
      `UPDATE school_sms_balances
       SET units_available = units_available + ?, updated_at = ?
       WHERE school_id = ?`,
      [refundUnits, createdAt, schoolId]
    );
    await db.run(
      `UPDATE platform_sms_settings
       SET units_available = units_available + ?, updated_at = ?
       WHERE id = ?`,
      [refundUnits, createdAt, SETTINGS_ID]
    );
    await db.run(
      `INSERT INTO platform_sms_sales (
        id, school_id, school_name, units, amount_minor, recipients_count,
        segments, reference, message_preview, sale_type, created_at
      ) VALUES (?, ?, ?, ?, 0, 0, 0, ?, ?, 'refund', ?)`,
      [
        id,
        schoolId,
        schoolName || null,
        refundUnits,
        refundRef,
        reason ? String(reason).slice(0, 120) : 'SMS delivery refund',
        createdAt,
      ]
    );
    await db.run('COMMIT');
  } catch (err) {
    await db.run('ROLLBACK');
    throw err;
  }

  return {
    school_balance: await getSchoolSmsBalance(schoolId),
    settings: await getSmsSettings(),
    refunded_units: refundUnits,
  };
}

export async function getSmsSaleByReference(reference) {
  const ref = String(reference || '').trim();
  if (!ref) return null;
  if (useCloudSms()) {
    const { data, error } = await supabase
      .from('platform_sms_sales')
      .select('*')
      .eq('reference', ref)
      .maybeSingle();
    if (error) throw error;
    return data || null;
  }
  const db = await getDb();
  return db.get('SELECT * FROM platform_sms_sales WHERE reference = ?', [ref]);
}

export async function listSmsSales({ limit = 50 } = {}) {
  if (useCloudSms()) {
    const { data, error } = await supabase
      .from('platform_sms_sales')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data || [];
  }
  const db = await getDb();
  return db.all(`SELECT * FROM platform_sms_sales ORDER BY created_at DESC LIMIT ?`, [limit]);
}

export function makeSmsSaleReference(prefix = 'sms') {
  return `${prefix}_${Date.now()}_${randomUUID().replace(/-/g, '').slice(0, 8)}`;
}
