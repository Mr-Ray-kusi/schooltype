import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';
import { Copy, Plus, RefreshCw, Search } from 'lucide-react';
import { useAuth } from '../contexts/authcontext';
import RecordFeePaymentModal from '../components/RecordFeePaymentModal';
import FeePaymentReceiptModal from '../components/FeePaymentReceiptModal';

const formatGhs = (value) =>
  `GHS ${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const FeesUnpaid = () => {
  const { school } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showReminderModal, setShowReminderModal] = useState(false);
  const [reminderMessage, setReminderMessage] = useState(
    `Dear Parent, please settle outstanding school fees this term using ${window.location.origin}/fees. You can pay with MoMo, bank transfer, or USSD.`
  );
  const [sending, setSending] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');

  const load = useCallback(async () => {
    try {
      const { data: payload } = await axios.get('/api/fees/overview');
      setData(payload);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to load unpaid fees');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

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
      await axios.post('/api/messages', {
        senderName: 'Admin',
        senderRole: 'Admin',
        sendMode: 'Group',
        recipients: 'Parents',
        individualRole: 'Parent',
        recipientEmail: '',
        attachmentName: null,
        deliveryChannel: 'email',
        message: reminderMessage,
      });
      toast.success('Fee reminder sent to parents.');
      setShowReminderModal(false);
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to send fee reminder.');
    } finally {
      setSending(false);
    }
  };

  const unpaid = data?.unpaid || [];
  const totals = data?.totals || {};
  const selected = (data?.students || unpaid).find((row) => row.id === selectedId) || null;
  const filteredUnpaid = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return unpaid;
    return unpaid.filter((row) =>
      [row.name, row.class, row.recorded_by, row.roll_number, row.barcode]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q))
    );
  }, [unpaid, searchTerm]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">Fees Unpaid</h1>
          <p className="mt-1 text-sm text-slate-400">
            Outstanding balances for {data?.term_name || data?.period_label || data?.month || 'this term'}. Share the pay link so parents can use MoMo, bank, or USSD.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              load();
            }}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            type="button"
            onClick={() => setShowManual(true)}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"
          >
            <Plus className="h-4 w-4" />
            Record payment
          </button>
          <button
            type="button"
            onClick={() => setShowReminderModal(true)}
            className="rounded-full bg-primary-600 px-5 py-2 text-sm font-medium text-white hover:bg-primary-700"
          >
            Send Reminder
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 md:gap-4">
        <div className="min-w-0 rounded-2xl border border-slate-700 bg-slate-800 p-2.5 sm:rounded-3xl sm:p-5">
          <p className="text-[10px] uppercase leading-tight tracking-wide text-slate-300 sm:text-sm">
            Total overdue
          </p>
          <p className="mt-2 break-words text-sm font-semibold text-white sm:mt-4 sm:text-3xl">
            {formatGhs(totals.unpaid_amount)}
          </p>
        </div>
        <div className="min-w-0 rounded-2xl border border-slate-700 bg-slate-800 p-2.5 sm:rounded-3xl sm:p-5">
          <p className="text-[10px] uppercase leading-tight tracking-wide text-slate-300 sm:text-sm">
            Students owing
          </p>
          <p className="mt-2 break-words text-lg font-semibold text-white sm:mt-4 sm:text-3xl">
            {totals.unpaid || 0}
          </p>
        </div>
        <div className="min-w-0 rounded-2xl border border-slate-700 bg-slate-800 p-2.5 sm:rounded-3xl sm:p-5">
          <p className="text-[10px] uppercase leading-tight tracking-wide text-slate-300 sm:text-sm">
            Already paid
          </p>
          <p className="mt-2 break-words text-lg font-semibold text-white sm:mt-4 sm:text-3xl">
            {totals.paid || 0}
          </p>
        </div>
      </div>

      {unpaid.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-slate-600 bg-slate-800/50 py-16 text-center">
          <p className="text-slate-300">No unpaid fee records this month.</p>
          <p className="mt-1 text-sm text-slate-500">Set class fees in Setup if this list should show owing students.</p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="relative max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search student name, class, or ID…"
              className="w-full rounded-lg border border-slate-600 bg-slate-900 py-2.5 pl-10 pr-4 text-sm text-white placeholder:text-slate-500 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30"
            />
          </div>
          {filteredUnpaid.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-slate-600 bg-slate-800/50 py-12 text-center">
              <p className="text-slate-300">No students match your search.</p>
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
                <th className="px-4 py-3">Pay link</th>
              </tr>
            </thead>
            <tbody>
              {filteredUnpaid.map((row) => (
                <tr
                  key={row.id}
                  onClick={() => setSelectedId(row.id)}
                  className="cursor-pointer border-t border-slate-700 bg-slate-900 text-slate-100 hover:bg-slate-800/80"
                >
                  <td className="px-4 py-3">{row.name}</td>
                  <td className="px-4 py-3">{row.class || '—'}</td>
                  <td className="px-4 py-3">{formatGhs(row.fee_amount)}</td>
                  <td className="px-4 py-3">{formatGhs(row.paid_amount || 0)}</td>
                  <td className="px-4 py-3 font-medium text-amber-300">{formatGhs(row.outstanding || row.fee_amount)}</td>
                  <td className="px-4 py-3 text-slate-300">{row.recorded_by || '—'}</td>
                  <td className="px-4 py-3">
                    {row.pay_path ? (
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
              ))}
            </tbody>
          </table>
        </div>
          )}
        </div>
      )}

      {showReminderModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6">
          <div className="w-full max-w-2xl rounded-3xl bg-slate-900 p-8 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <h2 className="text-2xl font-semibold text-white">Fee reminder</h2>
              <button
                type="button"
                onClick={() => setShowReminderModal(false)}
                className="rounded-full border border-slate-600 px-4 py-2 text-slate-200 hover:bg-slate-800"
              >
                Close
              </button>
            </div>
            <textarea
              value={reminderMessage}
              onChange={(e) => setReminderMessage(e.target.value)}
              rows="6"
              className="mt-6 w-full rounded-3xl border border-slate-600 bg-slate-800 px-4 py-4 text-white"
            />
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={sendReminder}
                disabled={sending}
                className="rounded-full bg-primary-600 px-6 py-3 text-white hover:bg-primary-700 disabled:opacity-50"
              >
                {sending ? 'Sending...' : 'Send Reminder'}
              </button>
              <button
                type="button"
                onClick={() => setShowReminderModal(false)}
                className="rounded-full border border-slate-600 px-6 py-3 text-slate-200"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {showManual ? (
        <RecordFeePaymentModal
          students={data?.students || unpaid}
          month={data?.month}
          onClose={() => setShowManual(false)}
          onSaved={() => {
            setLoading(true);
            load();
          }}
        />
      ) : null}

      {selected ? (
        <FeePaymentReceiptModal
          student={selected}
          month={data?.month}
          periodLabel={data?.period_label || data?.term_name}
          schoolName={school?.name}
          onClose={() => setSelectedId(null)}
          onChanged={() => {
            setLoading(true);
            load();
          }}
        />
      ) : null}
    </div>
  );
};

export default FeesUnpaid;
