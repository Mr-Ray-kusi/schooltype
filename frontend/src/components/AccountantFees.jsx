import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';
import { Copy, FileSpreadsheet, Plus, RefreshCw } from 'lucide-react';
import RecordFeePaymentModal from './RecordFeePaymentModal';
import FeePaymentReceiptModal from './FeePaymentReceiptModal';
import { formatGhs } from '../utils/feeReceiptPdf';
import { downloadTableXlsx } from '../utils/tableXlsx';

const formatWhen = (value) => {
  if (!value) return '';
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Africa/Accra',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).format(new Date(value));
  } catch {
    return String(value);
  }
};

const channelLabel = (row) => {
  const payment = row.payment || row;
  const channel = String(payment.channel || payment.payment_method || '').toLowerCase();
  if (payment.manual || channel === 'cash') return 'Cash at school';
  if (channel === 'momo' || channel === 'mobile_money') return payment.manual ? 'MoMo at school' : 'Paid online · MoMo';
  if (channel === 'bank' || channel === 'bank_transfer') return payment.manual ? 'Bank at school' : 'Paid online · Bank';
  if (channel === 'card') return 'Paid online · Card';
  if (row.paid_amount > 0) return 'Paid online';
  return '—';
};

const FeeClassChart = ({ rows }) => {
  const max = Math.max(1, ...rows.flatMap((row) => [Number(row.paid_amount) || 0, Number(row.outstanding) || 0]));
  if (!rows.length) {
    return (
      <div className="rounded-3xl border border-dashed border-slate-700 bg-slate-900/40 px-5 py-10 text-center text-sm text-slate-400">
        No class totals to chart yet.
      </div>
    );
  }
  return (
    <div className="rounded-3xl border border-slate-700 bg-slate-900/60 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-white">Collected vs outstanding by class</h2>
        <div className="flex gap-4 text-xs text-slate-400">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" /> Collected
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-amber-400" /> Outstanding
          </span>
        </div>
      </div>
      <div className="mt-5 space-y-4">
        {rows.map((row) => {
          const paid = Number(row.paid_amount) || 0;
          const due = Number(row.outstanding) || 0;
          return (
            <div key={row.className}>
              <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
                <p className="font-medium text-slate-200">{row.className}</p>
                <p className="text-xs text-slate-500">{row.students} student{row.students === 1 ? '' : 's'}</p>
              </div>
              <div className="grid gap-1.5">
                <div className="flex items-center gap-2">
                  <div className="h-3 flex-1 overflow-hidden rounded-full bg-slate-800">
                    <div
                      className="h-full rounded-full bg-emerald-400"
                      style={{ width: paid > 0 ? `${Math.max(2, (paid / max) * 100)}%` : '0%' }}
                    />
                  </div>
                  <span className="w-28 shrink-0 text-right text-xs tabular-nums text-emerald-300">{formatGhs(paid)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-3 flex-1 overflow-hidden rounded-full bg-slate-800">
                    <div
                      className="h-full rounded-full bg-amber-400"
                      style={{ width: due > 0 ? `${Math.max(2, (due / max) * 100)}%` : '0%' }}
                    />
                  </div>
                  <span className="w-28 shrink-0 text-right text-xs tabular-nums text-amber-300">{formatGhs(due)}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const AccountantFees = ({
  schoolName,
  authHeaders,
  readOnly = false,
  reminderOpen,
  onReminderOpenChange,
  hideReminderButton = false,
}) => {
  const requestConfig = useMemo(() => ({ headers: authHeaders }), [authHeaders]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('unpaid');
  const [classFilter, setClassFilter] = useState('');
  const [showManual, setShowManual] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [showReminder, setShowReminder] = useState(false);
  const [reminderMessage, setReminderMessage] = useState(
    'Dear Parent, please settle outstanding school fees this term. Pay here: {pay_link} You can pay with MoMo, bank transfer, or USSD.'
  );
  const [smsQuote, setSmsQuote] = useState(null);
  const [sending, setSending] = useState(false);
  const [exporting, setExporting] = useState('');

  const load = useCallback(async () => {
    try {
      const { data: payload } = await axios.get('/api/staff-portal/session/fees/overview', requestConfig);
      setData(payload);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to load fees');
      throw err;
    } finally {
      setLoading(false);
    }
  }, [requestConfig]);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  useEffect(() => {
    if (reminderOpen) {
      setSmsQuote(null);
      setShowReminder(true);
    }
  }, [reminderOpen]);

  const copyLink = async (path) => {
    const url = `${window.location.origin}${path}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Payment link copied');
    } catch {
      toast.error('Could not copy link');
    }
  };

  const sendReminder = async () => {
    setSending(true);
    try {
      if (!smsQuote) {
        const { data } = await axios.post(
          '/api/staff-portal/session/fees/reminder',
          { message: reminderMessage },
          requestConfig
        );
        setSmsQuote(data);
        if (!data.can_send && data.blockers?.length) {
          toast.error(data.blockers.join(' '));
        }
        return;
      }
      if (!smsQuote.can_send) {
        toast.error(smsQuote.blockers?.join(' ') || 'Not enough SMS units to send this reminder.');
        return;
      }
      const { data } = await axios.post(
        '/api/staff-portal/session/fees/reminder',
        { message: reminderMessage, confirmSmsPayment: true },
        requestConfig
      );
      const sent = data?.sms_delivery?.sent;
      const failed = data?.sms_delivery?.failed;
      if (data?.sms_delivery?.dryRun) {
        toast.success(`TEST ONLY — no SMS sent. ${sent || 0} owing parent message(s) logged.`);
      } else if (failed > 0) {
        toast.success(`SMS sent to ${sent} owing parent(s); ${failed} failed.`);
      } else {
        toast.success(`SMS sent to ${sent ?? smsQuote.recipients} owing parent(s) with each child's pay link.`);
      }
      setShowReminder(false);
      setSmsQuote(null);
      onReminderOpenChange?.(false);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not send the reminder.');
    } finally {
      setSending(false);
    }
  };

  const matchesClass = (row, className = classFilter) =>
    !className || (row.class || row.class_name || 'Unassigned') === className;

  const paid = useMemo(
    () => (data?.paid || []).filter((row) => matchesClass(row)),
    [data, classFilter]
  );
  const unpaid = useMemo(
    () => (data?.unpaid || []).filter((row) => matchesClass(row)),
    [data, classFilter]
  );
  const chartRows = useMemo(
    () => (data?.chart?.classes || []).filter((row) => !classFilter || row.className === classFilter),
    [data, classFilter]
  );
  const classNames = data?.classes?.length
    ? data.classes
    : [...new Set((data?.students || []).map((row) => row.class).filter(Boolean))];
  const totals = data?.totals || {};
  const rows = tab === 'paid' ? paid : unpaid;
  const selected = (data?.students || []).find((row) => row.id === selectedId) || null;
  const periodLabel = data?.period_label || data?.term_name || data?.month;

  const exportTerm = async () => {
    const students = (data?.students || []).filter((row) => matchesClass(row) && (row.fee_amount > 0 || row.paid_amount > 0));
    if (!students.length) {
      toast.error('No fee records to export for this term.');
      return;
    }
    setExporting('term');
    try {
      await downloadTableXlsx(
        ['Student', 'Class', 'Fee billed', 'Paid', 'Outstanding', 'Status', 'Recorded by', 'Channel'],
        students.map((row) => [
          row.name,
          row.class || '',
          Number(row.fee_amount || 0).toFixed(2),
          Number(row.paid_amount || 0).toFixed(2),
          Number(row.outstanding || 0).toFixed(2),
          row.fully_paid ? 'Fully paid' : Number(row.paid_amount) > 0 ? 'Part paid' : 'Unpaid',
          row.recorded_by || '',
          channelLabel(row),
        ]),
        `fees-${data?.month || 'term'}${classFilter ? `-${classFilter}` : ''}.xlsx`,
        'This term'
      );
    } catch {
      toast.error('Could not create the Excel file.');
    } finally {
      setExporting('');
    }
  };

  const exportYear = async () => {
    const ledger = (data?.year_ledger || []).filter((row) => matchesClass(row));
    if (!ledger.length) {
      toast.error('No payments recorded this year yet.');
      return;
    }
    setExporting('year');
    try {
      await downloadTableXlsx(
        ['Date', 'Student', 'Class', 'Amount', 'Method', 'Recorded by', 'Period', 'Reference'],
        ledger.map((row) => [
          formatWhen(row.created_at),
          row.student_name || '',
          row.class_name || '',
          Number(row.amount || 0).toFixed(2),
          channelLabel(row),
          row.recorded_by || '',
          row.payment_month || '',
          String(row.reference || '').replace(/^manual:/, ''),
        ]),
        `fees-${data?.year || 'year'}-annual${classFilter ? `-${classFilter}` : ''}.xlsx`,
        `${data?.year || 'Year'} ledger`
      );
    } catch {
      toast.error('Could not create the Excel file.');
    } finally {
      setExporting('');
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div>
          <h2 className="text-2xl font-bold text-white">Fees paid and unpaid</h2>
          <p className="mt-1 text-sm text-slate-400">
            {periodLabel || 'This term'}
            {classFilter ? ` · ${classFilter}` : ''}.{' '}
            {readOnly
              ? 'View only. The accountant records payments and sends reminders.'
              : 'Record cash payments, print receipts, and export reports.'}
          </p>
        </div>
        <div className="flex flex-nowrap items-center gap-2 overflow-x-auto">
          <select
            value={classFilter}
            onChange={(e) => setClassFilter(e.target.value)}
            className="h-10 min-w-[8.5rem] shrink-0 rounded-lg border border-slate-600 bg-slate-900 px-3 text-sm text-white"
          >
            <option value="">All classes</option>
            {classNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              load().catch(() => {});
            }}
            disabled={loading}
            className="inline-flex h-10 shrink-0 items-center gap-2 rounded-lg border border-slate-600 px-3 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-70"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          {readOnly ? null : (
            <button
              type="button"
              onClick={() => setShowManual(true)}
              className="inline-flex h-10 shrink-0 items-center gap-2 rounded-lg bg-primary-600 px-4 text-sm font-medium text-white hover:bg-primary-700"
            >
              <Plus className="h-4 w-4" />
              Record payment
            </button>
          )}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-3xl border border-slate-700 bg-slate-800 p-5">
          <p className="text-sm uppercase tracking-wide text-slate-300">Collected this term</p>
          <p className="mt-3 text-2xl font-semibold text-white">{formatGhs(totals.paid_amount)}</p>
        </div>
        <div className="rounded-3xl border border-slate-700 bg-slate-800 p-5">
          <p className="text-sm uppercase tracking-wide text-slate-300">Still unpaid</p>
          <p className="mt-3 text-2xl font-semibold text-white">{formatGhs(totals.unpaid_amount)}</p>
        </div>
        <div className="rounded-3xl border border-slate-700 bg-slate-800 p-5">
          <p className="text-sm uppercase tracking-wide text-slate-300">Students owing</p>
          <p className="mt-3 text-2xl font-semibold text-white">{totals.unpaid || 0}</p>
        </div>
        <div className="rounded-3xl border border-slate-700 bg-slate-800 p-5">
          <p className="text-sm uppercase tracking-wide text-slate-300">Collected this year</p>
          <p className="mt-3 text-2xl font-semibold text-white">{formatGhs(totals.year_collected)}</p>
        </div>
      </div>

      <FeeClassChart rows={chartRows} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-full border border-slate-700 bg-slate-900 p-1 text-sm">
          <button
            type="button"
            onClick={() => setTab('unpaid')}
            className={`rounded-full px-4 py-1.5 ${tab === 'unpaid' ? 'bg-sky-500 text-white' : 'text-slate-300'}`}
          >
            Unpaid ({unpaid.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('paid')}
            className={`rounded-full px-4 py-1.5 ${tab === 'paid' ? 'bg-sky-500 text-white' : 'text-slate-300'}`}
          >
            Paid ({paid.length})
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={exportTerm}
            disabled={Boolean(exporting)}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-50"
          >
            <FileSpreadsheet className="h-4 w-4" />
            {exporting === 'term' ? 'Exporting…' : 'Excel · this term'}
          </button>
          <button
            type="button"
            onClick={exportYear}
            disabled={Boolean(exporting)}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-50"
          >
            <FileSpreadsheet className="h-4 w-4" />
            {exporting === 'year' ? 'Exporting…' : 'Excel · this year'}
          </button>
          {readOnly || hideReminderButton ? null : (
            <button
              type="button"
              onClick={() => {
                setSmsQuote(null);
                setShowReminder(true);
              }}
              className="rounded-full bg-primary-600 px-5 py-2 text-sm font-medium text-white hover:bg-primary-700"
            >
              SMS owing parents
            </button>
          )}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-slate-600 bg-slate-800/50 py-16 text-center">
          <p className="text-slate-300">
            {tab === 'paid' ? 'No fee payments recorded yet for this view.' : 'No unpaid fee records for this view.'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-3xl border border-slate-700">
          <table className="w-full min-w-[880px] text-left text-sm">
            <thead className="bg-slate-800 text-slate-300">
              <tr>
                <th className="px-4 py-3">Student</th>
                <th className="px-4 py-3">Class</th>
                <th className="px-4 py-3">Fee</th>
                <th className="px-4 py-3">Paid</th>
                <th className="px-4 py-3">Outstanding</th>
                <th className="px-4 py-3">Recorded by</th>
                <th className="px-4 py-3">{tab === 'paid' ? 'Channel' : 'Pay link'}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const outstanding = Number(row.outstanding) || 0;
                return (
                  <tr
                    key={row.id}
                    onClick={() => setSelectedId(row.id)}
                    className="cursor-pointer border-t border-slate-700 bg-slate-900 text-slate-100 hover:bg-slate-800/80"
                  >
                    <td className="px-4 py-3">{row.name}</td>
                    <td className="px-4 py-3">{row.class || '—'}</td>
                    <td className="px-4 py-3">{formatGhs(row.fee_amount)}</td>
                    <td className="px-4 py-3">{formatGhs(row.paid_amount || 0)}</td>
                    <td className={`px-4 py-3 font-medium ${outstanding >= 0.01 ? 'text-amber-300' : 'text-emerald-300'}`}>
                      {outstanding >= 0.01 ? formatGhs(outstanding) : 'None'}
                    </td>
                    <td className="px-4 py-3 text-slate-300">{row.recorded_by || '—'}</td>
                    <td className="px-4 py-3">
                      {tab === 'paid' ? (
                        <div className="flex items-center gap-2">
                          <span className="capitalize">
                            {row.payment?.channel || row.payment?.payment_method || 'Paystack'}
                          </span>
                          {row.pay_path ? (
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                copyLink(row.pay_path);
                              }}
                              className="text-sky-400 hover:text-sky-300"
                              title="Copy pay link"
                            >
                              <Copy className="h-4 w-4" />
                            </button>
                          ) : null}
                        </div>
                      ) : row.pay_path ? (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            copyLink(row.pay_path);
                          }}
                          className="inline-flex items-center gap-1 text-sky-400 hover:text-sky-300"
                        >
                          <Copy className="h-4 w-4" />
                          Copy
                        </button>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showManual && !readOnly ? (
        <RecordFeePaymentModal
          students={data?.students || []}
          month={data?.month}
          requestConfig={requestConfig}
          submitUrl="/api/staff-portal/session/fees/manual"
          momoCheckoutUrl="/api/staff-portal/session/fees/checkout"
          onClose={() => setShowManual(false)}
          onSaved={() => {
            setLoading(true);
            load().catch(() => {});
          }}
        />
      ) : null}

      {selected ? (
        <FeePaymentReceiptModal
          student={selected}
          month={data?.month}
          periodLabel={periodLabel}
          schoolName={schoolName}
          requestConfig={requestConfig}
          patchUrl={(id) => `/api/staff-portal/session/fees/manual/${encodeURIComponent(id)}`}
          onClose={() => setSelectedId(null)}
          onChanged={() => {
            setLoading(true);
            load().catch(() => {});
          }}
        />
      ) : null}

      {showReminder ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6">
          <div className="w-full max-w-2xl rounded-3xl bg-slate-900 p-8 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <h3 className="text-2xl font-semibold text-white">Fee reminder</h3>
              <button
                type="button"
                onClick={() => {
                  setShowReminder(false);
                  onReminderOpenChange?.(false);
                }}
                className="rounded-full border border-slate-600 px-4 py-2 text-slate-200 hover:bg-slate-800"
              >
                Close
              </button>
            </div>
            <p className="mt-2 text-sm text-slate-400">
              SMS goes only to parents of students who still owe. {'{pay_link}'} is replaced with that child's payment page.
            </p>
            <textarea
              value={reminderMessage}
              onChange={(e) => {
                setReminderMessage(e.target.value);
                setSmsQuote(null);
              }}
              rows="6"
              className="mt-6 w-full rounded-3xl border border-slate-600 bg-slate-800 px-4 py-4 text-white"
            />
            {smsQuote ? (
              <p className="mt-3 text-sm text-slate-300">
                {smsQuote.recipients} owing parent{smsQuote.recipients === 1 ? '' : 's'} · {smsQuote.owing_students} student
                link{smsQuote.owing_students === 1 ? '' : 's'} · {smsQuote.quote?.units_required || 0} SMS unit
                {(smsQuote.quote?.units_required || 0) === 1 ? '' : 's'}
              </p>
            ) : null}
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={sendReminder}
                disabled={sending}
                className="rounded-full bg-primary-600 px-6 py-3 text-white hover:bg-primary-700 disabled:opacity-50"
              >
                {sending ? 'Sending…' : smsQuote ? 'Confirm SMS' : 'Check cost'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowReminder(false);
                  onReminderOpenChange?.(false);
                }}
                className="rounded-full border border-slate-600 px-6 py-3 text-slate-200"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default AccountantFees;
