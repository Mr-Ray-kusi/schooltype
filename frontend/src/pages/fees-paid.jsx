import React, { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';
import { Plus, RefreshCw, Search } from 'lucide-react';
import { useAuth } from '../contexts/authcontext';
import RecordFeePaymentModal from '../components/RecordFeePaymentModal';
import FeePaymentReceiptModal from '../components/FeePaymentReceiptModal';
import PaginationBar from '../components/PaginationBar';
import { LIST_PAGE_SIZE } from '../utils/listApi.js';
import {
  FINANCE_PREFIXES,
  financeDataChanged,
  invalidateCache,
  notifySchoolDataChanged,
  onSchoolDataChanged,
  peekCache,
  rememberSession,
  sessionGet,
} from '../utils/requestCache';
import { useLivePoll } from '../hooks/useLivePoll';

const FEES_VIEW_KEY = 'view:fees-admin';

const feesCacheKey = ({ page, tab, search }) => `fees:admin:${tab}:${page}:${search || ''}`;

const formatGhs = (value) =>
  `GHS ${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const Fees = () => {
  const { school } = useAuth();
  const savedView = peekCache(FEES_VIEW_KEY) || {};
  const initialQuery = {
    page: savedView.page || 1,
    tab: savedView.tab || 'paid',
    search: savedView.search || '',
  };
  const initialFees = peekCache(feesCacheKey(initialQuery));
  const [data, setData] = useState(initialFees || null);
  const [loading, setLoading] = useState(!initialFees);
  const [tab, setTab] = useState(initialQuery.tab);
  const [showManual, setShowManual] = useState(false);
  const [showReminderModal, setShowReminderModal] = useState(false);
  const [reminderMessage, setReminderMessage] = useState(
    'Dear Parent, please settle outstanding school fees this term. Pay here: {pay_link} You can pay with MoMo, bank transfer, or USSD.'
  );
  const [smsQuote, setSmsQuote] = useState(null);
  const [sending, setSending] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [searchTerm, setSearchTerm] = useState(initialQuery.search);
  const [page, setPage] = useState(initialQuery.page);
  const filterRef = useRef({ tab: initialQuery.tab, search: initialQuery.search });
  const shownRef = useRef(Boolean(initialFees));

  const load = useCallback(async ({ fresh = false, spin = false } = {}) => {
    const key = feesCacheKey({ page, tab, search: searchTerm });
    if (!fresh) {
      const hit = peekCache(key);
      if (hit) {
        setData(hit);
        shownRef.current = true;
        setLoading(false);
        return;
      }
    }
    if (spin || (!peekCache(key) && !shownRef.current)) setLoading(true);
    try {
      if (fresh) invalidateCache('fees:admin:');
      const payload = await sessionGet(key, () =>
        axios
          .get('/api/fees/overview', {
            params: { page, limit: LIST_PAGE_SIZE, tab, q: searchTerm || undefined },
          })
          .then((response) => response.data)
      );
      setData(payload);
      shownRef.current = true;
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to load fees');
    } finally {
      setLoading(false);
    }
  }, [page, tab, searchTerm]);

  useEffect(() => {
    const hasCache = Boolean(peekCache(feesCacheKey({ page, tab, search: searchTerm })));
    load(hasCache ? { fresh: true } : {});
  }, [load, page, tab, searchTerm]);

  useEffect(() => {
    return onSchoolDataChanged((prefixes) => {
      if (financeDataChanged(prefixes)) load({ fresh: true });
    });
  }, [load]);

  useLivePoll(() => load({ fresh: true }), 45000, !loading);

  useEffect(() => {
    if (filterRef.current.tab === tab && filterRef.current.search === searchTerm) return;
    filterRef.current = { tab, search: searchTerm };
    setPage(1);
  }, [tab, searchTerm]);

  useEffect(() => {
    rememberSession(FEES_VIEW_KEY, { tab, page, search: searchTerm });
  }, [tab, page, searchTerm]);

  const sendReminder = async () => {
    setSending(true);
    try {
      if (!smsQuote) {
        const { data } = await axios.post('/api/fees/reminder', { message: reminderMessage });
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
      const { data } = await axios.post('/api/fees/reminder', {
        message: reminderMessage,
        confirmSmsPayment: true,
      });
      const sent = data?.sms_delivery?.sent;
      const failed = data?.sms_delivery?.failed;
      if (data?.sms_delivery?.dryRun) {
        toast.success(`TEST ONLY — no SMS sent. ${sent || 0} owing parent message(s) logged.`);
      } else if (failed > 0) {
        toast.success(`SMS sent to ${sent} owing parent(s); ${failed} failed.`);
      } else {
        toast.success(`SMS sent to ${sent ?? smsQuote.recipients} owing parent(s) with each child's pay link.`);
      }
      setShowReminderModal(false);
      setSmsQuote(null);
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to send fee reminder.');
    } finally {
      setSending(false);
    }
  };

  const paid = data?.paid || [];
  const unpaid = data?.unpaid || [];
  const totals = data?.totals || {};
  const rows = data?.items || (tab === 'unpaid' ? unpaid : paid);
  const selected = (data?.students || [...paid, ...unpaid]).find((row) => row.id === selectedId) || null;
  const filtered = rows;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="page-title">Fees</h1>
          <p className="mt-1 text-sm text-slate-400">
            Paid and unpaid balances for {data?.term_name || data?.period_label || data?.month || 'this term'}.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => load({ fresh: true, spin: true })}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-70"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            type="button"
            onClick={() => setShowManual(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
          >
            <Plus className="h-4 w-4" />
            Record payment
          </button>
          <button
            type="button"
            onClick={() => setShowReminderModal(true)}
            className="rounded-lg border border-slate-600 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800"
          >
            Send reminder
          </button>
        </div>
      </div>

      <div className="grid min-w-0 grid-cols-2 gap-2 md:grid-cols-4">
        <div className="min-w-0 rounded-xl border border-slate-700 bg-slate-800 p-3">
          <p className="text-[10px] uppercase leading-tight tracking-wide text-slate-300">Amount paid</p>
          <p className="mt-1.5 break-words text-lg font-extrabold text-emerald-300 lg:text-xl xl:text-2xl">
            {formatGhs(totals.paid_amount)}
          </p>
          <p className="mt-0.5 text-xs text-slate-400">{totals.paid || 0} student{(totals.paid || 0) === 1 ? '' : 's'}</p>
        </div>
        <div className="min-w-0 rounded-xl border border-slate-700 bg-slate-800 p-3">
          <p className="text-[10px] uppercase leading-tight tracking-wide text-slate-300">Unpaid revenue</p>
          <p className="mt-1.5 break-words text-lg font-extrabold text-amber-300 lg:text-xl xl:text-2xl">
            {formatGhs(
              Math.max(
                0,
                (totals.billed_amount == null
                  ? Number(totals.paid_amount || 0) + Number(totals.unpaid_amount || 0)
                  : Number(totals.billed_amount) || 0) -
                  Math.max(Number(totals.paid_amount) || 0, Number(totals.year_collected) || 0)
              )
            )}
          </p>
          <p className="mt-0.5 text-xs text-slate-400">{totals.unpaid || 0} student{(totals.unpaid || 0) === 1 ? '' : 's'} owing</p>
        </div>
        <div className="min-w-0 rounded-xl border border-slate-700 bg-slate-800 p-3">
          <p className="text-[10px] uppercase leading-tight tracking-wide text-slate-300">Term fee billed</p>
          <p className="mt-1.5 break-words text-lg font-extrabold text-white lg:text-xl xl:text-2xl">
            {formatGhs(
              totals.billed_amount ?? Number(totals.paid_amount || 0) + Number(totals.unpaid_amount || 0)
            )}
          </p>
          <p className="mt-0.5 text-xs text-slate-400">{totals.billed || 0} billed student{(totals.billed || 0) === 1 ? '' : 's'}</p>
        </div>
        <div className="min-w-0 rounded-xl border border-slate-700 bg-slate-800 p-3">
          <p className="text-[10px] uppercase leading-tight tracking-wide text-slate-300">Collected this year</p>
          <p className="mt-1.5 break-words text-lg font-extrabold text-white lg:text-xl xl:text-2xl">
            {formatGhs(totals.year_collected)}
          </p>
        </div>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setTab('paid')}
          className={`rounded-full px-4 py-1.5 text-sm font-medium ${
            tab === 'paid' ? 'bg-sky-500 text-white' : 'border border-slate-600 text-slate-300 hover:bg-slate-800'
          }`}
        >
          Paid
        </button>
        <button
          type="button"
          onClick={() => setTab('unpaid')}
          className={`rounded-full px-4 py-1.5 text-sm font-medium ${
            tab === 'unpaid' ? 'bg-sky-500 text-white' : 'border border-slate-600 text-slate-300 hover:bg-slate-800'
          }`}
        >
          Unpaid
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-slate-600 bg-slate-800/50 py-16 text-center">
          <p className="text-slate-300">
            {tab === 'unpaid' ? 'No unpaid fee records this term.' : 'No fee payments recorded yet this term.'}
          </p>
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
          {filtered.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-slate-600 bg-slate-800/50 py-12 text-center">
              <p className="text-slate-300">No students match your search.</p>
            </div>
          ) : (
            <>
              <div className="space-y-2 md:hidden">
                {filtered.map((row) => {
                  const outstanding = Number(row.outstanding) || 0;
                  const paidAmount = Number(row.paid_amount || row.payment?.amount || 0);
                  return (
                    <button
                      key={row.id}
                      type="button"
                      onClick={() => setSelectedId(row.id)}
                      className="w-full rounded-2xl border border-slate-700 bg-slate-900 p-4 text-left text-white"
                    >
                      <p className="font-semibold">{row.name}</p>
                      <p className="mt-0.5 text-xs text-slate-400">{row.class || 'No class'}</p>
                      <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                        <div>
                          <p className="text-[10px] uppercase tracking-wide text-slate-400">Paid</p>
                          <p className="mt-1 font-semibold text-emerald-300">{formatGhs(paidAmount)}</p>
                        </div>
                        <div>
                          <p className="text-[10px] uppercase tracking-wide text-slate-400">Outstanding</p>
                          <p className={`mt-1 font-semibold ${outstanding >= 0.01 ? 'text-amber-300' : 'text-emerald-300'}`}>
                            {outstanding >= 0.01 ? formatGhs(outstanding) : 'None'}
                          </p>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
              <div className="hidden overflow-x-auto rounded-3xl border border-slate-700 md:block">
                <table className="w-full min-w-[880px] text-left text-sm">
                  <thead className="bg-slate-800 text-slate-300">
                    <tr>
                      <th className="px-4 py-3">Student</th>
                      <th className="px-4 py-3">Class</th>
                      <th className="px-4 py-3">Fee</th>
                      <th className="px-4 py-3">Paid</th>
                      <th className="px-4 py-3">Outstanding</th>
                      <th className="px-4 py-3">Recorded by</th>
                      {tab === 'paid' ? <th className="px-4 py-3">Channel</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((row) => {
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
                          <td className="px-4 py-3 text-emerald-300">
                            {formatGhs(row.paid_amount || row.payment?.amount || 0)}
                          </td>
                          <td className={`px-4 py-3 font-medium ${outstanding >= 0.01 ? 'text-amber-300' : 'text-emerald-300'}`}>
                            {outstanding >= 0.01 ? formatGhs(outstanding) : 'None'}
                          </td>
                          <td className="px-4 py-3 text-slate-300">{row.recorded_by || '—'}</td>
                          {tab === 'paid' ? (
                            <td className="px-4 py-3">
                              <span className="capitalize">
                                {row.payment?.channel || row.payment?.payment_method || 'Paystack'}
                              </span>
                            </td>
                          ) : null}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <PaginationBar
                page={data?.page || page}
                total={data?.total || 0}
                limit={LIST_PAGE_SIZE}
                onPageChange={setPage}
              />
            </>
          )}
        </div>
      )}

      {showReminderModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6">
          <div className="w-full max-w-2xl rounded-3xl bg-slate-900 p-8 shadow-2xl">
            <h2 className="text-2xl font-semibold text-white">Fee reminder</h2>
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
                {sending ? 'Sending...' : smsQuote ? 'Confirm SMS' : 'Check cost'}
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
      ) : null}

      {showManual ? (
        <RecordFeePaymentModal
          students={data?.students || []}
          month={data?.month}
          onClose={() => setShowManual(false)}
          onSaved={() => {
            notifySchoolDataChanged(FINANCE_PREFIXES);
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
            notifySchoolDataChanged(FINANCE_PREFIXES);
          }}
        />
      ) : null}
    </div>
  );
};

export default Fees;
