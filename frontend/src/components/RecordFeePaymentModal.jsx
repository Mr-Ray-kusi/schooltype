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

const momoNetworkFromPhone = (value) => {
  const digits = String(value || '').replace(/\D/g, '');
  const local =
    digits.startsWith('233') && digits.length >= 12
      ? `0${digits.slice(3)}`
      : digits.length === 9
        ? `0${digits}`
        : digits;
  const prefix = local.slice(0, 3);
  if (['024', '025', '053', '054', '055', '059', '023'].includes(prefix)) return 'mtn';
  if (['020', '050'].includes(prefix)) return 'vod';
  if (['026', '027', '056', '057'].includes(prefix)) return 'atl';
  return null;
};

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
  momoCheckoutUrl,
}) => {
  const [studentId, setStudentId] = useState('');
  const [query, setQuery] = useState('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('cash');
  const [phone, setPhone] = useState('');
  const [reference, setReference] = useState('');
  const [saving, setSaving] = useState(false);
  const [picker, setPicker] = useState(students || []);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [momoPrompt, setMomoPrompt] = useState(null);
  const [otpCode, setOtpCode] = useState('');
  const boxRef = useRef(null);
  const abortingRef = useRef(false);
  const momoPromptRef = useRef(null);
  momoPromptRef.current = momoPrompt;

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
    setPhone(row.parent_phone || '');
    if (row?.outstanding > 0) setAmount(String(row.outstanding));
  };

  const finishSuccess = (data, paidAmount) => {
    toast.success(
      data?.fully_paid
        ? `${data.student?.name || selected?.name || 'Student'} is now fully paid.`
        : `MoMo confirmed for ${formatGhs(paidAmount || amount)}. Outstanding is ${formatGhs(data?.outstanding)}.`
    );
    onSaved?.(data || { student: selected, outstanding: selected?.outstanding });
    onClose?.();
  };

  const abortMomo = (message) => {
    const ref = momoPromptRef.current?.reference;
    if (abortingRef.current) return;
    abortingRef.current = true;
    setMomoPrompt(null);
    setOtpCode('');
    setSaving(false);
    if (message) toast.error(message);
    if (ref) axios.post('/api/public/fees/cancel', { reference: ref }, { timeout: 8000 }).catch(() => {});
  };

  useEffect(() => {
    const reference = momoPrompt?.reference;
    if (!reference) return undefined;

    let cancelled = false;
    const timeout = momoPrompt.needs_code
      ? null
      : window.setTimeout(() => {
          abortMomo('MoMo was not confirmed on the parent phone. Send the prompt again.');
        }, 120000);

    const poll = async () => {
      try {
        const { data } = await axios.get(`/api/public/fees/charge/${encodeURIComponent(reference)}`, {
          timeout: 8000,
        });
        if (cancelled) return;
        if (data.status === 'success') {
          finishSuccess(data, data.amount);
          return;
        }
        if (data.needs_code) {
          setMomoPrompt((prev) => ({
            ...prev,
            needs_code: true,
            code_type: data.code_type || prev?.code_type || 'otp',
            display_text: data.display_text || prev?.display_text || 'Enter the code sent to the parent phone.',
          }));
          setSaving(false);
          return;
        }
        if (data.status === 'cancelled' || data.status === 'failed' || data.status === 'timeout') {
          abortMomo(data.display_text || 'The parent did not confirm this MoMo payment.');
          return;
        }
        if (data.display_text) {
          setMomoPrompt((prev) =>
            prev?.display_text === data.display_text ? prev : { ...prev, display_text: data.display_text }
          );
        }
      } catch {
        // Keep waiting while Paystack finalizes the charge.
      }
    };

    poll();
    const id = window.setInterval(poll, 2500);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      if (timeout) window.clearTimeout(timeout);
    };
  }, [momoPrompt?.reference, momoPrompt?.needs_code]);

  const startMomo = async () => {
    if (!studentId) {
      toast.error('Search and select a student.');
      return;
    }
    if (!(Number(amount) > 0)) {
      toast.error('Enter the amount that was paid.');
      return;
    }
    if (!phone.trim()) {
      toast.error('Enter the parent MoMo number so the confirmation can go to their phone.');
      return;
    }
    abortingRef.current = false;
    setSaving(true);
    try {
      const path = momoCheckoutUrl || `/api/fees/${studentId}/checkout`;
      const { data } = await axios.post(
        path,
        {
          studentId,
          amount: Number(amount),
          month,
          method: 'momo',
          phone: phone.trim(),
          provider: momoNetworkFromPhone(phone),
        },
        { timeout: 45000, ...(requestConfig || {}) }
      );
      if (data.authorization_url) {
        window.location.href = data.authorization_url;
        return;
      }
      if (data.status === 'success') {
        finishSuccess(data, data.amount);
        return;
      }
      if (data.status === 'cancelled' || data.status === 'failed' || data.status === 'timeout') {
        toast.error(data.display_text || 'The parent did not confirm this MoMo payment.');
        setSaving(false);
        return;
      }
      setMomoPrompt({
        reference: data.reference,
        display_text:
          data.display_text || `A confirmation prompt was sent to ${phone.trim()}. Ask the parent to approve it.`,
        needs_code: Boolean(data.needs_code),
        code_type: data.code_type || (data.status === 'send_pin' ? 'pin' : 'otp'),
      });
      setSaving(Boolean(!data.needs_code));
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not send the MoMo prompt.');
      setSaving(false);
    }
  };

  const submitMomoCode = async (event) => {
    event?.preventDefault();
    if (!momoPrompt?.reference || !otpCode.trim()) {
      toast.error('Enter the code from the parent phone.');
      return;
    }
    setSaving(true);
    try {
      const { data } = await axios.post(
        '/api/public/fees/authorize',
        {
          reference: momoPrompt.reference,
          otp: otpCode.trim(),
          code_type: momoPrompt.code_type || 'otp',
        },
        { timeout: 30000 }
      );
      if (data.status === 'success') {
        finishSuccess(data, data.amount);
        return;
      }
      if (data.needs_code) {
        setMomoPrompt((prev) => ({
          ...prev,
          display_text: data.display_text || prev?.display_text,
        }));
        setSaving(false);
        return;
      }
      if (data.status === 'failed' || data.status === 'timeout' || data.status === 'cancelled') {
        abortMomo(data.display_text || 'That code was not accepted.');
        return;
      }
      setMomoPrompt((prev) => ({
        ...prev,
        needs_code: Boolean(data.needs_code),
        display_text: data.display_text || prev?.display_text,
      }));
      if (!data.needs_code) setOtpCode('');
      setSaving(!data.needs_code);
    } catch (err) {
      toast.error(err.response?.data?.error || 'That code was not accepted.');
      setSaving(false);
    }
  };

  const submitCash = async (event) => {
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
          method: 'cash',
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

  const submit = (event) => {
    event.preventDefault();
    if (momoPrompt?.needs_code) return submitMomoCode(event);
    if (method === 'momo') return startMomo();
    return submitCash(event);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6">
      <form onSubmit={submit} className="w-full max-w-lg rounded-3xl bg-slate-900 p-6 shadow-2xl sm:p-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold text-white">Record a payment</h2>
            <p className="mt-1 text-sm text-slate-400">
              Cash is recorded here. MoMo sends a confirmation to the parent phone so the payment
              goes through the system.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              if (momoPrompt?.reference) abortMomo();
              onClose?.();
            }}
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
                setPhone('');
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              placeholder="Search by name or student ID"
              autoComplete="off"
              required={!studentId}
              disabled={Boolean(momoPrompt)}
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
            disabled={Boolean(momoPrompt)}
          />
        </label>

        <fieldset className="mt-4">
          <legend className="text-sm font-medium text-slate-300">How they paid</legend>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {METHODS.map((item) => (
              <button
                key={item.id}
                type="button"
                disabled={Boolean(momoPrompt)}
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

        {method === 'momo' ? (
          <label className="mt-4 block text-sm font-medium text-slate-300">
            Parent MoMo number
            <input
              className={`${fieldClass} mt-2`}
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="0551234567"
              required
              disabled={Boolean(momoPrompt)}
            />
            <span className="mt-1 block text-xs text-slate-500">
              The Paystack confirmation is sent to this phone. Change it if the parent is using another
              number today.
            </span>
          </label>
        ) : (
          <label className="mt-4 block text-sm font-medium text-slate-300">
            Receipt or reference (optional)
            <input
              className={`${fieldClass} mt-2`}
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Receipt number"
            />
          </label>
        )}

        {momoPrompt ? (
          <div className="mt-4 rounded-2xl border border-sky-500/40 bg-sky-500/10 p-4 text-sm text-sky-50">
            <p>{momoPrompt.display_text}</p>
            {momoPrompt.needs_code ? (
              <label className="mt-3 block text-sm font-medium text-white">
                {momoPrompt.code_type === 'pin' ? 'PIN from the parent phone' : 'Code from the parent phone'}
                <input
                  className={`${fieldClass} mt-2`}
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value)}
                  placeholder={momoPrompt.code_type === 'pin' ? 'PIN' : '6-digit code'}
                  autoComplete="one-time-code"
                />
              </label>
            ) : (
              <p className="mt-2 text-xs text-sky-200">Waiting for the parent to approve the prompt…</p>
            )}
          </div>
        ) : null}

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="submit"
            disabled={saving}
            className="rounded-full bg-primary-600 px-6 py-3 text-white hover:bg-primary-700 disabled:opacity-50"
          >
            {saving
              ? method === 'momo'
                ? momoPrompt?.needs_code
                  ? 'Submitting code…'
                  : 'Sending prompt…'
                : 'Saving…'
              : momoPrompt?.needs_code
                ? 'Submit code'
                : method === 'momo'
                  ? 'Send MoMo prompt'
                  : 'Save payment'}
          </button>
          <button
            type="button"
            onClick={() => {
              if (momoPrompt?.reference) abortMomo();
              onClose?.();
            }}
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
