import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
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
  ArrowUpRight,
} from 'lucide-react';

const Dashboard = () => {
  const { school, includesPlanFeature, isPlanApproved } = useAuth();
  const [stats, setStats] = useState({
    totalStudents: 0,
    totalStaff: 0,
    totalNonStaff: 0,
    unreadMessages: 0,
    todayAttendance: 0,
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

  useLivePoll(() => fetchDashboardData(selectedDate, { silent: true }), 45000, !loading);

  const todayLabel = schoolLocalDateLabel();

  const statCards = [
    {
      title: 'Students',
      value: stats.totalStudents,
      icon: Users,
      accent: 'text-sky-300 bg-sky-500/15 border-sky-500/25',
      link: '/students#list',
      feature: 'students',
    },
    {
      title: 'Staff',
      value: stats.totalStaff,
      icon: Briefcase,
      accent: 'text-emerald-300 bg-emerald-500/15 border-emerald-500/25',
      link: '/staff#list',
      feature: 'staff',
    },
    {
      title: 'Non-staff',
      value: stats.totalNonStaff,
      icon: UserCog,
      accent: 'text-sky-200 bg-sky-500/10 border-sky-500/20',
      link: '/staff#list',
      feature: 'non-staff',
    },
    {
      title: 'Unread messages',
      value: stats.unreadMessages,
      icon: MessageSquare,
      accent: 'text-cyan-300 bg-cyan-500/15 border-cyan-500/25',
      link: '/messages#list',
      features: ['messages-sms', 'messages-email'],
    },
  ].filter((stat) => {
    if (stat.features) return stat.features.some((f) => includesPlanFeature(f));
    return includesPlanFeature(stat.feature);
  });

  return (
    <>
      <div className="relative">
        <PlanPendingBanner />
        <SubscriptionBanner />

        <header className="relative mt-8 mb-10 overflow-hidden rounded-[2rem] md:mt-10 md:mb-14">
          <img
            src={school?.logo_url || '/landing-security.jpg'}
            alt=""
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
          <div className="mb-4 flex items-end justify-between gap-3">
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                At a glance
              </h2>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
            {statCards.map((stat) => {
              const locked = !isPlanApproved;
              const Icon = stat.icon;
              const content = (
                <>
                  <div className="flex items-start justify-between gap-2">
                    <div
                      className={`inline-flex h-9 w-9 items-center justify-center rounded-xl border sm:h-10 sm:w-10 ${stat.accent}`}
                    >
                      <Icon className="h-4 w-4 sm:h-5 sm:w-5" />
                    </div>
                    {!locked && <ArrowUpRight className="hidden h-4 w-4 text-slate-500 sm:block" />}
                    {locked && <Lock className="h-3.5 w-3.5 text-amber-400/80 sm:h-4 sm:w-4" />}
                  </div>
                  <div className="mt-3 sm:mt-4">
                    <p className="text-[11px] leading-tight text-slate-400 sm:text-sm">
                      {stat.title}
                    </p>
                    <p className="mt-1 font-display text-2xl font-bold tabular-nums tracking-tight text-white sm:text-3xl">
                      {locked ? '—' : Number(stat.value || 0).toLocaleString()}
                    </p>
                    {locked && (
                      <p className="mt-1.5 text-[10px] text-amber-400/90 sm:text-xs">Locked until approved</p>
                    )}
                  </div>
                </>
              );

              const className = `flex flex-col justify-between rounded-2xl border border-slate-700/80 bg-slate-900/50 p-3.5 transition sm:p-4 ${
                locked
                  ? 'opacity-80'
                  : 'hover:border-slate-500 hover:bg-slate-900/80'
              }`;

              if (locked) {
                return (
                  <div key={stat.title} className={className}>
                    {content}
                  </div>
                );
              }

              return (
                <Link key={stat.title} to={stat.link} className={className}>
                  {content}
                </Link>
              );
            })}
          </div>
        </section>

        <div className="mt-8 md:mt-12">
          <SchoolAnalyticsChart />
        </div>
      </div>
    </>
  );
};

export default Dashboard;
