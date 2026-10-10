import React, { useCallback, useMemo, useState } from 'react';
import axios from 'axios';
import {
  CalendarCheck,
  CreditCard,
  DollarSign,
  MessageSquare,
  Receipt,
  ShieldAlert,
  UserCheck,
} from 'lucide-react';
import PerformanceChart, { percentChange } from './PerformanceChart';
import { useLivePoll } from '../hooks/useLivePoll';

const RANGES = [
  { id: '1d', label: '1D' },
  { id: '1w', label: '1W' },
  { id: '1m', label: '1M' },
  { id: '6m', label: '6M' },
  { id: '1y', label: '1Y' },
];

const RANGE_LABELS = {
  '1d': 'last 24 hours',
  '1w': 'this week',
  '1m': 'last 30 days',
  '6m': 'last 6 months',
  '1y': 'last 12 months',
};

const formatMoney = (amount) =>
  new Intl.NumberFormat('en-GH', { style: 'currency', currency: 'GHS', maximumFractionDigits: 2 }).format(amount || 0);

const formatTime = (iso) => {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso);
  return date.toLocaleString();
};

const SchoolAnalyticsChart = () => {
  const [data, setData] = useState(null);
  const [range, setRange] = useState('1w');
  const [selectedPanel, setSelectedPanel] = useState('attendance');
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(
    async ({ silent = false } = {}) => {
      try {
        const { data: payload } = await axios.get('/api/dashboard/analytics', { params: { range } });
        setData(payload);
      } catch {
        if (!silent) setData(null);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [range]
  );

  React.useEffect(() => {
    setLoading(true);
    fetchData({ silent: false });
  }, [fetchData]);

  useLivePoll(() => fetchData({ silent: true }), 60000, !loading);

  const totals = data?.totals || {};
  const previews = data?.previews || {};
  const rangeLabel = RANGE_LABELS[range] || RANGE_LABELS['1w'];

  const panels = useMemo(
    () => [
      {
        id: 'attendance',
        title: 'Attendance',
        value: totals.attendanceInRange || 0,
        icon: CalendarCheck,
        formatValue: (value) => `${Number(value || 0).toLocaleString()} marked`,
      },
      {
        id: 'feesPaid',
        title: 'Fees paid',
        value: totals.feesPaidInRange || 0,
        icon: DollarSign,
        formatValue: (value) => formatMoney(value),
      },
      {
        id: 'feesUnpaid',
        title: 'Unpaid fees',
        value: totals.feesUnpaidNow || 0,
        icon: Receipt,
        formatValue: (value) => formatMoney(value),
      },
      {
        id: 'feesFailed',
        title: 'Failed fee payments',
        value: totals.feesFailedInRange || 0,
        icon: CreditCard,
        formatValue: (value) => `${Number(value || 0).toLocaleString()} failed`,
      },
      {
        id: 'smsDelivered',
        title: 'SMS delivered',
        value: totals.smsDeliveredInRange || 0,
        icon: MessageSquare,
        formatValue: (value) => `${Number(value || 0).toLocaleString()} delivered`,
      },
      {
        id: 'smsFailed',
        title: 'SMS failed',
        value: totals.smsFailedInRange || 0,
        icon: MessageSquare,
        formatValue: (value) => `${Number(value || 0).toLocaleString()} failed`,
      },
      {
        id: 'failedLogin',
        title: 'Failed login',
        value: totals.failedLoginInRange || 0,
        icon: ShieldAlert,
        formatValue: (value) => `${Number(value || 0).toLocaleString()} failed`,
      },
      {
        id: 'activeStaff',
        title: 'Active Staff login',
        value: totals.activeStaffInRange || 0,
        icon: UserCheck,
        formatValue: (value) => `${Number(value || 0).toLocaleString()} Staff`,
      },
    ],
    [totals]
  );

  const selected = panels.find((panel) => panel.id === selectedPanel) || panels[0];
  const series = data?.chart?.series?.[selected.id] || [];
  const latest = series[series.length - 1]?.value ?? 0;
  const previous = series.length > 1 ? series[0]?.value : null;
  const change = percentChange(latest, previous);

  const preview = previews[selected.id] || [];

  return (
    <section className="relative overflow-hidden rounded-2xl border border-slate-700/80 bg-[#141416] p-3 shadow-[0_0_80px_rgba(52,152,219,0.08)] md:rounded-3xl md:p-7">
      <div className="chart-animated-bg pointer-events-none absolute inset-0 opacity-50" />
      <div className="relative z-10">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-4">
          <div className="min-w-0">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400 md:text-xs">
              School performance
            </h2>
            <p className="mt-1.5 text-lg font-semibold text-white md:mt-2 md:text-2xl">{selected.title}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-400 md:mt-2 md:gap-2 md:text-sm">
              <span className="text-base font-semibold text-white md:text-lg">{selected.formatValue(latest)}</span>
              {change != null ? (
                <span
                  className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${
                    change >= 0 ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300'
                  }`}
                >
                  {change >= 0 ? '+' : ''}
                  {change}%
                </span>
              ) : null}
              <span>· {rangeLabel}</span>
            </div>
          </div>
          <div className="grid w-full grid-cols-5 gap-1 rounded-xl border border-white/10 bg-zinc-950/70 p-1 md:flex md:w-auto md:shrink-0 md:items-center md:gap-1.5 md:self-start md:rounded-full">
            {RANGES.map((item) => {
              const active = range === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setRange(item.id)}
                  className={`min-h-8 rounded-lg px-1.5 text-[11px] font-semibold transition md:min-h-0 md:rounded-full md:px-3 md:py-1.5 md:text-xs ${
                    active
                      ? 'bg-gradient-to-r from-sky-500 to-violet-500 text-white'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-1.5 md:mt-5 md:flex md:flex-wrap">
          {panels.map((panel) => {
            const Icon = panel.icon;
            const active = selectedPanel === panel.id;
            return (
              <button
                key={panel.id}
                type="button"
                onClick={() => setSelectedPanel(panel.id)}
                className={`inline-flex min-h-9 items-center justify-center gap-1 rounded-lg border px-2 py-1.5 text-left text-[11px] font-medium leading-tight transition md:min-h-0 md:justify-start md:rounded-full md:px-2.5 md:py-1 md:text-xs ${
                  active
                    ? 'border-transparent bg-gradient-to-r from-sky-500 to-violet-500 text-white'
                    : 'border-white/10 bg-zinc-900/70 text-zinc-300 hover:text-white'
                }`}
              >
                <Icon className="hidden h-3.5 w-3.5 shrink-0 md:block" />
                <span className="truncate">{panel.title}</span>
              </button>
            );
          })}
        </div>

        <div className="mt-4 md:mt-6">
          {loading && !data ? (
            <p className="py-16 text-center text-sm text-slate-400">Loading school chart…</p>
          ) : (
            <PerformanceChart points={series} unit={data?.chart?.unit || 'day'} formatValue={selected.formatValue} />
          )}
        </div>

        <div className="mt-4 border-t border-white/10 pt-4 md:mt-6 md:pt-5">
          {preview.length === 0 ? (
            <p className="py-4 text-center text-sm text-zinc-500">
              No {selected.title.toLowerCase()} records in this range.
            </p>
          ) : (
            <ul className="divide-y divide-white/5">
              {preview.map((row) => (
                <li key={row.id} className="flex items-start justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-white">{row.title || row.name || 'Record'}</p>
                    <p className="text-sm text-amber-200/90">{row.description || '—'}</p>
                  </div>
                  <span className="shrink-0 text-xs text-zinc-500">{formatTime(row.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
};

export default SchoolAnalyticsChart;
