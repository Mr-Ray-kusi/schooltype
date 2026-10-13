import React, { useState, useEffect, useCallback } from 'react';
import PlanPendingBanner from '../components/PlanPendingBanner';
import SubscriptionBanner from '../components/SubscriptionBanner';
import axios from 'axios';
import { useAuth } from '../contexts/authcontext';
import { DASHBOARD_CACHE_MS, cachedGet, peekCache } from '../utils/requestCache';
import { schoolLocalDate, schoolLocalDateLabel } from '../utils/schoolDate';
import { useLivePoll } from '../hooks/useLivePoll';
import SchoolAnalyticsChart from '../components/SchoolAnalyticsChart';
import {
  Users,
  UserCog,
  Briefcase,
  MessageSquare,
  Lock,
  Wallet,
  BookOpen,
  CalendarCheck,
  FileText,
  DollarSign,
  Receipt,
  Landmark,
} from 'lucide-react';

const formatGlanceMoney = (amount) =>
  new Intl.NumberFormat('en-GH', {
    style: 'currency',
    currency: 'GHS',
    maximumFractionDigits: 0,
  }).format(Number(amount) || 0);

const Dashboard = () => {
  const { school, persistSchool, includesPlanFeature, isPlanApproved } = useAuth();
  const [stats, setStats] = useState({
    totalStudents: 0,
    totalStaff: 0,
    totalNonStaff: 0,
    unreadMessages: 0,
    todayAttendance: 0,
    totalRevenue: 0,
    feesPaid: 0,
    unpaidRevenue: 0,
    yearCollected: 0,
    billedStudents: 0,
    paidStudents: 0,
    unpaidStudents: 0,
    totalClasses: 0,
    walletBalance: 0,
    smsUnits: 0,
    reportCards: 0,
    feePeriodLabel: null,
    attendance: null,
  });
  const [loading, setLoading] = useState(true);
  const selectedDate = schoolLocalDate();

  const applyDashboardPayload = (payload) => {
    if (!payload || typeof payload !== 'object') return;
    setStats(payload);
  };

  const fetchDashboardData = useCallback(async (date, { silent = false } = {}) => {
    const cacheKey = `dashboard:${date}`;
    try {
      if (!silent) {
        const cached = peekCache(cacheKey);
        if (cached) {
          applyDashboardPayload(cached);
          setLoading(false);
        }
      }
      const statsData = await cachedGet(
        cacheKey,
        async () => (await axios.get(`/api/dashboard/stats?date=${date}`)).data,
        silent ? 0 : DASHBOARD_CACHE_MS
      );
      applyDashboardPayload(statsData);
    } catch (error) {
      if (!silent) console.error('Error fetching dashboard data:', error);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboardData(selectedDate, { silent: false });
  }, [selectedDate, isPlanApproved, fetchDashboardData]);

  useEffect(() => {
    let cancelled = false;
    axios
      .get('/api/school/branding')
      .then(({ data }) => {
        if (cancelled || !data?.logo_url) return;
        persistSchool({ logo_url: data.logo_url });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [persistSchool]);

  useLivePoll(() => fetchDashboardData(selectedDate, { silent: true }), 45000, !loading);

  const todayLabel = schoolLocalDateLabel();
  const locked = !isPlanApproved;
  const att = stats.attendance || {};
  const attendancePct = Math.round(Number(att.students?.percentage) || 0);

  const peopleCards = [
    {
      title: 'Students',
      value: stats.totalStudents,
      icon: Users,
      accent: 'text-sky-300 bg-sky-500/15 border-sky-500/25',
      feature: 'students',
    },
    {
      title: 'Staff',
      value: stats.totalStaff,
      icon: Briefcase,
      accent: 'text-emerald-300 bg-emerald-500/15 border-emerald-500/25',
      feature: 'staff',
    },
    {
      title: 'Non-staff',
      value: stats.totalNonStaff,
      icon: UserCog,
      accent: 'text-sky-200 bg-sky-500/10 border-sky-500/20',
      feature: 'non-staff',
    },
    {
      title: 'Unread',
      value: stats.unreadMessages,
      icon: MessageSquare,
      accent: 'text-cyan-300 bg-cyan-500/15 border-cyan-500/25',
      features: ['messages-sms', 'messages-email'],
    },
  ].filter((stat) => {
    if (stat.features) return stat.features.some((f) => includesPlanFeature(f));
    return includesPlanFeature(stat.feature);
  });

  const financeCards = [
    {
      title: 'Total revenue',
      hint: stats.feePeriodLabel ? `Billed · ${stats.feePeriodLabel}` : 'Billed this term',
      value: formatGlanceMoney(stats.totalRevenue),
      icon: Landmark,
      accent: 'text-violet-300 bg-violet-500/15 border-violet-500/25',
      feature: 'fees-paid',
    },
    {
      title: 'Fees paid',
      hint: locked ? null : `${Number(stats.paidStudents || 0).toLocaleString()} students`,
      value: formatGlanceMoney(stats.feesPaid),
      icon: DollarSign,
      accent: 'text-emerald-300 bg-emerald-500/15 border-emerald-500/25',
      feature: 'fees-paid',
    },
    {
      title: 'Unpaid revenue',
      hint: locked ? null : `${Number(stats.unpaidStudents || 0).toLocaleString()} outstanding`,
      value: formatGlanceMoney(stats.unpaidRevenue),
      icon: Receipt,
      accent: 'text-amber-300 bg-amber-500/15 border-amber-500/25',
      feature: 'fees-unpaid',
    },
  ].filter((stat) => includesPlanFeature(stat.feature));

  const snapshotItems = [
    {
      label: 'Present today',
      value: locked ? '—' : `${Number(stats.todayAttendance || 0).toLocaleString()}${attendancePct ? ` · ${attendancePct}%` : ''}`,
      icon: CalendarCheck,
      feature: 'attendance',
    },
    {
      label: 'Classes',
      value: locked ? '—' : Number(stats.totalClasses || 0).toLocaleString(),
      icon: BookOpen,
      feature: 'classes',
    },
    {
      label: 'Wallet',
      value: locked ? '—' : formatGlanceMoney(stats.walletBalance),
      icon: Wallet,
      feature: 'school-wallet',
    },
    {
      label: 'SMS units',
      value: locked ? '—' : Number(stats.smsUnits || 0).toLocaleString(),
      icon: MessageSquare,
      features: ['messages-sms', 'messages-email'],
    },
    {
      label: 'Year collected',
      value: locked ? '—' : formatGlanceMoney(stats.yearCollected),
      icon: DollarSign,
      feature: 'fees-paid',
    },
    {
      label: 'Report cards',
      value: locked ? '—' : Number(stats.reportCards || 0).toLocaleString(),
      icon: FileText,
      feature: 'report-cards',
    },
  ].filter((item) => {
    if (item.features) return item.features.some((f) => includesPlanFeature(f));
    return includesPlanFeature(item.feature);
  });

  return (
    <>
      <div className="relative">
        <PlanPendingBanner />
        <SubscriptionBanner />

        <header className="relative mt-8 mb-10 overflow-hidden rounded-[2rem] md:mt-10 md:mb-14">
          <img
            src={school?.logo_url || '/landing-security.jpg'}
            alt={school?.name ? `${school.name} dashboard` : 'Dashboard'}
            decoding="async"
            className="h-56 w-full object-cover object-[68%_center] sm:h-72 lg:h-80"
          />
          <div
            aria-hidden
            className="absolute inset-0 bg-gradient-to-r from-slate-950 via-slate-950/55 to-slate-950/10"
          />
          <div
            aria-hidden
            className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-transparent to-transparent"
          />

          <div className="absolute inset-0 z-10 flex items-end justify-between gap-3 px-6 py-6 sm:px-8 sm:py-8">
            <div className="min-w-0 max-w-xl">
              <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-sky-300">
                Overview
              </p>
              <h1 className="mt-2 font-display text-2xl font-bold leading-tight tracking-tight text-white sm:text-3xl md:text-4xl">
                {school?.name || 'Dashboard'}
              </h1>
              <p className="mt-1 truncate text-sm text-white/80 sm:text-base">{todayLabel}</p>
            </div>
            {school?.plan_name && (
              <div className="mb-1 w-fit shrink-0 rounded-full border border-white/20 bg-slate-950/55 px-3 py-1 text-xs text-slate-100 backdrop-blur-sm">
                Plan · <span className="font-semibold text-white">{school.plan_name}</span>
              </div>
            )}
          </div>
        </header>

        <section className="mb-8 md:mb-10">
          <div className="mb-3">
            <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              At a glance
            </h2>
          </div>

          {peopleCards.length > 0 && (
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              {peopleCards.map((stat) => {
                const Icon = stat.icon;
                return (
                  <div
                    key={stat.title}
                    className={`flex items-center gap-2.5 rounded-xl border border-slate-700/80 bg-slate-900/50 px-3 py-2.5 ${
                      locked ? 'opacity-80' : ''
                    }`}
                  >
                    <div
                      className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${stat.accent}`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[11px] text-slate-400">{stat.title}</p>
                      <p className="font-display text-lg font-semibold tabular-nums leading-tight text-white">
                        {locked ? '—' : Number(stat.value || 0).toLocaleString()}
                      </p>
                    </div>
                    {locked ? <Lock className="h-3 w-3 shrink-0 text-amber-400/80" /> : null}
                  </div>
                );
              })}
            </div>
          )}

          {financeCards.length > 0 && (
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
              {financeCards.map((stat) => {
                const Icon = stat.icon;
                return (
                  <div
                    key={stat.title}
                    className={`rounded-xl border border-slate-700/80 bg-slate-900/50 px-3.5 py-3 ${
                      locked ? 'opacity-80' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-slate-400">
                        {stat.title}
                      </p>
                      <div className={`inline-flex h-7 w-7 items-center justify-center rounded-lg border ${stat.accent}`}>
                        <Icon className="h-3.5 w-3.5" />
                      </div>
                    </div>
                    <p className="mt-2 font-display text-xl font-semibold tabular-nums tracking-tight text-white sm:text-2xl">
                      {locked ? '—' : stat.value}
                    </p>
                    <p className="mt-1 truncate text-[11px] text-slate-500">
                      {locked ? 'Locked until approved' : stat.hint}
                    </p>
                  </div>
                );
              })}
            </div>
          )}

          {snapshotItems.length > 0 && (
            <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 rounded-xl border border-slate-700/70 bg-slate-900/35 px-3 py-2.5 sm:grid-cols-3 lg:grid-cols-6">
              {snapshotItems.map((item) => {
                const Icon = item.icon;
                return (
                  <div key={item.label} className="flex min-w-0 items-center gap-2 rounded-lg px-1 py-0.5">
                    <Icon className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                    <div className="min-w-0">
                      <p className="truncate text-[10px] uppercase tracking-[0.08em] text-slate-500">
                        {item.label}
                      </p>
                      <p className="truncate text-sm font-medium tabular-nums text-slate-100">
                        {item.value}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <div className="mt-8 md:mt-12">
          <SchoolAnalyticsChart />
        </div>
      </div>
    </>
  );
};

export default Dashboard;
