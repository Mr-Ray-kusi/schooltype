import { randomUUID } from 'crypto';
import {
  createTransferRecipient,
  fromMinorUnits,
  getPaystackConfig,
  initiateTransfer,
  momoProviderFromGhanaPhone,
  normalizeGhanaPhone,
  toMinorUnits,
} from './paystack.js';
import {
  completeWithdrawal,
  createWalletTransaction,
  failWithdrawal,
  getWallet,
  makeWalletReference,
  reserveWithdrawal,
  updateWalletTransaction,
} from './schoolWalletStore.js';
import { supabase } from './supabaseClient.js';
import { ensureStudentProfileColumns } from './dbPooler.js';
import { cacheInvalidate } from './ttlCache.js';

const pendingPayroll = new Map();

function momoBankCode(phone) {
  const provider = momoProviderFromGhanaPhone(phone);
  if (provider === 'mtn') return 'MTN';
  if (provider === 'vod') return 'VOD';
  if (provider === 'atl') return 'ATL';
  return null;
}

function formatMoney(wallet) {
  return {
    ...wallet,
    available_balance_major: fromMinorUnits(wallet.available_balance),
    pending_balance_major: fromMinorUnits(wallet.pending_balance),
  };
}

function asPerson(row, kind) {
  return {
    id: row.id,
    kind,
    name: row.name,
    role: row.role || '',
    salary: Number(row.salary) || 0,
    momo_phone: row.momo_phone ? normalizeGhanaPhone(row.momo_phone) : '',
  };
}

async function selectPeople(table, schoolId, extraColumns) {
  const columns = ['id', 'name', 'role', 'salary', extraColumns].filter(Boolean).join(', ');
  let result = await supabase.from(table).select(columns).eq('school_id', schoolId).order('name');
  if (result.error && extraColumns && /momo_phone|does not exist|could not find/i.test(result.error.message || '')) {
    result = await supabase.from(table).select('id, name, role, salary').eq('school_id', schoolId).order('name');
  }
  if (result.error && /salary|does not exist|could not find/i.test(result.error.message || '')) {
    result = await supabase.from(table).select('id, name, role').eq('school_id', schoolId).order('name');
  }
  if (result.error) throw result.error;
  return result.data || [];
}

async function loadPayrollPeople(schoolId) {
  const [staffRows, nonStaffRows] = await Promise.all([
    selectPeople('staffs', schoolId, 'momo_phone'),
    selectPeople('nonstaffs', schoolId, 'momo_phone'),
  ]);
  return [
    ...staffRows.map((row) => asPerson(row, 'staff')),
    ...nonStaffRows.map((row) => asPerson(row, 'non-staff')),
  ];
}

async function loadPerson(schoolId, kind, personId) {
  const table = kind === 'non-staff' ? 'nonstaffs' : 'staffs';
  const people = await selectPeople(table, schoolId, 'momo_phone');
  const row = people.find((item) => String(item.id) === String(personId));
  return row ? asPerson(row, kind === 'non-staff' ? 'non-staff' : 'staff') : null;
}

function payableItems(people, kind) {
  return people.filter((person) => {
    if (kind && kind !== 'all' && person.kind !== kind) return false;
    return person.salary >= 1 && person.momo_phone;
  });
}

function applyPhoneOverrides(people, phones) {
  if (!phones || typeof phones !== 'object') return people;
  return people.map((person) => {
    const override = phones[`${person.kind}:${person.id}`] || phones[person.id];
    const phone = normalizeGhanaPhone(override || person.momo_phone);
    return { ...person, momo_phone: phone || person.momo_phone };
  });
}

async function rememberPhone(person, phone, schoolId) {
  const table = person.kind === 'non-staff' ? 'nonstaffs' : 'staffs';
  const write = () => {
    let query = supabase.from(table).update({ momo_phone: phone || null }).eq('id', person.id);
    if (schoolId) query = query.eq('school_id', schoolId);
    return query;
  };
  let { error } = await write();
  if (error && /momo_phone|does not exist|could not find/i.test(error.message || '')) {
    await ensureStudentProfileColumns();
    ({ error } = await write());
  }
  if (error && !/momo_phone|does not exist|could not find/i.test(error.message || '')) {
    console.warn('Could not save MoMo number:', error.message);
  }
  if (schoolId) cacheInvalidate(`dash:${schoolId}`);
}

