import React, { useEffect, useMemo, useRef, useState } from 'react';
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
];

const matchStudent = (row, query) => {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return false;
  const hay = [row.name, row.roll_number, row.barcode, row.class]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return hay.includes(q) || hay.replace(/[^a-z0-9]/g, '').includes(q.replace(/[^a-z0-9]/g, ''));
};

const RecordFeePaymentModal = ({
  students,
  month,
  onClose,
  onSaved,
  requestConfig,
  submitUrl = '/api/fees/manual',
}) => {
  const [studentId, setStudentId] = useState('');
  const [query, setQuery] = useState('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('cash');
  const [reference, setReference] = useState('');
  const [saving, setSaving] = useState(false);
  const [picker, setPicker] = useState(students || []);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const boxRef = useRef(null);

  useEffect(() => {
    const onDoc = (event) => {
      if (!boxRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  useEffect(() => {
    const term = query.trim();
    if (term.length < 1) {
      setPicker(students || []);
      return undefined;
    }
    let cancelled = false;
    const id = setTimeout(async () => {
      setSearching(true);
      try {
        const { data } = await axios.get('/api/students', {
          params: { page: 1, limit: 20, q: term },
          ...(requestConfig || {}),
        });
        if (cancelled) return;
        const parsed = parseListResponse(data);
        const remote = parsed.items || [];
        const local = (students || []).filter((row) => matchStudent(row, term));
        const seen = new Set(remote.map((row) => row.id));
        setPicker([...remote, ...local.filter((row) => !seen.has(row.id))]);
      } catch {
        if (!cancelled) setPicker((students || []).filter((row) => matchStudent(row, term)));
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [query, students, requestConfig]);

  const selected = useMemo(
    () => (picker || []).find((row) => row.id === studentId) || (students || []).find((row) => row.id === studentId) || null,
    [picker, students, studentId]
  );

  const pickStudent = (row) => {
    setStudentId(row.id);
    setQuery(`${row.name}${row.roll_number || row.barcode ? ` · ${row.roll_number || row.barcode}` : ''}`);
    setOpen(false);
    if (row?.outstanding > 0) setAmount(String(row.outstanding));
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!studentId) {
      toast.error('Search and select a student.');
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
            <p className="mt-1 text-sm text-slate-400">Use this when a parent pays in person or with MoMo.</p>
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
          <div ref={boxRef} className="relative mt-2">
            <input
              className={fieldClass}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setStudentId('');
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              placeholder="Search by name or student ID"
              autoComplete="off"
              required={!studentId}
            />
            {open && query.trim() ? (
              <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-xl border border-slate-700 bg-slate-950 py-1 shadow-xl">
                {searching ? (
                  <li className="px-4 py-3 text-sm text-slate-400">Searching…</li>
                ) : picker.length === 0 ? (
                  <li className="px-4 py-3 text-sm text-slate-400">No student matches that name or ID.</li>
                ) : (
                  picker.map((row) => (
                    <li key={row.id}>
                      <button
                        type="button"
                        onClick={() => pickStudent(row)}
                        className="flex w-full flex-col px-4 py-2 text-left text-sm text-white hover:bg-slate-800"
                      >
                        <span>{row.name}</span>
                        <span className="text-xs text-slate-400">
                          {[row.roll_number || row.barcode, row.class].filter(Boolean).join(' · ')}
                          {row.outstanding > 0 ? ` · left ${formatGhs(row.outstanding)}` : ''}
                        </span>
                      </button>
                    </li>
                  ))
                )}
              </ul>
            ) : null}
          </div>
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
          <div className="mt-2 grid grid-cols-2 gap-2">
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
            placeholder="MoMo ID or receipt number"
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
