import React, { useCallback, useMemo, useState } from 'react';
import axios from 'axios';
import {
  Activity,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  DollarSign,
  Gauge,
  LogIn,
  MessageSquare,
  MousePointerClick,
  UserPlus,
  Users,
} from 'lucide-react';
import toast from 'react-hot-toast';
import PerformanceChart, { percentChange } from '../components/PerformanceChart';
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
  new Intl.NumberFormat('en-GH', { style: 'currency', currency: 'GHS', maximumFractionDigits: 2 }).format(
    amount || 0
  );

const relativeTime = (iso) => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const delta = Date.now() - date.getTime();
  const minutes = Math.max(0, Math.round(delta / 60000));
  if (minutes < 1) return 'just now';
  if (minutes === 1) return '1 min ago';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
};

const StatCard = ({ title, value, subtitle, icon: Icon, color }) => (
  <div className="rounded-2xl border border-white/10 bg-zinc-900/70 p-5">
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="text-sm text-zinc-400">{title}</p>
        <p className="mt-1 text-2xl font-bold text-white">{value}</p>
        {subtitle ? <p className="mt-1 text-xs text-zinc-500">{subtitle}</p> : null}
      </div>
      <div className={`${color} shrink-0 rounded-full p-3`}>
        <Icon className="h-5 w-5 text-white" />
      </div>
    </div>
  </div>
);

const EmptyRow = ({ text }) => <p className="px-1 py-6 text-center text-sm text-zinc-500">{text}</p>;

const COLLAPSED_LOGS = 8;

const formatTime = (iso) => {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
};

const visibleLogs = (list, expanded) => (expanded ? list : list.slice(0, COLLAPSED_LOGS));

const ShowMoreBar = ({ total, expanded, onToggle }) => {
  if (total <= COLLAPSED_LOGS) return null;
  return (
    <button
      type="button"
      onClick={onToggle}
      className="mt-3 text-xs font-semibold text-sky-300 transition hover:text-sky-200"
    >
      {expanded ? 'Show less' : `Show more · ${total - COLLAPSED_LOGS} more logs`}
    </button>
  );
};

const DetailLine = ({ label, value }) => {
  if (value == null || value === '') return null;
  return (
    <p className="text-sm leading-relaxed text-zinc-300">
      <span className="text-zinc-500">{label}: </span>
      {value}
    </p>
  );
};

const ExpandableLog = ({ title, hint, time, children }) => {
  const [open, setOpen] = useState(false);
  return (
    <li className="py-0.5">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-start justify-between gap-3 py-2 text-left"
      >
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-white">{title}</span>
          {!open && hint ? <span className="mt-0.5 block truncate text-xs text-zinc-500">{hint}</span> : null}
        </span>
        <span className="flex shrink-0 items-center gap-2 pt-0.5">
          <span className="text-xs text-zinc-500">{time}</span>
          {open ? (
            <ChevronUp className="h-4 w-4 text-zinc-400" />
          ) : (
            <ChevronDown className="h-4 w-4 text-zinc-400" />
          )}
        </span>
      </button>
      {open ? (
        <div className="mb-2 space-y-1 rounded-xl border border-white/10 bg-zinc-950/70 px-3 py-3">{children}</div>
      ) : null}
    </li>
  );
};

