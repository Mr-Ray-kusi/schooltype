import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';
import { parseListResponse } from '../utils/listApi.js';

const formatGhs = (value) =>
  `GHS ${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fieldClass =
  'w-full rounded-xl border border-slate-600/80 bg-slate-950/60 px-4 py-3 text-sm text-white outline-none focus:border-sky-500/60 focus:ring-2 focus:ring-sky-500/30';

const METHODS = [
  { id: 'cash', label: 'Cash at school' },
  { id: 'momo', label: 'MoMo' },
  { id: 'bank', label: 'Bank' },
];

const RecordFeePaymentModal = ({
  students,
  month,
  onClose,
  onSaved,
  requestConfig,
  submitUrl = '/api/fees/manual',
}) => {
  const [studentId, setStudentId] = useState('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('cash');
  const [reference, setReference] = useState('');
  const [saving, setSaving] = useState(false);
  const [picker, setPicker] = useState(students || []);

  useEffect(() => {
    let cancelled = false;
    axios
      .get('/api/students', { params: { page: 1, limit: 50 }, ...(requestConfig || {}) })
      .then(({ data }) => {
        if (cancelled) return;
        const parsed = parseListResponse(data);
        setPicker(parsed.items.length ? parsed.items : students || []);
      })
      .catch(() => {
        if (!cancelled) setPicker(students || []);
      });
    return () => {
      cancelled = true;
    };
  }, [students, requestConfig]);

  const selected = useMemo(
    () => (picker || []).find((row) => row.id === studentId) || null,
    [picker, studentId]
  );

  const submit = async (event) => {
    event.preventDefault();
    if (!studentId) {
      toast.error('Select a student.');
      return;
    }
    if (!(Number(amount) > 0)) {
      toast.error('Enter the amount that was paid.');
      return;
    }
    setSaving(true);
    try {
      const { data } = await axios.post(
        submitUrl,
        {
          studentId,
          amount: Number(amount),
          method,
          reference: reference.trim() || undefined,
          month,
        },
        requestConfig
      );
      toast.success(
        data.fully_paid
          ? `${data.student?.name || 'Student'} is now fully paid.`
          : `Recorded ${formatGhs(amount)}. Outstanding is ${formatGhs(data.outstanding)}.`
      );
      onSaved?.(data);
      onClose?.();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not record this payment.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6">
      <form onSubmit={submit} className="w-full max-w-lg rounded-3xl bg-slate-900 p-6 shadow-2xl sm:p-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold text-white">Record a payment</h2>
            <p className="mt-1 text-sm text-slate-400">
              Use this when a parent pays in person or at the bank / MoMo.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-slate-600 px-4 py-2 text-slate-200 hover:bg-slate-800"
          >
            Close
          </button>
        </div>

        <label className="mt-6 block text-sm font-medium text-slate-300">
          Student
          <select
            className={`${fieldClass} mt-2`}
            value={studentId}
            onChange={(e) => {
              const nextId = e.target.value;
              const next = (picker || []).find((row) => row.id === nextId);
              setStudentId(nextId);
              if (next?.outstanding > 0) setAmount(String(next.outstanding));
            }}
            required
          >
            <option value="">Select student</option>
            {(picker || []).map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
                {row.class ? ` · ${row.class}` : ''}
                {row.outstanding > 0 ? ` · left ${formatGhs(row.outstanding)}` : ''}
              </option>
            ))}
          </select>
        </label>

        {selected ? (
          <dl className="mt-4 grid grid-cols-3 gap-2 rounded-2xl border border-slate-700 bg-slate-950/50 p-3 text-xs">
            <div>
              <dt className="text-slate-500">Fee</dt>
              <dd className="mt-1 text-sm text-white">{formatGhs(selected.fee_amount)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Paid</dt>
              <dd className="mt-1 text-sm text-emerald-300">{formatGhs(selected.paid_amount)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Outstanding</dt>
              <dd className="mt-1 text-sm text-amber-300">{formatGhs(selected.outstanding)}</dd>
            </div>
          </dl>
        ) : null}

        <label className="mt-4 block text-sm font-medium text-slate-300">
          Amount paid (GHS)
          <input
            className={`${fieldClass} mt-2`}
            type="number"
            min="0.01"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
          />
        </label>

        <fieldset className="mt-4">
          <legend className="text-sm font-medium text-slate-300">How they paid</legend>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {METHODS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setMethod(item.id)}
                className={`rounded-2xl border px-3 py-3 text-sm font-medium ${
                  method === item.id
                    ? 'border-sky-400 bg-sky-500/10 text-white'
                    : 'border-slate-700 bg-slate-950/40 text-slate-300 hover:border-slate-500'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </fieldset>

        <label className="mt-4 block text-sm font-medium text-slate-300">
          Receipt or reference (optional)
          <input
            className={`${fieldClass} mt-2`}
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="Bank slip, MoMo ID, or receipt number"
          />
        </label>

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="submit"
            disabled={saving}
            className="rounded-full bg-primary-600 px-6 py-3 text-white hover:bg-primary-700 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save payment'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-slate-600 px-6 py-3 text-slate-200"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
};

export default RecordFeePaymentModal;
