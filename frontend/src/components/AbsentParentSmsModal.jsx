import React, { useState } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { schoolLocalDate } from '../utils/schoolDate';

const AbsentParentSmsModal = ({ open, onClose, date, requestConfig }) => {
  const [quote, setQuote] = useState(null);
  const [sending, setSending] = useState(false);
  const ymd = /^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) ? String(date) : schoolLocalDate();

  if (!open) return null;

  const send = async () => {
    setSending(true);
    try {
      const { data } = await axios.post(
        '/api/attendance/absent-sms',
        { date: ymd, confirmSmsPayment: Boolean(quote) },
        requestConfig
      );
      if (!quote) {
        setQuote(data);
        if (!data.can_send && data.blockers?.length) {
          toast.error(data.blockers.join(' '));
        }
        return;
      }
      const sent = data?.sms_delivery?.sent;
      const failed = data?.sms_delivery?.failed;
      if (data?.sms_delivery?.dryRun) {
        toast.success(`TEST ONLY — no SMS sent. ${sent || 0} absent-parent message(s) logged.`);
      } else if (failed > 0) {
        toast.success(`SMS sent to ${sent} parent(s); ${failed} failed.`);
      } else {
        toast.success(`SMS sent to ${sent ?? quote.recipients} parent(s) of absent students.`);
      }
      setQuote(null);
      onClose?.();
    } catch (error) {
      toast.error(error.response?.data?.error || 'Could not SMS absent-student parents');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 px-3 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:items-center sm:px-4 sm:py-6">
      <div className="max-h-[min(92dvh,36rem)] w-full max-w-md overflow-y-auto rounded-t-2xl bg-slate-900 p-5 shadow-2xl sm:rounded-2xl">
        <h2 className="text-lg font-semibold text-white">SMS parents of absent students</h2>
        <p className="mt-2 text-sm text-slate-400">
          Built-in message for {format(new Date(`${ymd}T12:00:00`), 'EEE d MMM yyyy')}.
        </p>
        <p className="mt-4 rounded-xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-sm text-slate-200">
          {quote?.message ||
            '{student_name} did not come to school today. Please contact the school if this is unexpected.'}
        </p>
        {quote ? (
          <p className="mt-3 text-sm text-slate-300">
            {quote.recipients} parent{quote.recipients === 1 ? '' : 's'} · {quote.absent_students || 0} student
            {(quote.absent_students || 0) === 1 ? '' : 's'} · {quote.quote?.units_required || 0} SMS unit
            {(quote.quote?.units_required || 0) === 1 ? '' : 's'}
          </p>
        ) : null}
        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={send}
            disabled={sending}
            className="rounded-full bg-sky-600 px-5 py-2 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
          >
            {sending ? 'Sending…' : quote ? 'Confirm SMS' : 'Check cost'}
          </button>
          <button
            type="button"
            onClick={() => {
              setQuote(null);
              onClose?.();
            }}
            className="rounded-full border border-slate-600 px-5 py-2 text-sm text-slate-200"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};

export default AbsentParentSmsModal;
