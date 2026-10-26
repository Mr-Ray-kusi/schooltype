import React, { useMemo, useState } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';
import { Download, Lock, Pencil, Printer } from 'lucide-react';
import {
  downloadFeeReceiptPdf,
  printFeeReceipt,
  receiptOptionsFromStudent,
} from '../utils/feeReceiptPdf';

const formatGhs = (value) =>
  `GHS ${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fieldClass =
  'w-full rounded-xl border border-slate-600/80 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none focus:border-sky-500/60 focus:ring-2 focus:ring-sky-500/30';

const METHODS = [
  { id: 'cash', label: 'Cash at school' },
  { id: 'momo', label: 'MoMo' },
  { id: 'bank', label: 'Bank' },
];

const formatWhen = (value) => {
  if (!value) return '—';
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Africa/Accra',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value));
  } catch {
    return String(value);
  }
};

const displayReference = (value) => {
  const ref = String(value || '').trim();
  if (!ref) return '—';
  if (ref.startsWith('manual:')) return ref.slice(7);
  if (ref.startsWith('manual_')) return 'Recorded at school';
  return ref;
};

const paymentLabel = (row) => {
  const channel = String(row.channel || row.payment_method || '').toLowerCase();
  if (row.manual) {
    if (channel === 'momo' || channel === 'mobile_money') return 'MoMo at school';
    if (channel === 'bank' || channel === 'bank_transfer') return 'Bank at school';
    return 'Cash at school';
  }
  if (channel === 'momo' || channel === 'mobile_money') return 'Paid online · MoMo';
  if (channel === 'bank' || channel === 'bank_transfer') return 'Paid online · Bank';
  if (channel === 'card') return 'Paid online · Card';
  return 'Paid online';
};

const manualChannel = (row) => {
  const channel = String(row.channel || '').toLowerCase();
  if (['cash', 'momo', 'bank'].includes(channel)) return channel;
  const method = String(row.payment_method || '').toLowerCase();
  if (['cash', 'momo', 'bank'].includes(method)) return method;
  return 'cash';
};

const FeePaymentReceiptModal = ({
  student,
  month,
  periodLabel,
  schoolName,
  onClose,
  onChanged,
  requestConfig,
  patchUrl,
}) => {
  const [editingId, setEditingId] = useState(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('cash');
  const [reference, setReference] = useState('');
  const [saving, setSaving] = useState(false);

  const payments = useMemo(
    () =>
      [...(student?.payments || [])].sort(
        (a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0)
      ),
    [student]
  );

  const startEdit = (row) => {
    setEditingId(row.id);
    setAmount(String(row.amount || ''));
    setMethod(manualChannel(row));
    setReference(displayReference(row.payment_reference) === 'Recorded at school' ? '' : displayReference(row.payment_reference));
  };

  const saveEdit = async (event) => {
    event.preventDefault();
    if (!(Number(amount) > 0)) {
      toast.error('Enter a valid amount.');
      return;
    }
    setSaving(true);
    try {
      const url = patchUrl
        ? patchUrl(editingId)
        : `/api/fees/manual/${encodeURIComponent(editingId)}`;
      const { data } = await axios.patch(
        url,
        {
          amount: Number(amount),
          method,
          reference: reference.trim(),
        },
        requestConfig
      );
      toast.success(
        data.fully_paid
          ? 'Payment updated. This student is now fully paid.'
          : `Payment updated. Outstanding is ${formatGhs(data.outstanding)}.`
      );
      setEditingId(null);
      onChanged?.(data);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not update this payment.');
    } finally {
      setSaving(false);
    }
  };

  if (!student) return null;
  const outstanding = Number(student.outstanding) || 0;
  const receiptOptions = receiptOptionsFromStudent(student, {
    schoolName,
    month,
    periodLabel,
  });

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 px-3 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:items-center sm:px-4 sm:py-6">
      <div className="max-h-[min(92dvh,40rem)] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-slate-700 bg-slate-900 p-5 shadow-2xl sm:rounded-3xl sm:p-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-sky-300/80">School fees receipt</p>
            <h2 className="mt-2 text-2xl font-semibold text-white">{student.name}</h2>
            <p className="mt-1 text-sm text-slate-400">
              {schoolName || 'School'}
              {student.class ? ` · ${student.class}` : ''}
              {periodLabel || month ? ` · ${periodLabel || month}` : ''}
            </p>
            {student.recorded_by ? (
              <p className="mt-1 text-xs text-slate-500">Recorded by {student.recorded_by}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-slate-600 px-4 py-2 text-slate-200 hover:bg-slate-800"
          >
            Close
          </button>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => printFeeReceipt(receiptOptions)}
            className="inline-flex min-w-0 items-center justify-center gap-1.5 rounded-full border border-slate-600 px-2 py-2 text-xs text-slate-100 hover:bg-slate-800 sm:gap-2 sm:px-4 sm:text-sm"
          >
            <Printer className="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" />
            <span className="truncate">Print receipt</span>
          </button>
          <button
            type="button"
            onClick={() => downloadFeeReceiptPdf(receiptOptions)}
            className="inline-flex min-w-0 items-center justify-center gap-1.5 rounded-full bg-sky-500 px-2 py-2 text-xs font-medium text-white hover:bg-sky-400 sm:gap-2 sm:px-4 sm:text-sm"
          >
            <Download className="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" />
            <span className="truncate">Download PDF</span>
          </button>
        </div>

        <dl className="mt-6 grid grid-cols-3 gap-2 rounded-2xl border border-slate-700 bg-slate-950/50 p-3 text-xs">
          <div>
            <dt className="text-slate-500">Fee</dt>
            <dd className="mt-1 text-sm text-white">{formatGhs(student.fee_amount)}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Paid</dt>
            <dd className="mt-1 text-sm text-emerald-300">{formatGhs(student.paid_amount)}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Outstanding</dt>
            <dd className={`mt-1 text-sm ${outstanding >= 0.01 ? 'text-amber-300' : 'text-emerald-300'}`}>
              {outstanding >= 0.01 ? formatGhs(outstanding) : 'None'}
            </dd>
          </div>
        </dl>

        <div className="mt-6 space-y-3">
          <p className="text-sm font-medium text-slate-300">Payment details</p>
          {payments.length === 0 ? (
            <p className="text-sm text-slate-500">No payments recorded yet.</p>
          ) : (
            payments.map((row, index) => (
              <div key={row.id || index} className="rounded-2xl border border-slate-700 bg-slate-950/40 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-white">{paymentLabel(row)}</p>
                    <p className="mt-1 text-xs text-slate-500">{formatWhen(row.created_at)}</p>
                  </div>
                  <p className="text-sm font-semibold text-white">{formatGhs(row.amount)}</p>
                </div>
                <p className="mt-2 text-xs text-slate-400">Ref: {displayReference(row.payment_reference)}</p>
                {row.recorded_by_label || row.recorded_by ? (
                  <p className="mt-1 text-xs text-slate-500">
                    Recorded by {row.recorded_by_label || row.recorded_by}
                  </p>
                ) : null}
                {row.manual ? (
                  editingId === row.id ? (
                    <form onSubmit={saveEdit} className="mt-4 space-y-3 border-t border-slate-800 pt-3">
                      <label className="block text-xs font-medium text-slate-300">
                        Amount (GHS)
                        <input
                          className={`${fieldClass} mt-1`}
                          type="number"
                          min="0.01"
                          step="0.01"
                          value={amount}
                          onChange={(e) => setAmount(e.target.value)}
                          required
                        />
                      </label>
                      <div className="grid grid-cols-3 gap-2">
                        {METHODS.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => setMethod(item.id)}
                            className={`rounded-xl border px-2 py-2 text-xs font-medium ${
                              method === item.id
                                ? 'border-sky-400 bg-sky-500/10 text-white'
                                : 'border-slate-700 text-slate-300 hover:border-slate-500'
                            }`}
                          >
                            {item.label}
                          </button>
                        ))}
                      </div>
                      <label className="block text-xs font-medium text-slate-300">
                        Receipt or reference
                        <input
                          className={`${fieldClass} mt-1`}
                          value={reference}
                          onChange={(e) => setReference(e.target.value)}
                          placeholder="Optional"
                        />
                      </label>
                      <div className="flex gap-2">
                        <button
                          type="submit"
                          disabled={saving}
                          className="rounded-full bg-primary-600 px-4 py-2 text-xs font-medium text-white hover:bg-primary-700 disabled:opacity-50"
                        >
                          {saving ? 'Saving…' : 'Save change'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="rounded-full border border-slate-600 px-4 py-2 text-xs text-slate-200"
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  ) : (
                    <button
                      type="button"
                      onClick={() => startEdit(row)}
                      className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-sky-400 hover:text-sky-300"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      Edit this record
                    </button>
                  )
                ) : (
                  <p className="mt-3 inline-flex items-center gap-1 text-xs text-slate-500">
                    <Lock className="h-3.5 w-3.5" />
                    Paid online — this record cannot be edited
                  </p>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default FeePaymentReceiptModal;
