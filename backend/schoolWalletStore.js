import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import { openLocalDb } from './localDb.js';
import { getDataDir } from './dataPaths.js';
import { supabase } from './supabaseClient.js';

const DATA_DIR = getDataDir();
const DB_PATH = path.join(DATA_DIR, 'school-extras.db');

let dbPromise = null;

/** Prefer Supabase on Vercel (or when WALLET_STORE=supabase). */
function useCloudWallet() {
  return Boolean(process.env.VERCEL) || String(process.env.WALLET_STORE || '').toLowerCase() === 'supabase';
}

function assertCloud() {
  if (!supabase) {
    const err = new Error(
      'Supabase is required for wallets on Vercel. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.'
    );
    err.status = 503;
    throw err;
  }
}

function throwWalletError(error) {
  const msg = String(error?.message || error || '');
  const missingTable = /schema cache|could not find the table|does not exist/i.test(msg);
  if (missingTable) {
    const err = new Error(
      'Wallet tables are missing in Supabase. Run database/supabase_core_billing.sql then database/supabase_backend_access.sql in the SQL editor.'
    );
    err.status = 503;
    throw err;
  }
  if (error?.code === '23503' || /foreign key/i.test(msg)) {
    const err = new Error(
      'This school is not in Supabase, so a wallet cannot be created. Confirm the school exists in the schools table.'
    );
    err.status = 503;
    throw err;
  }
  throw error;
}

async function getDb() {
  if (useCloudWallet()) {
    throw new Error('LOCAL_WALLET_DB_SKIP');
  }
  if (!dbPromise) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    dbPromise = Promise.resolve(openLocalDb(DB_PATH)).then(async (db) => {
      await db.exec(`
        CREATE TABLE IF NOT EXISTS school_wallets (
          school_id TEXT PRIMARY KEY,
          available_balance INTEGER NOT NULL DEFAULT 0,
          pending_balance INTEGER NOT NULL DEFAULT 0,
          currency TEXT NOT NULL DEFAULT 'GHS',
          updated_at TEXT
        );

        CREATE TABLE IF NOT EXISTS wallet_accounts (
          id TEXT PRIMARY KEY,
          school_id TEXT NOT NULL,
          type TEXT NOT NULL,
          label TEXT,
          account_name TEXT NOT NULL,
          account_number TEXT NOT NULL,
          bank_code TEXT NOT NULL,
          bank_name TEXT,
          provider TEXT,
          currency TEXT NOT NULL DEFAULT 'GHS',
          paystack_recipient_code TEXT,
          paystack_subaccount_code TEXT,
          is_default INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS wallet_transactions (
          id TEXT PRIMARY KEY,
          school_id TEXT NOT NULL,
          type TEXT NOT NULL,
          amount INTEGER NOT NULL,
          fee INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL,
          channel TEXT,
          account_id TEXT,
          reference TEXT UNIQUE NOT NULL,
          provider_reference TEXT,
          description TEXT,
          metadata TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_wallet_accounts_school ON wallet_accounts(school_id);
        CREATE INDEX IF NOT EXISTS idx_wallet_tx_school ON wallet_transactions(school_id);
        CREATE INDEX IF NOT EXISTS idx_wallet_tx_reference ON wallet_transactions(reference);
      `);
      try {
        await db.exec(`ALTER TABLE wallet_accounts ADD COLUMN paystack_subaccount_code TEXT`);
      } catch {
        // Column already exists on upgraded local DBs.
      }
      return db;
    });
  }
  return dbPromise;
}

function nowIso() {
  return new Date().toISOString();
}