async function payPerson({ schoolId, person, amount, phone, requestedBy }) {
  const { currency, configured } = getPaystackConfig();
  if (!configured) {
    const err = new Error('Paystack is not configured.');
    err.status = 503;
    throw err;
  }
  const bankCode = momoBankCode(phone);
  if (!bankCode) {
    const err = new Error(`Could not tell the MoMo network for ${person.name}. Check the phone number.`);
    err.status = 400;
    throw err;
  }

  const recipient = await createTransferRecipient({
    type: 'mobile_money',
    name: person.name,
    accountNumber: phone,
    bankCode,
    currency,
  });
  const recipientCode = recipient?.recipient_code;
  if (!recipientCode) {
    const err = new Error(`Could not create a payout recipient for ${person.name}.`);
    err.status = 400;
    throw err;
  }

  const amountMinor = toMinorUnits(amount);
  const reference = makeWalletReference('sal');
  await reserveWithdrawal(schoolId, amountMinor);
  await createWalletTransaction(schoolId, {
    type: 'withdrawal',
    amount: amountMinor,
    status: 'processing',
    channel: 'mobile_money',
    reference,
    description: `Salary · ${person.name} · ${person.kind === 'non-staff' ? 'Non-staff' : 'Staff'}`,
    metadata: {
      kind: 'salary',
      wallet_action: 'withdrawal',
      person_id: person.id,
      person_kind: person.kind,
      requested_by: requestedBy,
    },
  });

  try {
    const transfer = await initiateTransfer({
      amountMinor,
      currency,
      recipientCode,
      reference,
      reason: `Salary for ${person.name}`,
    });
    await updateWalletTransaction(reference, {
      provider_reference: transfer?.transfer_code || transfer?.reference || reference,
      metadata: { paystack_status: transfer?.status },
    });
    if (transfer?.status === 'success') await completeWithdrawal(reference);
    return { person_id: person.id, name: person.name, amount, reference, status: transfer?.status || 'pending' };
  } catch (err) {
    await failWithdrawal(reference, err.message);
    throw err;
  }
}