const SuperAdminAnalytics = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedPanel, setSelectedPanel] = useState('pages');
  const [range, setRange] = useState('1w');
  const [showAll, setShowAll] = useState({});

  const toggleShowAll = (panelId) => {
    setShowAll((prev) => ({ ...prev, [panelId]: !prev[panelId] }));
  };

  const fetchData = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setRefreshing(true);
    try {
      const { data: payload } = await axios.get('/api/super-admin/analytics', { params: { range } });
      setData(payload);
    } catch (error) {
      if (!silent) {
        toast.error(error.response?.data?.error || 'Failed to load analytics');
      }
    } finally {
      if (!silent) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [range]);

  useLivePoll(() => fetchData({ silent: true }), 20000, true);

  React.useEffect(() => {
    fetchData({ silent: false });
  }, [fetchData]);

  const activeUsers = data?.activeUsers || [];
  const loginsBySchool = data?.loginsBySchool || [];
  const topPages = data?.topPages || [];
  const slowPages = data?.slowPages || [];
  const errors = data?.errors || {};
  const keyEvents = data?.keyEvents || [];
  const newUsers = data?.newUsers || [];
  const stats = data?.dataStats || {};
  const counts = data?.eventCounts || {};
  const chart = data?.chart || {};
  const rangeLabel = RANGE_LABELS[range] || RANGE_LABELS['1w'];

  const panels = useMemo(
    () => [
      {
        id: 'pages',
        title: 'Pages most visited',
        value: counts.pageViewsInRange ?? counts.pageViewsThisWeek ?? 0,
        subtitle: `${counts.pageViewsToday || 0} today`,
        icon: MousePointerClick,
        unit: 'views',
        formatValue: (value) => `${Number(value || 0).toLocaleString()} views`,
      },
      {
        id: 'slow',
        title: 'Slow pages',
        value: slowPages.reduce((sum, row) => sum + (Number(row.count) || 0), 0) || slowPages.length,
        subtitle: `Slower than ${data?.slowPageMs || 3000} ms`,
        icon: Gauge,
        unit: 'slow loads',
        formatValue: (value) => `${Number(value || 0).toLocaleString()} slow loads`,
      },
      {
        id: 'events',
        title: 'Key events',
        value: counts.keyEventsInRange ?? keyEvents.length,
        subtitle: 'Logins, signups, payments',
        icon: Activity,
        unit: 'events',
        formatValue: (value) => `${Number(value || 0).toLocaleString()} events`,
      },
      {
        id: 'newUsers',
        title: 'New users',
        value: newUsers.length,
        subtitle: `Schools that joined ${rangeLabel}`,
        icon: UserPlus,
        unit: 'schools',
        formatValue: (value) => `${Number(value || 0).toLocaleString()} schools`,
      },
      {
        id: 'active',
        title: 'Active users',
        value: activeUsers.length,
        subtitle: `Seen in the last ${data?.activeWindowMinutes || 5} minutes`,
        icon: Users,
        unit: 'users',
        formatValue: (value) => `${Number(value || 0).toLocaleString()} users`,
      },
      {
        id: 'logins',
        title: 'Daily / weekly login',
        value: counts.loginsInRange ?? counts.loginsToday ?? 0,
        subtitle: `${counts.loginsToday || 0} today · ${counts.loginsThisWeek || 0} this week`,
        icon: LogIn,
        unit: 'logins',
        formatValue: (value) => `${Number(value || 0).toLocaleString()} logins`,
      },
      {
        id: 'errors',
        title: 'Failed logins & payments',
        value: counts.errorsInRange ?? (errors.recent || []).length,
        subtitle: `${errors.failedLoginsToday || 0} failed logins today · ${errors.failedPaymentsToday || 0} failed payments today`,
        icon: AlertTriangle,
        unit: 'errors',
        formatValue: (value) => `${Number(value || 0).toLocaleString()} errors`,
      },
      {
        id: 'fees',
        title: 'Fees paid',
        value: stats.feesPaidInRange || 0,
        subtitle: `${formatMoney(stats.feesCollectedToday)} collected today`,
        icon: DollarSign,
        unit: 'GHS',
        formatValue: (value) => formatMoney(value),
      },
    ],
    [
      activeUsers.length,
      counts.errorsInRange,
      counts.keyEventsInRange,
      counts.loginsInRange,
      counts.loginsThisWeek,
      counts.loginsToday,
      counts.pageViewsInRange,
      counts.pageViewsThisWeek,
      counts.pageViewsToday,
      data?.activeWindowMinutes,
      data?.slowPageMs,
      errors.failedLoginsToday,
      errors.failedPaymentsToday,
      errors.recent,
      stats.feesCollectedToday,
      stats.feesPaidInRange,
      keyEvents.length,
      newUsers.length,
      rangeLabel,
      slowPages,
    ]
  );

  const selected = panels.find((panel) => panel.id === selectedPanel) || panels[0];
  const series = chart.series?.[selected.id] || [];
  const latest = series[series.length - 1]?.value ?? 0;
  const previous = series.length > 1 ? series[0]?.value : null;
  const change = percentChange(latest, previous);

  if (loading && !data) {
    return (
      <div className="flex h-64 items-center justify-center text-slate-300">Loading platform analytics...</div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-white">Platform analytics</h1>
        {data?.tableReady === false && (
          <p className="mt-2 text-xs text-amber-300">
            Event table is not in the database yet. Run <code>database/migrations.sql</code> in Supabase so history is stored.
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          title="Total students"
          value={stats.totalStudents || 0}
          subtitle="Across all schools"
          icon={Users}
          color="bg-indigo-500"
        />
        <StatCard
          title="Fees paid"
          value={formatMoney(stats.feesPaidInRange ?? stats.feesCollectedToday)}
          subtitle={`${formatMoney(stats.feesCollectedToday)} collected today`}
          icon={DollarSign}
          color="bg-emerald-600"
        />
        <StatCard
          title="SMS sent today"
          value={stats.smsSentToday || 0}
          subtitle="Messages delivered today"
          icon={MessageSquare}
          color="bg-amber-500"
        />
      </div>

      <div className="flex flex-wrap gap-1.5">
        {panels.map((panel) => {
          const Icon = panel.icon;
          const active = selectedPanel === panel.id;
          return (
            <button
              key={panel.id}
              type="button"
              onClick={() => setSelectedPanel(panel.id)}
              aria-pressed={active}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition ${
                active
                  ? 'border-transparent bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white shadow-lg shadow-fuchsia-500/20'
                  : 'border-white/10 bg-zinc-900/70 text-zinc-300 hover:border-white/20 hover:text-white'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {panel.title}
            </button>
          );
        })}
      </div>

      <section className="relative overflow-hidden rounded-3xl border border-white/10 bg-[#141416] p-5 shadow-[0_0_80px_rgba(52,152,219,0.08)] md:p-8">
        <div className="chart-animated-bg pointer-events-none absolute inset-0 opacity-60" />
        <div className="relative z-10">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold tracking-tight text-white md:text-2xl">{selected.title}</h2>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-zinc-400">
              <span className="text-lg font-semibold text-white">{selected.formatValue(latest)}</span>
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
          <div className="flex shrink-0 items-center gap-1.5 self-start rounded-full border border-white/10 bg-zinc-950/70 p-1">
            {RANGES.map((item) => {
              const active = range === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setRange(item.id)}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                    active
                      ? 'bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className={`mt-6 ${refreshing ? 'opacity-60' : ''}`}>
          <PerformanceChart points={series} unit={chart.unit || 'day'} formatValue={selected.formatValue} />
        </div>

        <div className="mt-6 border-t border-white/10 pt-5">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">{selected.subtitle}</p>

          {selectedPanel === 'active' &&
            (activeUsers.length === 0 ? (
              <EmptyRow text="Nobody is active right now." />
            ) : (
              <>
                <ul className="divide-y divide-white/5">
                  {visibleLogs(activeUsers, showAll.active).map((user) => (
                    <ExpandableLog
                      key={`${user.schoolId || ''}-${user.email || user.lastSeen}`}
                      title={user.schoolName || 'Unknown school'}
                      hint={user.email || 'No email'}
                      time={relativeTime(user.lastSeen)}
                    >
                      <DetailLine label="Email" value={user.email || 'No email'} />
                      <DetailLine
                        label="Role"
                        value={user.role === 'super_admin' ? 'Platform admin' : user.role || 'admin'}
                      />
                      <DetailLine label="Last page" value={user.page || user.path || '—'} />
                      <DetailLine label="Last seen" value={formatTime(user.lastSeen)} />
                    </ExpandableLog>
                  ))}
                </ul>
                <ShowMoreBar total={activeUsers.length} expanded={Boolean(showAll.active)} onToggle={() => toggleShowAll('active')} />
              </>
            ))}

          {selectedPanel === 'logins' &&
            (loginsBySchool.length === 0 ? (
              <EmptyRow text="No school logins recorded yet this week." />
            ) : (
              <>
                <ul className="divide-y divide-white/5">
                  {visibleLogs(loginsBySchool, showAll.logins).map((row) => (
                    <ExpandableLog
                      key={row.schoolId || row.email}
                      title={row.schoolName}
                      hint={`${row.daily} today · ${row.weekly} this week`}
                      time=""
                    >
                      <DetailLine label="Email" value={row.email} />
                      <DetailLine label="Logins today" value={row.daily} />
                      <DetailLine label="Logins this week" value={row.weekly} />
                    </ExpandableLog>
                  ))}
                </ul>
                <ShowMoreBar total={loginsBySchool.length} expanded={Boolean(showAll.logins)} onToggle={() => toggleShowAll('logins')} />
              </>
            ))}

          {selectedPanel === 'pages' &&
            (topPages.length === 0 ? (
              <EmptyRow text="No page visits recorded in this range." />
            ) : (
              <>
                <ul className="divide-y divide-white/5">
                  {visibleLogs(topPages, showAll.pages).map((row) => {
                    const max = topPages[0]?.count || 1;
                    return (
                      <ExpandableLog
                        key={row.page}
                        title={row.page}
                        hint={`${row.count} views`}
                        time=""
                      >
                        <DetailLine label="Page" value={row.page} />
                        <DetailLine label="Path" value={row.path} />
                        <DetailLine label="Views in range" value={row.count} />
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-800">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500"
                            style={{ width: `${Math.max(8, Math.round((row.count / max) * 100))}%` }}
                          />
                        </div>
                      </ExpandableLog>
                    );
                  })}
                </ul>
                <ShowMoreBar total={topPages.length} expanded={Boolean(showAll.pages)} onToggle={() => toggleShowAll('pages')} />
              </>
            ))}

          {selectedPanel === 'slow' &&
            (slowPages.length === 0 ? (
              <EmptyRow text="No slow pages in this range." />
            ) : (
              <>
                <ul className="divide-y divide-white/5">
                  {visibleLogs(slowPages, showAll.slow).map((row) => (
                    <ExpandableLog
                      key={row.page}
                      title={row.page}
                      hint={`${row.count} slow load${row.count === 1 ? '' : 's'}`}
                      time={`${(row.avgMs / 1000).toFixed(1)}s avg`}
                    >
                      <DetailLine label="Page" value={row.page} />
                      <DetailLine label="Path" value={row.path} />
                      <DetailLine label="Slow loads" value={row.count} />
                      <DetailLine label="Average time" value={`${(row.avgMs / 1000).toFixed(1)} seconds`} />
                      <DetailLine
                        label="Why"
                        value={`This page took longer than ${data?.slowPageMs || 3000} ms to load.`}
                      />
                    </ExpandableLog>
                  ))}
                </ul>
                <ShowMoreBar total={slowPages.length} expanded={Boolean(showAll.slow)} onToggle={() => toggleShowAll('slow')} />
              </>
            ))}

          {selectedPanel === 'events' &&
            (keyEvents.length === 0 ? (
              <EmptyRow text="No key events yet." />
            ) : (
              <>
                <ul className="divide-y divide-white/5">
                  {visibleLogs(keyEvents, showAll.events).map((event) => (
                    <ExpandableLog
                      key={event.id}
                      title={event.label}
                      hint={event.schoolName || event.email || 'Unknown'}
                      time={relativeTime(event.createdAt)}
                    >
                      <DetailLine label="What happened" value={event.description || event.label} />
                      <DetailLine label="Why" value={event.message && event.message !== event.description ? event.message : event.reason} />
                      <DetailLine label="School" value={event.schoolName} />
                      <DetailLine label="Email" value={event.email} />
                      <DetailLine label="Student" value={event.studentName} />
                      <DetailLine label="Student ID" value={event.studentCode} />
                      <DetailLine label="Page" value={event.page || event.path} />
                      <DetailLine label="Source" value={event.source} />
                      <DetailLine
                        label="Load time"
                        value={event.durationMs ? `${Math.round(event.durationMs)} ms` : null}
                      />
                      <DetailLine label="When" value={formatTime(event.createdAt)} />
                    </ExpandableLog>
                  ))}
                </ul>
                <ShowMoreBar total={keyEvents.length} expanded={Boolean(showAll.events)} onToggle={() => toggleShowAll('events')} />
              </>
            ))}

          {selectedPanel === 'newUsers' &&
            (newUsers.length === 0 ? (
              <EmptyRow text="No new schools in this range." />
            ) : (
              <>
                <ul className="divide-y divide-white/5">
                  {visibleLogs(newUsers, showAll.newUsers).map((user) => (
                    <ExpandableLog
                      key={user.schoolId || user.email}
                      title={user.schoolName || 'New school'}
                      hint={user.email}
                      time={relativeTime(user.createdAt)}
                    >
                      <DetailLine label="School" value={user.schoolName || 'New school'} />
                      <DetailLine label="Email" value={user.email} />
                      <DetailLine label="Joined" value={formatTime(user.createdAt)} />
                      <DetailLine label="Source" value={user.source === 'signup' ? 'Signup event' : 'School record'} />
                    </ExpandableLog>
                  ))}
                </ul>
                <ShowMoreBar total={newUsers.length} expanded={Boolean(showAll.newUsers)} onToggle={() => toggleShowAll('newUsers')} />
              </>
            ))}

          {selectedPanel === 'errors' &&
            ((errors.recent || []).length === 0 ? (
              <EmptyRow text="No failed logins or payments in this range." />
            ) : (
              <>
                <ul className="divide-y divide-white/5">
                  {visibleLogs(errors.recent || [], showAll.errors).map((event) => (
                    <ExpandableLog
                      key={event.id}
                      title={event.label}
                      hint={event.description || event.schoolName || event.email || 'Attempt failed'}
                      time={relativeTime(event.createdAt)}
                    >
                      <DetailLine label="Why it failed" value={event.description || 'Attempt failed'} />
                      <DetailLine
                        label="System reason"
                        value={event.reason ? String(event.reason).replaceAll('_', ' ') : null}
                      />
                      <DetailLine label="Provider message" value={event.message && event.message !== event.description ? event.message : null} />
                      <DetailLine
                        label="School"
                        value={
                          event.type === 'payment_failed'
                            ? event.schoolName || 'School not identified'
                            : event.schoolName
                        }
                      />
                      <DetailLine label="Email" value={event.email} />
                      <DetailLine label="Student" value={event.studentName} />
                      <DetailLine label="Student ID" value={event.studentCode} />
                      <DetailLine label="Source" value={event.source} />
                      <DetailLine label="When" value={formatTime(event.createdAt)} />
                    </ExpandableLog>
                  ))}
                </ul>
                <ShowMoreBar
                  total={(errors.recent || []).length}
                  expanded={Boolean(showAll.errors)}
                  onToggle={() => toggleShowAll('errors')}
                />
              </>
            ))}

          {selectedPanel === 'fees' &&
            ((data?.feesPreview || []).length === 0 ? (
              <EmptyRow text="No fees paid in this range." />
            ) : (
              <>
                <ul className="divide-y divide-white/5">
                  {visibleLogs(data.feesPreview || [], showAll.fees).map((row) => (
                    <ExpandableLog
                      key={row.id}
                      title={row.payerName}
                      hint={formatMoney(row.amount)}
                      time={relativeTime(row.createdAt)}
                    >
                      <DetailLine label="Payer" value={row.payerName} />
                      <DetailLine label="Amount" value={formatMoney(row.amount)} />
                      <DetailLine label="Method" value={row.method || 'Payment'} />
                      <DetailLine label="When" value={formatTime(row.createdAt)} />
                    </ExpandableLog>
                  ))}
                </ul>
                <ShowMoreBar
                  total={(data.feesPreview || []).length}
                  expanded={Boolean(showAll.fees)}
                  onToggle={() => toggleShowAll('fees')}
                />
              </>
            ))}
        </div>
        </div>
      </section>
    </div>
  );
};

export default SuperAdminAnalytics;