function parseMetadata(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function mapWallet(row) {
  if (!row) return null;
  return {
    school_id: row.school_id,
    available_balance: Number(row.available_balance) || 0,
    pending_balance: Number(row.pending_balance) || 0,
    currency: row.currency || 'GHS',
    updated_at: row.updated_at,
  };
}

function mapAccount(row) {
  if (!row) return null;
  return {
    id: row.id,
    school_id: row.school_id,
    type: row.type,
    label: row.label,
    account_name: row.account_name,
    account_number: row.account_number,
    bank_code: row.bank_code,
    bank_name: row.bank_name,
    provider: row.provider,
    currency: row.currency,
    paystack_recipient_code: row.paystack_recipient_code,
    paystack_subaccount_code: row.paystack_subaccount_code || null,
    is_default: row.is_default === 1 || row.is_default === true,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapTransaction(row) {
  if (!row) return null;
  return {
    id: row.id,
    school_id: row.school_id,
    type: row.type,
    amount: Number(row.amount) || 0,
    fee: Number(row.fee) || 0,
    status: row.status,
    channel: row.channel,
    account_id: row.account_id,
    reference: row.reference,
    provider_reference: row.provider_reference,
    description: row.description,
    metadata: parseMetadata(row.metadata),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function isDuplicateKey(error) {
  const msg = String(error?.message || '').toLowerCase();
  return error?.code === '23505' || msg.includes('duplicate');
}

async function ensureWalletCloud(schoolId, currency = 'GHS') {
  assertCloud();
  const { data, error } = await supabase
    .from('school_wallets')
    .select('*')
    .eq('school_id', schoolId)
    .maybeSingle();
  if (error) throwWalletError(error);
  if (data) return data;

  const row = {
    school_id: schoolId,
    available_balance: 0,
    pending_balance: 0,
    currency,
    updated_at: nowIso(),
  };
  const { data: inserted, error: insErr } = await supabase
    .from('school_wallets')
    .insert([row])
    .select()
    .single();
  if (insErr) {
    if (isDuplicateKey(insErr)) {
      const { data: again, error: againErr } = await supabase
        .from('school_wallets')
        .select('*')
        .eq('school_id', schoolId)
        .maybeSingle();
      if (againErr) throwWalletError(againErr);
      if (again) return again;
    }
    throwWalletError(insErr);
  }
  return inserted;
}

export async function initSchoolWalletStore() {
  if (useCloudWallet()) {
    assertCloud();
    const { error } = await supabase.from('school_wallets').select('school_id').limit(1);
    if (error) throwWalletError(error);
    return;
  }
  await getDb();
}

export async function resetAllWalletBalances() {
  if (useCloudWallet()) {
    assertCloud();
    const { error: txErr } = await supabase.from('wallet_transactions').delete().neq('reference', '');
    if (txErr) throwWalletError(txErr);
    const { error: walletErr } = await supabase
      .from('school_wallets')
      .update({ available_balance: 0, pending_balance: 0, updated_at: nowIso() })
      .not('school_id', 'is', null);
    if (walletErr) throwWalletError(walletErr);
    return;
  }
  const db = await getDb();
  await db.run('DELETE FROM wallet_transactions');
  await db.run(
    `UPDATE school_wallets SET available_balance = 0, pending_balance = 0, updated_at = ?`,
    [nowIso()]
  );
}

export async function ensureWallet(schoolId, currency = 'GHS') {
  if (useCloudWallet()) return ensureWalletCloud(schoolId, currency);

  const db = await getDb();
  const existing = await db.get('SELECT * FROM school_wallets WHERE school_id = ?', [schoolId]);
  if (existing) return existing;

  const updatedAt = nowIso();
  await db.run(
    `INSERT INTO school_wallets (school_id, available_balance, pending_balance, currency, updated_at)
     VALUES (?, 0, 0, ?, ?)`,
    [schoolId, currency, updatedAt]
  );
  return db.get('SELECT * FROM school_wallets WHERE school_id = ?', [schoolId]);
}

export async function getWallet(schoolId) {
  const wallet = await ensureWallet(schoolId);
  return mapWallet(wallet);
}

export async function listWalletAccounts(schoolId) {
  if (useCloudWallet()) {
    assertCloud();
    const { data, error } = await supabase
      .from('wallet_accounts')
      .select('*')
      .eq('school_id', schoolId)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: false });
    if (error) throwWalletError(error);
    return (data || []).map(mapAccount);
  }
  const db = await getDb();
  const rows = await db.all(
    `SELECT * FROM wallet_accounts WHERE school_id = ? ORDER BY is_default DESC, created_at DESC`,
    [schoolId]
  );
  return rows.map(mapAccount);
}

export async function getWalletAccount(schoolId, accountId) {
  if (useCloudWallet()) {
    assertCloud();
    const { data, error } = await supabase
      .from('wallet_accounts')
      .select('*')
      .eq('school_id', schoolId)
      .eq('id', accountId)
      .maybeSingle();
    if (error) throwWalletError(error);
    return mapAccount(data);
  }
  const db = await getDb();
  const row = await db.get(
    `SELECT * FROM wallet_accounts WHERE school_id = ? AND id = ?`,
    [schoolId, accountId]
  );
  return mapAccount(row);
}

export async function createWalletAccount(schoolId, data) {
  const existing = await listWalletAccounts(schoolId);
  const makeDefault = existing.length === 0 || Boolean(data.is_default);
  const id = randomUUID();
  const timestamp = nowIso();

  if (useCloudWallet()) {
    assertCloud();
    if (makeDefault) {
      const { error } = await supabase
        .from('wallet_accounts')
        .update({ is_default: false })
        .eq('school_id', schoolId);
      if (error) throwWalletError(error);
    }
    const { error } = await supabase.from('wallet_accounts').insert([
      {
        id,
        school_id: schoolId,
        type: data.type,
        label: data.label || null,
        account_name: data.account_name,
        account_number: data.account_number,
        bank_code: data.bank_code,
        bank_name: data.bank_name || null,
        provider: data.provider || null,
        currency: data.currency || 'GHS',
        paystack_recipient_code: data.paystack_recipient_code || null,
        paystack_subaccount_code: data.paystack_subaccount_code || null,
        is_default: makeDefault,
        created_at: timestamp,
        updated_at: timestamp,
      },
    ]);
    if (error) {
      const missingSub =
        String(error.message || error.details || '').includes('paystack_subaccount_code');
      if (missingSub) {
        const retry = await supabase.from('wallet_accounts').insert([
          {
            id,
            school_id: schoolId,
            type: data.type,
            label: data.label || null,
            account_name: data.account_name,
            account_number: data.account_number,
            bank_code: data.bank_code,
            bank_name: data.bank_name || null,
            provider: data.provider || null,
            currency: data.currency || 'GHS',
            paystack_recipient_code: data.paystack_recipient_code || null,
            is_default: makeDefault,
            created_at: timestamp,
            updated_at: timestamp,
          },
        ]);
        if (retry.error) throwWalletError(retry.error);
        return getWalletAccount(schoolId, id);
      }
      throwWalletError(error);
    }
    return getWalletAccount(schoolId, id);
  }

  const db = await getDb();
  if (makeDefault) {
    await db.run(`UPDATE wallet_accounts SET is_default = 0 WHERE school_id = ?`, [schoolId]);
  }

  await db.run(
    `INSERT INTO wallet_accounts (
      id, school_id, type, label, account_name, account_number, bank_code, bank_name,
      provider, currency, paystack_recipient_code, paystack_subaccount_code, is_default, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      schoolId,
      data.type,
      data.label || null,
      data.account_name,
      data.account_number,
      data.bank_code,
      data.bank_name || null,
      data.provider || null,
      data.currency || 'GHS',
      data.paystack_recipient_code || null,
      data.paystack_subaccount_code || null,
      makeDefault ? 1 : 0,
      timestamp,
      timestamp,
    ]
  );

  return getWalletAccount(schoolId, id);
}

export async function updateWalletAccount(schoolId, accountId, patch) {
  const existing = await getWalletAccount(schoolId, accountId);
  if (!existing) return null;

  const next = {
    ...existing,
    ...patch,
    updated_at: nowIso(),
  };
  const isDefault = Boolean(next.is_default || patch.is_default);

  if (useCloudWallet()) {
    assertCloud();
    if (patch.is_default) {
      const { error } = await supabase
        .from('wallet_accounts')
        .update({ is_default: false })
        .eq('school_id', schoolId);
      if (error) throwWalletError(error);
    }
    const payload = {
      label: next.label || null,
      account_name: next.account_name,
      account_number: next.account_number,
      bank_code: next.bank_code,
      bank_name: next.bank_name || null,
      provider: next.provider || null,
      currency: next.currency || 'GHS',
      paystack_recipient_code: next.paystack_recipient_code || null,
      paystack_subaccount_code: next.paystack_subaccount_code || null,
      is_default: isDefault,
      updated_at: next.updated_at,
    };
    let { error } = await supabase
      .from('wallet_accounts')
      .update(payload)
      .eq('school_id', schoolId)
      .eq('id', accountId);
    if (error && String(error.message || error.details || '').includes('paystack_subaccount_code')) {
      delete payload.paystack_subaccount_code;
      ({ error } = await supabase
        .from('wallet_accounts')
        .update(payload)
        .eq('school_id', schoolId)
        .eq('id', accountId));
    }
    if (error) throwWalletError(error);
    return getWalletAccount(schoolId, accountId);
  }

  const db = await getDb();
  if (patch.is_default) {
    await db.run(`UPDATE wallet_accounts SET is_default = 0 WHERE school_id = ?`, [schoolId]);
  }

  await db.run(
    `UPDATE wallet_accounts SET
      label = ?, account_name = ?, account_number = ?, bank_code = ?, bank_name = ?,
      provider = ?, currency = ?, paystack_recipient_code = ?, paystack_subaccount_code = ?, is_default = ?, updated_at = ?
     WHERE school_id = ? AND id = ?`,
    [
      next.label || null,
      next.account_name,
      next.account_number,
      next.bank_code,
      next.bank_name || null,
      next.provider || null,
      next.currency || 'GHS',
      next.paystack_recipient_code || null,
      next.paystack_subaccount_code || null,
      isDefault ? 1 : 0,
      next.updated_at,
      schoolId,
      accountId,
    ]
  );

  return getWalletAccount(schoolId, accountId);
}

export async function deleteWalletAccount(schoolId, accountId) {
  const existing = await getWalletAccount(schoolId, accountId);
  if (!existing) return false;

  if (useCloudWallet()) {
    assertCloud();
    const { error } = await supabase
      .from('wallet_accounts')
      .delete()
      .eq('school_id', schoolId)
      .eq('id', accountId);
    if (error) throwWalletError(error);
    if (existing.is_default) {
      const remaining = await listWalletAccounts(schoolId);
      if (remaining[0]) {
        const { error: defErr } = await supabase
          .from('wallet_accounts')
          .update({ is_default: true, updated_at: nowIso() })
          .eq('id', remaining[0].id);
        if (defErr) throwWalletError(defErr);
      }
    }
    return true;
  }

  const db = await getDb();
  await db.run(`DELETE FROM wallet_accounts WHERE school_id = ? AND id = ?`, [schoolId, accountId]);

  if (existing.is_default) {
    const remaining = await listWalletAccounts(schoolId);
    if (remaining[0]) {
      await db.run(
        `UPDATE wallet_accounts SET is_default = 1, updated_at = ? WHERE id = ?`,
        [nowIso(), remaining[0].id]
      );
    }
  }

  return true;
}

export async function createWalletTransaction(schoolId, data) {
  const id = randomUUID();
  const timestamp = nowIso();

  if (useCloudWallet()) {
    assertCloud();
    const { error } = await supabase.from('wallet_transactions').insert([
      {
        id,
        school_id: schoolId,
        type: data.type,
        amount: data.amount,
        fee: data.fee || 0,
        status: data.status,
        channel: data.channel || null,
        account_id: data.account_id || null,
        reference: data.reference,
        provider_reference: data.provider_reference || null,
        description: data.description || null,
        metadata: data.metadata || {},
        created_at: timestamp,
        updated_at: timestamp,
      },
    ]);
    if (error) throwWalletError(error);
    return getWalletTransactionByReference(data.reference);
  }

  const db = await getDb();
  await db.run(
    `INSERT INTO wallet_transactions (
      id, school_id, type, amount, fee, status, channel, account_id, reference,
      provider_reference, description, metadata, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      schoolId,
      data.type,
      data.amount,
      data.fee || 0,
      data.status,
      data.channel || null,
      data.account_id || null,
      data.reference,
      data.provider_reference || null,
      data.description || null,
      JSON.stringify(data.metadata || {}),
      timestamp,
      timestamp,
    ]
  );

  return getWalletTransactionByReference(data.reference);
}

export async function getWalletTransactionByReference(reference) {
  if (useCloudWallet()) {
    assertCloud();
    const { data, error } = await supabase
      .from('wallet_transactions')
      .select('*')
      .eq('reference', reference)
      .maybeSingle();
    if (error) throwWalletError(error);
    return mapTransaction(data);
  }
  const db = await getDb();
  const row = await db.get(`SELECT * FROM wallet_transactions WHERE reference = ?`, [reference]);
  return mapTransaction(row);
}

export async function listWalletTransactions(schoolId, { limit = 50 } = {}) {
  if (useCloudWallet()) {
    assertCloud();
    const { data, error } = await supabase
      .from('wallet_transactions')
      .select('*')
      .eq('school_id', schoolId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throwWalletError(error);
    return (data || []).map(mapTransaction);
  }
  const db = await getDb();
  const rows = await db.all(
    `SELECT * FROM wallet_transactions WHERE school_id = ? ORDER BY created_at DESC LIMIT ?`,
    [schoolId, limit]
  );
  return rows.map(mapTransaction);
}

export function isRealPlatformRevenueReference(reference) {
  const ref = String(reference || '').trim();
  if (!ref) return false;
  if (/^subrev_gap_/i.test(ref)) return false;
  if (/^sub_\d{10,}_[a-z0-9]+$/i.test(ref)) return false;
  if (/^(signup_|splan_|smsbuy_)/i.test(ref)) return true;
  if (/^T[A-Z0-9]{8,}$/i.test(ref)) return true;
  return false;
}

export function isFakeOrDemoWalletTx(tx) {
  const ref = String(tx?.reference || '');
  const meta = tx?.metadata && typeof tx.metadata === 'object' ? tx.metadata : {};
  const description = String(tx?.description || '');
  if (meta.sync === true) return true;
  if (/^subrev_gap_/i.test(ref)) return true;
  if (/^sub_\d{10,}_[a-z0-9]+$/i.test(ref)) return true;
  if (/demo|available to withdraw/i.test(description)) return true;
  return false;
}

export function ledgerBalancesFromTransactions(transactions) {
  let available = 0;
  let pending = 0;
  for (const tx of transactions || []) {
    const amount = Number(tx.amount) || 0;
    const type = String(tx.type || '');
    const status = String(tx.status || '');
    const inbound = type === 'credit' || type === 'deposit';
    const outbound = type === 'debit' || type === 'withdrawal';
    if (status === 'success') {
      if (inbound) available += amount;
      if (outbound) available -= amount;
    } else if (status === 'pending' || status === 'processing') {
      if (outbound) {
        pending += amount;
        available -= amount;
      }
    }
  }
  return {
    available_balance: Math.max(0, Math.round(available)),
    pending_balance: Math.max(0, Math.round(pending)),
  };
}

export async function deleteWalletTransactionsByReferences(references) {
  const refs = [...new Set((references || []).map((row) => String(row || '').trim()).filter(Boolean))];
  if (!refs.length) return;
  if (useCloudWallet()) {
    assertCloud();
    for (let i = 0; i < refs.length; i += 40) {
      const chunk = refs.slice(i, i + 40);
      const { error } = await supabase.from('wallet_transactions').delete().in('reference', chunk);
      if (error) throwWalletError(error);
    }
    return;
  }
  const db = await getDb();
  for (const ref of refs) {
    await db.run('DELETE FROM wallet_transactions WHERE reference = ?', [ref]);
  }
}

export async function setWalletBalances(schoolId, { available_balance = 0, pending_balance = 0 } = {}) {
  const available = Math.max(0, Math.round(Number(available_balance) || 0));
  const pending = Math.max(0, Math.round(Number(pending_balance) || 0));
  if (useCloudWallet()) {
    assertCloud();
    const { error } = await supabase
      .from('school_wallets')
      .update({ available_balance: available, pending_balance: pending, updated_at: nowIso() })
      .eq('school_id', schoolId);
    if (error) throwWalletError(error);
    return getWallet(schoolId);
  }
  const db = await getDb();
  await db.run(
    `UPDATE school_wallets
     SET available_balance = ?, pending_balance = ?, updated_at = ?
     WHERE school_id = ?`,
    [available, pending, nowIso(), schoolId]
  );
  return getWallet(schoolId);
}

export async function updateWalletTransaction(reference, patch) {
  const existing = await getWalletTransactionByReference(reference);
  if (!existing) return null;

  const metadata = patch.metadata !== undefined
    ? { ...existing.metadata, ...patch.metadata }
    : existing.metadata;

  if (useCloudWallet()) {
    assertCloud();
    const next = {
      metadata,
      updated_at: nowIso(),
    };
    if (patch.status !== undefined) next.status = patch.status;
    if (patch.provider_reference !== undefined) next.provider_reference = patch.provider_reference;
    if (patch.description !== undefined) next.description = patch.description;
    const { error } = await supabase
      .from('wallet_transactions')
      .update(next)
      .eq('reference', reference);
    if (error) throwWalletError(error);
    return getWalletTransactionByReference(reference);
  }

  const db = await getDb();
  await db.run(
    `UPDATE wallet_transactions SET
      status = COALESCE(?, status),
      provider_reference = COALESCE(?, provider_reference),
      description = COALESCE(?, description),
      metadata = ?,
      updated_at = ?
     WHERE reference = ?`,
    [
      patch.status ?? null,
      patch.provider_reference ?? null,
      patch.description ?? null,
      JSON.stringify(metadata || {}),
      nowIso(),
      reference,
    ]
  );

  return getWalletTransactionByReference(reference);
}

/**
 * Apply a successful deposit once (idempotent by reference status).
 */
export async function creditDeposit(reference) {
  const tx = await getWalletTransactionByReference(reference);
  if (!tx) return null;
  if (tx.status === 'success') return { wallet: await getWallet(tx.school_id), transaction: tx };

  if (useCloudWallet()) {
    assertCloud();
    await ensureWallet(tx.school_id);
    const { data: marked, error: markErr } = await supabase
      .from('wallet_transactions')
      .update({ status: 'success', updated_at: nowIso() })
      .eq('reference', reference)
      .neq('status', 'success')
      .select('id');
    if (markErr) throwWalletError(markErr);
    if (!marked?.length) {
      return {
        wallet: await getWallet(tx.school_id),
        transaction: await getWalletTransactionByReference(reference),
      };
    }
    const wallet = await getWallet(tx.school_id);
    const { error } = await supabase
      .from('school_wallets')
      .update({
        available_balance: wallet.available_balance + tx.amount,
        updated_at: nowIso(),
      })
      .eq('school_id', tx.school_id);
    if (error) throwWalletError(error);
    return {
      wallet: await getWallet(tx.school_id),
      transaction: await getWalletTransactionByReference(reference),
    };
  }

  const db = await getDb();
  await ensureWallet(tx.school_id);
  await db.run('BEGIN');
  try {
    const marked = await db.run(
      `UPDATE wallet_transactions SET status = 'success', updated_at = ?
       WHERE reference = ? AND status <> 'success'`,
      [nowIso(), reference]
    );
    if (!marked.changes) {
      await db.run('COMMIT');
      return {
        wallet: await getWallet(tx.school_id),
        transaction: await getWalletTransactionByReference(reference),
      };
    }
    await db.run(
      `UPDATE school_wallets
       SET available_balance = available_balance + ?, updated_at = ?
       WHERE school_id = ?`,
      [tx.amount, nowIso(), tx.school_id]
    );
    await db.run('COMMIT');
  } catch (err) {
    await db.run('ROLLBACK');
    throw err;
  }

  return {
    wallet: await getWallet(tx.school_id),
    transaction: await getWalletTransactionByReference(reference),
  };
}

/**
 * Move available → pending when withdrawal is initiated.
 */
export async function reserveWithdrawal(schoolId, amountMinor) {
  await ensureWallet(schoolId);

  if (useCloudWallet()) {
    assertCloud();
    const wallet = await getWallet(schoolId);
    if (wallet.available_balance < amountMinor) {
      const err = new Error('Insufficient wallet balance');
      err.status = 400;
      throw err;
    }
    const { data, error } = await supabase
      .from('school_wallets')
      .update({
        available_balance: wallet.available_balance - amountMinor,
        pending_balance: wallet.pending_balance + amountMinor,
        updated_at: nowIso(),
      })
      .eq('school_id', schoolId)
      .gte('available_balance', amountMinor)
      .select('school_id');
    if (error) throwWalletError(error);
    if (!data?.length) {
      const err = new Error('Insufficient wallet balance');
      err.status = 400;
      throw err;
    }
    return getWallet(schoolId);
  }

  const db = await getDb();
  const updated = await db.run(
    `UPDATE school_wallets
     SET available_balance = available_balance - ?,
         pending_balance = pending_balance + ?,
         updated_at = ?
     WHERE school_id = ? AND available_balance >= ?`,
    [amountMinor, amountMinor, nowIso(), schoolId, amountMinor]
  );

  if (!updated.changes) {
    const err = new Error('Insufficient wallet balance');
    err.status = 400;
    throw err;
  }

  return getWallet(schoolId);
}

export async function completeWithdrawal(reference) {
  const tx = await getWalletTransactionByReference(reference);
  if (!tx) return null;
  if (tx.status === 'success') return { wallet: await getWallet(tx.school_id), transaction: tx };

  if (useCloudWallet()) {
    assertCloud();
    const wallet = await getWallet(tx.school_id);
    const nextPending = Math.max(0, wallet.pending_balance - tx.amount);
    const { error: walletErr } = await supabase
      .from('school_wallets')
      .update({ pending_balance: nextPending, updated_at: nowIso() })
      .eq('school_id', tx.school_id);
    if (walletErr) throwWalletError(walletErr);
    const { error: txErr } = await supabase
      .from('wallet_transactions')
      .update({ status: 'success', updated_at: nowIso() })
      .eq('reference', reference);
    if (txErr) throwWalletError(txErr);
    return {
      wallet: await getWallet(tx.school_id),
      transaction: await getWalletTransactionByReference(reference),
    };
  }

  const db = await getDb();
  await db.run('BEGIN');
  try {
    await db.run(
      `UPDATE school_wallets
       SET pending_balance = CASE WHEN pending_balance >= ? THEN pending_balance - ? ELSE 0 END,
           updated_at = ?
       WHERE school_id = ?`,
      [tx.amount, tx.amount, nowIso(), tx.school_id]
    );
    await db.run(
      `UPDATE wallet_transactions SET status = 'success', updated_at = ? WHERE reference = ?`,
      [nowIso(), reference]
    );
    await db.run('COMMIT');
  } catch (err) {
    await db.run('ROLLBACK');
    throw err;
  }

  return {
    wallet: await getWallet(tx.school_id),
    transaction: await getWalletTransactionByReference(reference),
  };
}

export async function failWithdrawal(reference, reason) {
  const tx = await getWalletTransactionByReference(reference);
  if (!tx) return null;
  if (tx.status === 'success' || tx.status === 'failed') {
    return { wallet: await getWallet(tx.school_id), transaction: tx };
  }

  if (useCloudWallet()) {
    assertCloud();
    const wallet = await getWallet(tx.school_id);
    const release = Math.min(wallet.pending_balance, tx.amount);
    const { error: walletErr } = await supabase
      .from('school_wallets')
      .update({
        pending_balance: wallet.pending_balance - release,
        available_balance: wallet.available_balance + tx.amount,
        updated_at: nowIso(),
      })
      .eq('school_id', tx.school_id);
    if (walletErr) throwWalletError(walletErr);
    const { error: txErr } = await supabase
      .from('wallet_transactions')
      .update({
        status: 'failed',
        description: reason || tx.description,
        updated_at: nowIso(),
      })
      .eq('reference', reference);
    if (txErr) throwWalletError(txErr);
    return {
      wallet: await getWallet(tx.school_id),
      transaction: await getWalletTransactionByReference(reference),
    };
  }

  const db = await getDb();
  await db.run('BEGIN');
  try {
    await db.run(
      `UPDATE school_wallets
       SET pending_balance = CASE WHEN pending_balance >= ? THEN pending_balance - ? ELSE 0 END,
           available_balance = available_balance + ?,
           updated_at = ?
       WHERE school_id = ?`,
      [tx.amount, tx.amount, tx.amount, nowIso(), tx.school_id]
    );
    await db.run(
      `UPDATE wallet_transactions
       SET status = 'failed', description = COALESCE(?, description), updated_at = ?
       WHERE reference = ?`,
      [reason || tx.description, nowIso(), reference]
    );
    await db.run('COMMIT');
  } catch (err) {
    await db.run('ROLLBACK');
    throw err;
  }

  return {
    wallet: await getWallet(tx.school_id),
    transaction: await getWalletTransactionByReference(reference),
  };
}

export function makeWalletReference(prefix = 'wlt') {
  return `${prefix}_${Date.now()}_${randomUUID().replace(/-/g, '').slice(0, 10)}`;
}

export async function sumSuccessfulCreditsByKind(schoolId, kind) {
  const rows = await listWalletTransactions(schoolId, { limit: 5000 });
  return rows
    .filter(
      (tx) =>
        tx.status === 'success' &&
        tx.type === 'credit' &&
        tx.metadata?.kind === kind
    )
    .reduce((sum, tx) => sum + (Number(tx.amount) || 0), 0);
}

/**
 * Credit a wallet from platform revenue (subscription payments, sync gaps).
 * Idempotent by transaction reference.
 */
export async function creditInternalFunds(schoolId, amountMinor, {
  reference,
  description,
  metadata = {},
} = {}) {
  const amount = Math.round(Number(amountMinor) || 0);
  if (amount <= 0) {
    return { wallet: await getWallet(schoolId), transaction: null };
  }
  if (!reference) {
    const err = new Error('Wallet credit reference is required');
    err.status = 400;
    throw err;
  }

  await ensureWallet(schoolId);
  const existing = await getWalletTransactionByReference(reference);
  if (existing?.status === 'success') {
    return { wallet: await getWallet(schoolId), transaction: existing };
  }
  if (existing) {
    return creditDeposit(reference);
  }

  try {
    await createWalletTransaction(schoolId, {
      type: 'credit',
      amount,
      status: 'pending',
      channel: 'internal',
      reference,
      description: description || 'Internal credit',
      metadata,
    });
  } catch (err) {
    const again = await getWalletTransactionByReference(reference);
    if (again) return creditDeposit(reference);
    throw err;
  }

  return creditDeposit(reference);
}

/**
 * Move funds from one school wallet to another (internal transfer).
 * Creates paired ledger rows on both wallets.
 */
export async function transferBetweenWallets({
  fromSchoolId,
  toSchoolId,
  amountMinor,
  reference,
  description,
  metadata = {},
}) {
  const amount = Math.round(Number(amountMinor) || 0);
  if (amount <= 0) {
    const err = new Error('Transfer amount must be greater than zero');
    err.status = 400;
    throw err;
  }
  if (!fromSchoolId || !toSchoolId || fromSchoolId === toSchoolId) {
    const err = new Error('Invalid transfer wallets');
    err.status = 400;
    throw err;
  }

  await ensureWallet(fromSchoolId);
  await ensureWallet(toSchoolId);

  const fromWallet = await getWallet(fromSchoolId);
  if (fromWallet.available_balance < amount) {
    const err = new Error(
      `Not enough wallet balance. Need GHS ${(amount / 100).toFixed(2)}, available GHS ${(fromWallet.available_balance / 100).toFixed(2)}.`
    );
    err.status = 400;
    err.code = 'WALLET_INSUFFICIENT';
    throw err;
  }

  const debitRef = `${reference}_out`;
  const creditRef = `${reference}_in`;
  const timestamp = nowIso();

  if (useCloudWallet()) {
    assertCloud();
    const toWallet = await getWallet(toSchoolId);
    const { error: fromErr } = await supabase
      .from('school_wallets')
      .update({
        available_balance: fromWallet.available_balance - amount,
        updated_at: timestamp,
      })
      .eq('school_id', fromSchoolId);
    if (fromErr) throwWalletError(fromErr);
    const { error: toErr } = await supabase
      .from('school_wallets')
      .update({
        available_balance: toWallet.available_balance + amount,
        updated_at: timestamp,
      })
      .eq('school_id', toSchoolId);
    if (toErr) throwWalletError(toErr);

    const { error: debitErr } = await supabase.from('wallet_transactions').insert([
      {
        id: randomUUID(),
        school_id: fromSchoolId,
        type: 'debit',
        amount,
        fee: 0,
        status: 'success',
        channel: 'internal',
        account_id: null,
        reference: debitRef,
        provider_reference: null,
        description: description || 'Internal transfer out',
        metadata: { ...metadata, direction: 'out', counterpart: toSchoolId },
        created_at: timestamp,
        updated_at: timestamp,
      },
    ]);
    if (debitErr) throwWalletError(debitErr);
    const { error: creditErr } = await supabase.from('wallet_transactions').insert([
      {
        id: randomUUID(),
        school_id: toSchoolId,
        type: 'credit',
        amount,
        fee: 0,
        status: 'success',
        channel: 'internal',
        account_id: null,
        reference: creditRef,
        provider_reference: null,
        description: description || 'Internal transfer in',
        metadata: { ...metadata, direction: 'in', counterpart: fromSchoolId },
        created_at: timestamp,
        updated_at: timestamp,
      },
    ]);
    if (creditErr) throwWalletError(creditErr);

    return {
      from_wallet: await getWallet(fromSchoolId),
      to_wallet: await getWallet(toSchoolId),
      reference,
      amount_minor: amount,
    };
  }

  const db = await getDb();
  await db.run('BEGIN');
  try {
    await db.run(
      `UPDATE school_wallets
       SET available_balance = available_balance - ?, updated_at = ?
       WHERE school_id = ?`,
      [amount, timestamp, fromSchoolId]
    );
    await db.run(
      `UPDATE school_wallets
       SET available_balance = available_balance + ?, updated_at = ?
       WHERE school_id = ?`,
      [amount, timestamp, toSchoolId]
    );

    await db.run(
      `INSERT INTO wallet_transactions (
        id, school_id, type, amount, fee, status, channel, account_id, reference,
        provider_reference, description, metadata, created_at, updated_at
      ) VALUES (?, ?, 'debit', ?, 0, 'success', 'internal', NULL, ?, NULL, ?, ?, ?, ?)`,
      [
        randomUUID(),
        fromSchoolId,
        amount,
        debitRef,
        description || 'Internal transfer out',
        JSON.stringify({ ...metadata, direction: 'out', counterpart: toSchoolId }),
        timestamp,
        timestamp,
      ]
    );
    await db.run(
      `INSERT INTO wallet_transactions (
        id, school_id, type, amount, fee, status, channel, account_id, reference,
        provider_reference, description, metadata, created_at, updated_at
      ) VALUES (?, ?, 'credit', ?, 0, 'success', 'internal', NULL, ?, NULL, ?, ?, ?, ?)`,
      [
        randomUUID(),
        toSchoolId,
        amount,
        creditRef,
        description || 'Internal transfer in',
        JSON.stringify({ ...metadata, direction: 'in', counterpart: fromSchoolId }),
        timestamp,
        timestamp,
      ]
    );
    await db.run('COMMIT');
  } catch (err) {
    await db.run('ROLLBACK');
    throw err;
  }

  return {
    from_wallet: await getWallet(fromSchoolId),
    to_wallet: await getWallet(toSchoolId),
    reference,
    amount_minor: amount,
  };
}