export function registerPayrollRoutes(app, { authenticateToken, enforcePlanApproval }) {
  app.get('/api/payroll', authenticateToken, enforcePlanApproval, async (req, res) => {
    try {
      const schoolId = req.user.schoolId;
      const people = await loadPayrollPeople(schoolId);
      const wallet = formatMoney(await getWallet(schoolId));
      res.json({
        people,
        wallet,
        totals: {
          staff: people.filter((row) => row.kind === 'staff').reduce((sum, row) => sum + row.salary, 0),
          nonStaff: people.filter((row) => row.kind === 'non-staff').reduce((sum, row) => sum + row.salary, 0),
        },
      });
    } catch (err) {
      console.error('Payroll list error:', err);
      res.status(500).json({ error: 'Failed to load salary payments' });
    }
  });

  app.patch('/api/payroll/phone', authenticateToken, enforcePlanApproval, async (req, res) => {
    try {
      const schoolId = req.user.schoolId;
      const kind = req.body?.kind === 'non-staff' ? 'non-staff' : 'staff';
      const person = await loadPerson(schoolId, kind, req.body?.person_id);
      if (!person) return res.status(404).json({ error: 'That person was not found.' });
      const phone = normalizeGhanaPhone(req.body?.momo_phone);
      if (phone && !/^0\d{9}$/.test(phone)) {
        return res.status(400).json({ error: 'Enter a Ghana MoMo number, like 0241234567.' });
      }
      await rememberPhone(person, phone || null, schoolId);
      res.json({ ok: true, momo_phone: phone || '', kind, person_id: person.id });
    } catch (err) {
      console.error('Payroll phone save error:', err);
      res.status(500).json({ error: 'Could not save that MoMo number' });
    }
  });

  app.post('/api/payroll/pay', authenticateToken, enforcePlanApproval, async (req, res) => {
    try {
      const schoolId = req.user.schoolId;
      const kind = req.body?.kind === 'non-staff' ? 'non-staff' : 'staff';
      const person = await loadPerson(schoolId, kind, req.body?.person_id);
      if (!person) return res.status(404).json({ error: 'That person was not found.' });
      const phone = normalizeGhanaPhone(req.body?.momo_phone || person.momo_phone);
      if (!/^0\d{9}$/.test(phone)) {
        return res.status(400).json({ error: 'Enter a Ghana MoMo number for this person.' });
      }
      const amount = Number(person.salary);
      if (!Number.isFinite(amount) || amount < 1) {
        return res.status(400).json({ error: 'Salary must be at least GHS 1.00.' });
      }
      const wallet = await getWallet(schoolId);
      if (Number(wallet.available_balance) < toMinorUnits(amount)) {
        return res.status(400).json({ error: 'The school wallet does not have enough money for this salary.' });
      }
      if (phone !== person.momo_phone) await rememberPhone(person, phone, schoolId);

      const approval = {
        id: randomUUID(),
        schoolId,
        mode: 'one',
        items: [{ person, amount, phone }],
        requested_by: req.user.email || req.user.schoolId,
      };
      pendingPayroll.set(approval.id, approval);
      res.json({
        status: 'awaiting_confirmation',
        approval_id: approval.id,
        amount,
        name: person.name,
        display_text: `Confirm salary of GHS ${amount.toFixed(2)} to ${person.name}. Money leaves the wallet only after this second step.`,
      });
    } catch (err) {
      console.error('Payroll pay error:', err);
      res.status(err.status || 500).json({ error: err.message || 'Failed to start salary payment' });
    }
  });

  app.post('/api/payroll/pay-all', authenticateToken, enforcePlanApproval, async (req, res) => {
    try {
      const schoolId = req.user.schoolId;
      const kind = ['staff', 'non-staff'].includes(req.body?.kind) ? req.body.kind : 'all';
      const people = payableItems(
        applyPhoneOverrides(await loadPayrollPeople(schoolId), req.body?.phones),
        kind
      );
      if (!people.length) {
        return res.status(400).json({
          error: 'No one is ready to pay. Add a salary of at least GHS 1.00 and a MoMo number first.',
        });
      }
      await Promise.all(
        people.map((person) => {
          const override = req.body?.phones?.[`${person.kind}:${person.id}`] || req.body?.phones?.[person.id];
          return override ? rememberPhone(person, person.momo_phone, schoolId) : null;
        })
      );
      const items = people.map((person) => ({ person, amount: person.salary, phone: person.momo_phone }));
      const total = items.reduce((sum, row) => sum + row.amount, 0);
      const wallet = await getWallet(schoolId);
      if (Number(wallet.available_balance) < toMinorUnits(total)) {
        return res.status(400).json({
          error: `The school wallet needs GHS ${total.toFixed(2)} to pay everyone selected.`,
        });
      }
      const approval = {
        id: randomUUID(),
        schoolId,
        mode: 'all',
        items,
        requested_by: req.user.email || req.user.schoolId,
      };
      pendingPayroll.set(approval.id, approval);
      res.json({
        status: 'awaiting_confirmation',
        approval_id: approval.id,
        count: items.length,
        amount: total,
        display_text: `Confirm salaries for ${items.length} people, total GHS ${total.toFixed(2)}. Money leaves the wallet only after this second step.`,
      });
    } catch (err) {
      console.error('Payroll pay-all error:', err);
      res.status(err.status || 500).json({ error: err.message || 'Failed to start group salary payment' });
    }
  });

  app.post('/api/payroll/pay/:id/confirm', authenticateToken, enforcePlanApproval, async (req, res) => {
    try {
      const approval = pendingPayroll.get(req.params.id);
      if (!approval || approval.schoolId !== req.user.schoolId) {
        return res.status(404).json({ error: 'This salary payment request was not found.' });
      }
      pendingPayroll.delete(approval.id);

      const paid = [];
      const failed = [];
      for (const item of approval.items) {
        try {
          paid.push(
            await payPerson({
              schoolId: approval.schoolId,
              person: item.person,
              amount: item.amount,
              phone: item.phone,
              requestedBy: approval.requested_by,
            })
          );
        } catch (err) {
          failed.push({ name: item.person.name, error: err.message || 'Payment failed' });
        }
      }

      res.json({
        status: failed.length && !paid.length ? 'failed' : failed.length ? 'partial' : 'success',
        paid,
        failed,
        wallet: formatMoney(await getWallet(approval.schoolId)),
      });
    } catch (err) {
      console.error('Payroll confirm error:', err);
      res.status(err.status || 500).json({ error: err.message || 'Failed to confirm salary payment' });
    }
  });
}
