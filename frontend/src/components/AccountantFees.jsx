import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';
import { ChevronRight, FileSpreadsheet, Plus, RefreshCw } from 'lucide-react';
import RecordFeePaymentModal from './RecordFeePaymentModal';
import FeePaymentReceiptModal from './FeePaymentReceiptModal';
import { formatGhs } from '../utils/feeReceiptPdf';
import { downloadTableXlsx } from '../utils/tableXlsx';
import { useAuth } from '../contexts/authcontext';
import {
  forceGet,
  notifySchoolDataChanged,
  onSchoolDataChanged,
  peekCache,
  rememberSession,
  sessionGet,
} from '../utils/requestCache';
import { useLivePoll } from '../hooks/useLivePoll';

const STAFF_FEES_KEY = 'fees:staff-overview';
const STAFF_FEES_VIEW_KEY = 'view:fees-accountant';

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

const parseTermDate = (value) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || '').trim());
  if (!match) return null;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
};

const formatTermDay = (value, { withYear = true } = {}) => {
  const date = parseTermDate(value);
  if (!date) return '';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
    year: withYear ? 'numeric' : undefined,
  }).format(date);
};

const formatTermRange = (startsOn, endsOn) => {
  const start = parseTermDate(startsOn);
  const end = parseTermDate(endsOn);
  if (!start && !end) return '';
  if (start && end) {
    const sameYear = start.getUTCFullYear() === end.getUTCFullYear();
    return `${formatTermDay(startsOn, { withYear: !sameYear })} – ${formatTermDay(endsOn)}`;
  }
  return formatTermDay(startsOn) || formatTermDay(endsOn);
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

const niceMax = (maxValue) => {
  const max = Number(maxValue) || 0;
  if (max <= 0) return 4;
  const padded = max * 1.15;
  const pow = 10 ** Math.floor(Math.log10(padded));
  const n = padded / pow;
  const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return nice * pow;
};

const formatAxis = (value) => {
  if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(value % 1_000_000 ? 1 : 0))}m`;
  if (value >= 1000) return `${Number((value / 1000).toFixed(value % 1000 ? 1 : 0))}k`;
  return String(Math.round(value));
};

const FeeClassChart = ({ rows }) => {
  const wrapRef = useRef(null);
  const [width, setWidth] = useState(720);
  const [hover, setHover] = useState(null);
  const height = 300;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const sync = () => setWidth(Math.max(el.clientWidth, 1));
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const layout = useMemo(() => {
    const pad = { l: 52, r: 16, t: 18, b: 58 };
    const minGroup = 86;
    const chartW = Math.max(width, rows.length * minGroup + pad.l + pad.r);
    const innerW = Math.max(1, chartW - pad.l - pad.r);
    const innerH = Math.max(1, height - pad.t - pad.b);
    const max = niceMax(
      Math.max(0, ...rows.flatMap((row) => [Number(row.paid_amount) || 0, Number(row.outstanding) || 0]))
    );
    const groupW = innerW / Math.max(rows.length, 1);
    const barW = Math.min(22, Math.max(8, groupW * 0.28));
    const gap = 5;
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((part) => {
      const value = max * (1 - part);
      return { value, y: pad.t + innerH * part, label: formatAxis(value) };
    });
    const groups = rows.map((row, index) => {
      const paid = Number(row.paid_amount) || 0;
      const due = Number(row.outstanding) || 0;
      const cx = pad.l + groupW * index + groupW / 2;
      return {
        key: row.className,
        className: row.className,
        students: row.students,
        paid,
        due,
        paidX: cx - gap / 2 - barW,
        dueX: cx + gap / 2,
        paidH: max ? (paid / max) * innerH : 0,
        dueH: max ? (due / max) * innerH : 0,
        baseY: pad.t + innerH,
        barW,
        cx,
      };
    });
    return { pad, chartW, innerH, ticks, groups };
  }, [rows, width]);

  if (!rows.length) {
    return (
      <div className="rounded-3xl border border-dashed border-slate-700 bg-slate-900/40 px-5 py-10 text-center text-sm text-slate-400">
        No class totals to chart yet.
      </div>
    );
  }

  const active = hover == null ? null : layout.groups[hover];

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
      <div ref={wrapRef} className="relative mt-4 overflow-x-auto">
        <svg
          width={layout.chartW}
          height={height}
          viewBox={`0 0 ${layout.chartW} ${height}`}
          className="block min-w-full"
          onMouseLeave={() => setHover(null)}
        >
          {layout.ticks.map((tick) => (
            <g key={tick.label}>
              <line
                x1={layout.pad.l}
                x2={layout.chartW - layout.pad.r}
                y1={tick.y}
                y2={tick.y}
                stroke="#334155"
                strokeDasharray="4 6"
              />
              <text x={layout.pad.l - 8} y={tick.y + 4} textAnchor="end" fill="#64748b" className="text-[11px]">
                {tick.label}
              </text>
            </g>
          ))}
          {layout.groups.map((group, index) => (
            <g key={group.key} onMouseEnter={() => setHover(index)}>
              <rect
                x={group.cx - group.barW - 8}
                y={layout.pad.t}
                width={group.barW * 2 + 16}
                height={layout.innerH}
                fill="transparent"
              />
              <rect
                x={group.paidX}
                y={group.baseY - group.paidH}
                width={group.barW}
                height={Math.max(group.paidH, 0)}
                rx="4"
                className="fill-emerald-400"
              />
              <rect
                x={group.dueX}
                y={group.baseY - group.dueH}
                width={group.barW}
                height={Math.max(group.dueH, 0)}
                rx="4"
                className="fill-amber-400"
              />
              <text x={group.cx} y={height - 18} textAnchor="middle" fill="#475569" className="text-[11px]">
                {String(group.className || '—').length > 10
                  ? `${String(group.className).slice(0, 9)}…`
                  : group.className}
              </text>
            </g>
          ))}
        </svg>
        {active ? (
          <div className="pointer-events-none absolute left-4 top-2 rounded-xl border border-slate-600 bg-slate-950/95 px-3 py-2 text-xs text-slate-200 shadow-lg">
            <p className="font-semibold text-white">{active.className}</p>
            <p className="mt-1 text-emerald-300">Collected {formatGhs(active.paid)}</p>
            <p className="text-amber-300">Outstanding {formatGhs(active.due)}</p>
            <p className="mt-1 text-slate-500">
              {active.students} student{active.students === 1 ? '' : 's'}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
};

const FeeOverviewPanel = ({
  termName,
  termRange,
  collectedTerm,
  unpaidAmount,
  billedAmount,
  collectedShare,
  owingCount,
  yearCollected,
  onOpenUnpaid,
}) => {
  const allClear = billedAmount >= 0.01 && unpaidAmount < 0.01;
  const stats = [
    { label: 'Collected', value: formatGhs(collectedTerm), tone: 'text-emerald-300' },
    { label: 'Owing', value: String(owingCount), action: true },
    { label: 'This year', value: formatGhs(yearCollected) },
  ];

  return (
    <section className="overflow-hidden rounded-3xl border border-slate-700 bg-slate-800">
      <header className="flex items-baseline justify-between gap-3 px-5 pt-5 md:px-6">
        <h3 className="text-base font-semibold text-white">{termName || 'This term'}</h3>
        {termRange ? <p className="text-sm text-slate-400">{termRange}</p> : null}
      </header>

      <div className="px-5 pt-5 md:px-6">
        <p className="text-4xl font-semibold tracking-tight text-white tabular-nums md:text-[2.75rem] md:leading-none">
          {formatGhs(allClear ? collectedTerm : unpaidAmount)}
        </p>
        <p className={`mt-2 text-sm font-medium ${allClear ? 'text-emerald-300' : 'text-amber-300'}`}>
          {allClear ? 'Collected this term' : 'Unpaid revenue'}
        </p>
        {billedAmount >= 0.01 ? (
          <div className="mt-4 max-w-md">
            <div className="h-1.5 overflow-hidden rounded-full bg-slate-700">
              <div className="h-full rounded-full bg-emerald-400" style={{ width: `${collectedShare}%` }} />
            </div>
            <p className="mt-2 text-xs text-slate-400">
              {Math.round(collectedShare)}% collected of {formatGhs(billedAmount)} billed
            </p>
          </div>
        ) : null}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-px bg-slate-700 sm:grid-cols-3">
        {stats.map((row) => {
          const body = (
            <>
              <span className="text-sm text-slate-400">{row.label}</span>
              <span className={`mt-1 block text-lg font-semibold tabular-nums ${row.tone || 'text-white'}`}>
                {row.value}
              </span>
            </>
          );
          if (row.action) {
            return (
              <button
                key={row.label}
                type="button"
                onClick={onOpenUnpaid}
                className="flex items-center justify-between bg-slate-800 px-5 py-4 text-left hover:bg-slate-700"
              >
                <span>{body}</span>
                <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
              </button>
            );
          }
          return (
            <div key={row.label} className="bg-slate-800 px-5 py-4">
              {body}
            </div>
          );
        })}
      </div>
    </section>
  );
};

const AccountantFees = ({
  schoolName,
  authHeaders,
  readOnly = false,
  reminderOpen,
  onReminderOpenChange,
  hideReminderButton = false,
  section = 'overview',
  onOpenList,
}) => {
  const { canDownload } = useAuth();
  const requestConfig = useMemo(() => ({ headers: authHeaders }), [authHeaders]);
  const savedView = peekCache(STAFF_FEES_VIEW_KEY) || {};
  const cachedFees = peekCache(STAFF_FEES_KEY);
  const [data, setData] = useState(cachedFees || null);
  const [loading, setLoading] = useState(!cachedFees);
  const [tab, setTab] = useState(savedView.tab || 'unpaid');
  const [classFilter, setClassFilter] = useState(savedView.classFilter || '');
  const [showManual, setShowManual] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [showReminder, setShowReminder] = useState(false);
  const [reminderMessage, setReminderMessage] = useState(
    'Dear Parent, please settle outstanding school fees this term. Pay here: {pay_link} You can pay with MoMo, bank transfer, or USSD.'
  );
  const [smsQuote, setSmsQuote] = useState(null);
  const [sending, setSending] = useState(false);
  const [exporting, setExporting] = useState('');
  const shownRef = useRef(Boolean(cachedFees));

  const load = useCallback(async ({ fresh = false, spin = false } = {}) => {
    if (!fresh) {
      const hit = peekCache(STAFF_FEES_KEY);
      if (hit) {
        setData(hit);
        shownRef.current = true;
        setLoading(false);
        return;
      }
    }
    if (spin || (!peekCache(STAFF_FEES_KEY) && !shownRef.current)) setLoading(true);
    try {
      const payload = await (fresh ? forceGet : sessionGet)(STAFF_FEES_KEY, () =>
        axios.get('/api/staff-portal/session/fees/overview', requestConfig).then((response) => response.data)
      );
      setData(payload);
      shownRef.current = true;
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to load fees');
      throw err;
    } finally {
      setLoading(false);
    }
  }, [requestConfig]);

  useEffect(() => {
    const hasCache = Boolean(peekCache(STAFF_FEES_KEY));
    load(hasCache ? { fresh: true } : {}).catch(() => {});
  }, [load]);

  useEffect(() => {
    return onSchoolDataChanged((prefixes) => {
      if (prefixes.includes('visible')) return;
      if (prefixes.some((prefix) => !prefix || prefix === 'fees' || prefix === 'dashboard' || prefix === 'wallet')) {
        load({ fresh: true }).catch(() => {});
      }
    });
  }, [load]);

  useLivePoll(() => load({ fresh: true }), 45000, !loading);

  useEffect(() => {
    rememberSession(STAFF_FEES_VIEW_KEY, { tab, classFilter });
  }, [tab, classFilter]);

  useEffect(() => {
    if (reminderOpen) {
      setSmsQuote(null);
      setShowReminder(true);
    }
  }, [reminderOpen]);

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
  const collectedTerm = Number(totals.paid_amount) || 0;
  const unpaidAmount = Number(totals.unpaid_amount) || 0;
  const billedAmount = Number.isFinite(Number(totals.billed_amount))
    ? Number(totals.billed_amount)
    : collectedTerm + unpaidAmount;
  const collectedShare = billedAmount > 0 ? Math.min(100, (collectedTerm / billedAmount) * 100) : 0;
  const owingCount = Number(totals.unpaid) || 0;
  const yearCollected = Number(totals.year_collected) || 0;
  const rows = tab === 'paid' ? paid : unpaid;
  const selected = (data?.students || []).find((row) => row.id === selectedId) || null;
  const periodLabel = data?.period_label || data?.term_name || data?.month;
  const termName = data?.term_name || data?.month || 'This term';
  const termRange = formatTermRange(data?.term_starts_on, data?.term_ends_on);

  const exportTerm = async () => {
    if (!canDownload) {
      toast.error('Downloads are locked until the term plan is renewed.');
      return;
    }
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
    if (!canDownload) {
      toast.error('Downloads are locked until the term plan is renewed.');
      return;
    }
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

  const showList = section === 'list';

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="page-title">{showList ? 'Paid and unpaid' : 'Fees'}</h2>
        <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap sm:overflow-x-auto">
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
              load({ fresh: true, spin: true }).catch(() => {});
            }}
            disabled={loading}
            className="inline-flex h-10 shrink-0 items-center gap-2 rounded-lg border border-slate-600 px-3 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-70"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          {readOnly || showList ? null : (
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

      {showList ? null : (
        <FeeOverviewPanel
          termName={termName}
          termRange={termRange}
          collectedTerm={collectedTerm}
          unpaidAmount={unpaidAmount}
          billedAmount={billedAmount}
          collectedShare={collectedShare}
          owingCount={owingCount}
          yearCollected={yearCollected}
          onOpenUnpaid={() => {
            setTab('unpaid');
            onOpenList?.();
          }}
        />
      )}

      {showList ? null : <FeeClassChart rows={chartRows} />}

      {showList ? (
      <>
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
            disabled={Boolean(exporting) || !canDownload}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-50"
          >
            <FileSpreadsheet className="h-4 w-4" />
            {exporting === 'term' ? 'Exporting…' : 'Excel · this term'}
          </button>
          <button
            type="button"
            onClick={exportYear}
            disabled={Boolean(exporting) || !canDownload}
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
          <table className="w-full min-w-[760px] text-left text-sm">
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
                    {tab === 'paid' ? (
                      <td className="px-4 py-3 capitalize">
                        {row.payment?.channel || row.payment?.payment_method || 'Paystack'}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      </>
      ) : null}

      {showManual && !readOnly ? (
        <RecordFeePaymentModal
          students={data?.students || []}
          month={data?.month}
          requestConfig={requestConfig}
          submitUrl="/api/staff-portal/session/fees/manual"
          momoCheckoutUrl="/api/staff-portal/session/fees/checkout"
          onClose={() => setShowManual(false)}
          onSaved={() => {
            notifySchoolDataChanged(['fees', 'dashboard', 'wallet']);
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
            notifySchoolDataChanged(['fees', 'dashboard', 'wallet']);
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
