import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Link, useLocation, Outlet } from 'react-router-dom';
import { useAuth } from '../contexts/authcontext';
import {
  LayoutDashboard,
  Users,
  Briefcase,
  Calendar,
  QrCode,
  LogOut,
  School,
  BookOpen,
  MessageSquare,
  FileText,
  DollarSign,
  Lock,
  Wallet,
  Mail,
  Bell,
  Activity,
  GraduationCap,
  MoreHorizontal,
} from 'lucide-react';
import toast from 'react-hot-toast';
import axios from 'axios';
import OfflineBanner from './OfflineBanner';
import useLiteMode from '../hooks/useLiteMode';
import usePlatformTelemetry from '../hooks/usePlatformTelemetry';
import { cachedGet } from '../utils/requestCache';

/** True when the current location matches a nav href. */
const isNavActive = (location, href) => {
  if (!href) return false;
  const path = href.split('?')[0];
  if (location.pathname === path) return true;
  if (path === '/super-admin' || path === '/') return false;
  return location.pathname.startsWith(`${path}/`);
};

const WA_GREEN = '#25D366';

const Layout = ({ children }) => {
  const [moreOpen, setMoreOpen] = useState(false);
  const [youOpen, setYouOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const { school, logout, isSuperAdmin, hasFeature, includesPlanFeature, isPlanApproved, token } =
    useAuth();
  const { liteMode, toggleLiteMode } = useLiteMode();
  const location = useLocation();
  usePlatformTelemetry();

  useEffect(() => {
    document.documentElement.classList.toggle('lite', liteMode);
  }, [liteMode]);

  const refreshUnread = useCallback(async () => {
    if (!token) return;
    try {
      const { unread } = await cachedGet(
        'notifications:unread',
        async () => (await axios.get('/api/notifications/unread-count')).data,
        15000
      );
      setUnread(Number(unread) || 0);
    } catch {
      // Table may not exist until migration is applied.
    }
  }, [token]);

  useEffect(() => {
    refreshUnread();
    const id = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      refreshUnread();
    }, 30000);
    return () => clearInterval(id);
  }, [refreshUnread, location.pathname]);

  useEffect(() => {
    if (!token || isSuperAdmin) return undefined;
    cachedGet('classes', async () => (await axios.get('/api/classes')).data || [], 45000).catch(() => {});
    return undefined;
  }, [token, isSuperAdmin]);

  useEffect(() => {
    setMoreOpen(false);
    setYouOpen(false);
  }, [location.pathname]);

  const handleLogout = async () => {
    await logout();
    window.location.assign('/');
  };

  const handleLogoutAll = async () => {
    await logout({ everywhere: true });
    toast.success('Signed out on every device for this school');
    window.location.assign('/');
  };

  const schoolNavSections = [
    {
      title: 'Main',
      items: [
        { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, featureKey: 'dashboard' },
        { name: 'Notifications', href: '/notifications', icon: Bell },
      ],
    },
    {
      title: 'Academic',
      items: [
        { name: 'Students', href: '/students', icon: Users, featureKey: 'students' },
        { name: 'Staff', href: '/staff', icon: Briefcase, featureKeys: ['staff', 'non-staff'] },
        { name: 'Setup', href: '/classes', icon: BookOpen, featureKey: 'classes' },
        { name: 'Attendance', href: '/attendance', icon: Calendar, featureKey: 'attendance' },
        { name: 'Scanner', href: '/scanner', icon: QrCode, featureKey: 'scanner' },
      ],
    },
    {
      title: 'Communication',
      items: [
        { name: 'Messages', href: '/messages', icon: MessageSquare, featureKeys: ['messages-sms', 'messages-email'] },
      ],
    },
    {
      title: 'Result',
      items: [
        { name: 'Report Cards', href: '/report-cards', icon: FileText, featureKey: 'report-cards' },
        { name: 'Alumni Status', href: '/alumni', icon: GraduationCap, featureKey: 'students' },
      ],
    },
    {
      title: 'Finance',
      items: [
        { name: 'School Wallet', href: '/school-wallet', icon: Wallet, featureKey: 'school-wallet' },
        { name: 'Fees', href: '/fees-paid', icon: DollarSign, featureKeys: ['fees-paid', 'fees-unpaid'] },
      ],
    },
  ];

  const navigationSections = isSuperAdmin
    ? [
        {
          title: 'Platform',
          items: [
            { name: 'All Schools', href: '/super-admin', icon: LayoutDashboard },
            { name: 'Analytics', href: '/super-admin/analytics', icon: Activity },
            { name: 'Notifications', href: '/super-admin/notifications', icon: Bell },
            { name: 'Email Schools', href: '/super-admin/email-schools', icon: Mail },
            { name: 'SMS Units', href: '/super-admin/sms', icon: MessageSquare },
          ],
        },
        {
          title: 'Finance',
          items: [
            { name: 'Platform Wallet', href: '/super-admin/platform-wallet', icon: Wallet },
          ],
        },
      ]
    : schoolNavSections
        .map((section) => ({
          ...section,
          items: section.items.filter((item) => {
            if (!item.featureKey && !item.featureKeys) return true;
            if (item.featureKeys) {
              return item.featureKeys.some((key) => includesPlanFeature(key));
            }
            return includesPlanFeature(item.featureKey);
          }),
        }))
        .filter((section) => section.items.length > 0);

  const allNavItems = useMemo(
    () => navigationSections.flatMap((section) => section.items),
    [navigationSections]
  );

  const itemAllowed = (item) => {
    if (!item) return false;
    if (isSuperAdmin) return true;
    if (!item.featureKey && !item.featureKeys) return true;
    if (item.featureKeys) return item.featureKeys.some((key) => includesPlanFeature(key));
    return includesPlanFeature(item.featureKey);
  };

  const mobileTabs = useMemo(() => {
    const preferred = isSuperAdmin
      ? [
          { name: 'Home', href: '/super-admin', icon: LayoutDashboard },
          { name: 'Analytics', href: '/super-admin/analytics', icon: Activity },
          { name: 'Inbox', href: '/super-admin/notifications', icon: Bell, badge: unread },
          { name: 'Chats', href: '/super-admin/email-schools', icon: MessageSquare },
        ]
      : [
          { name: 'Home', href: '/dashboard', icon: LayoutDashboard, featureKey: 'dashboard' },
          { name: 'Attendance', href: '/attendance', icon: Calendar, featureKey: 'attendance' },
          { name: 'Students', href: '/students', icon: Users, featureKey: 'students' },
          {
            name: 'Chats',
            href: '/messages',
            icon: MessageSquare,
            featureKeys: ['messages-sms', 'messages-email'],
            badge: unread,
          },
        ];
    return preferred.filter(itemAllowed).slice(0, 4);
  }, [isSuperAdmin, unread, includesPlanFeature]);

  const mobileTabHrefs = useMemo(() => new Set(mobileTabs.map((tab) => tab.href)), [mobileTabs]);
  const moreItems = allNavItems.filter((item) => !mobileTabHrefs.has(item.href));

  const pageTitle = useMemo(() => {
    if (location.pathname === '/add-student') return 'Add student';
    if (youOpen) return 'You';
    const match = allNavItems.find((item) => isNavActive(location, item.href));
    return match?.name || (isSuperAdmin ? 'SCHOOLTYPE' : school?.name || 'Schooltype');
  }, [allNavItems, location, youOpen, isSuperAdmin, school?.name]);

  const isAttendance = location.pathname === '/attendance';
  const dark = !liteMode;
  const circleBtn = dark
    ? 'flex h-11 w-11 items-center justify-center rounded-full bg-[#2a2a2e] text-white'
    : 'flex h-11 w-11 items-center justify-center rounded-full bg-slate-200 text-slate-900';

  const isItemLocked = (item) =>
    !isSuperAdmin &&
    Boolean(item.featureKey || item.featureKeys) &&
    !isPlanApproved &&
    (item.featureKeys
      ? !item.featureKeys.some((key) => hasFeature(key))
      : Boolean(item.featureKey) && !hasFeature(item.featureKey));

  const renderNavLink = (item, { compact = false } = {}) => {
    const active = isNavActive(location, item.href);
    const locked = isItemLocked(item);
    const itemClasses = compact
      ? `flex min-h-11 items-center gap-3 px-4 py-2.5 text-sm ${
          locked
            ? 'text-slate-400'
            : dark
              ? 'text-slate-100 hover:bg-white/5'
              : 'text-slate-800 hover:bg-slate-100'
        }`
      : `flex min-h-11 items-center gap-3 px-4 py-2 rounded-lg transition-colors whitespace-nowrap ${
          locked
            ? 'text-slate-400 cursor-not-allowed opacity-60'
            : active
              ? liteMode
                ? 'bg-sky-100 text-sky-800'
                : 'bg-sky-500/15 text-white'
              : liteMode
                ? 'text-slate-700 hover:bg-slate-100'
                : 'text-slate-100 hover:bg-slate-700'
        }`;

    const inner = (
      <>
        <item.icon className="w-5 h-5 shrink-0" />
        <span className="flex-1 truncate">{item.name}</span>
        {locked ? <Lock className="w-4 h-4 shrink-0" /> : null}
        {item.name === 'Notifications' && unread > 0 && !locked ? (
          <span className="rounded-full bg-sky-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        ) : null}
      </>
    );

    if (locked) {
      return (
        <button
          key={item.href}
          type="button"
          onClick={() => {
            setMoreOpen(false);
            toast.error('This feature is locked until your school plan is paid and active.');
          }}
          className={`${itemClasses} w-full text-left`}
        >
          {inner}
        </button>
      );
    }

    return (
      <Link
        key={item.href}
        to={item.href}
        onClick={() => setMoreOpen(false)}
        className={itemClasses}
        aria-current={active ? 'page' : undefined}
      >
        {inner}
      </Link>
    );
  };

  const youActive = youOpen;
  const schoolLabel = isSuperAdmin ? 'SCHOOLTYPE' : school?.name || 'SCHOOLTYPE';

  return (
    <div className={`min-h-screen ${liteMode ? 'lite-shell bg-slate-100 text-slate-900' : 'bg-slate-900 text-slate-50'}`}>
      <header
        className={`fixed inset-x-0 top-0 z-50 lg:hidden ${
          dark ? 'bg-slate-950/95 text-white' : 'bg-white/95 text-slate-900'
        } backdrop-blur`}
      >
        <div className="relative flex items-center justify-between px-3 pb-2 pt-[max(0.45rem,env(safe-area-inset-top))]">
          <button
            type="button"
            className={circleBtn}
            aria-label={moreOpen ? 'Close menu' : 'More'}
            aria-expanded={moreOpen}
            onClick={() => {
              setYouOpen(false);
              setMoreOpen((open) => !open);
            }}
          >
            <MoreHorizontal className="h-5 w-5" />
          </button>
          <h1 className="pointer-events-none absolute inset-x-14 truncate text-center text-[1.35rem] font-semibold leading-none">
            {pageTitle}
          </h1>
        </div>
      </header>

      {moreOpen ? (
        <>
          <button
            type="button"
            aria-label="Close menu"
            className="fixed inset-0 z-40 bg-black/50 lg:hidden"
            onClick={() => setMoreOpen(false)}
          />
          <div
            className={`fixed left-3 z-50 max-h-[min(70dvh,28rem)] w-[min(18rem,calc(100vw-1.5rem))] overflow-y-auto rounded-2xl py-2 shadow-2xl lg:hidden ${
              dark ? 'bg-[#1c1c1e] text-white' : 'bg-white text-slate-900'
            }`}
            style={{ top: 'calc(3.75rem + env(safe-area-inset-top))' }}
          >
            {moreItems.length ? moreItems.map((item) => renderNavLink(item, { compact: true })) : (
              <p className="px-4 py-3 text-sm text-slate-400">No extra pages</p>
            )}
          </div>
        </>
      ) : null}

      <div className="fixed right-[max(0.75rem,env(safe-area-inset-right))] top-[max(0.75rem,env(safe-area-inset-top))] z-50 hidden lg:right-4 lg:top-4 lg:block">
        <Link
          to={isSuperAdmin ? '/super-admin/notifications' : '/notifications'}
          className={`relative flex h-11 w-11 items-center justify-center rounded-lg shadow-md ${
            liteMode ? 'bg-white text-slate-800 hover:bg-slate-50' : 'bg-slate-800 text-slate-50 hover:bg-slate-700'
          }`}
          aria-label={unread ? `${unread} unread notifications` : 'Notifications'}
        >
          <Bell className="h-5 w-5" />
          {unread > 0 && (
            <span className="absolute -right-1 -top-1 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-sky-500 px-1 text-[10px] font-bold text-white">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </Link>
      </div>

      <div
        className={`fixed inset-y-0 left-0 z-40 hidden w-64 flex-col pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] shadow-xl lg:flex ${
          liteMode ? 'bg-white border-r border-slate-200' : 'bg-slate-800'
        }`}
      >
        <div className={`flex items-center gap-2 p-6 border-b shrink-0 ${liteMode ? 'border-slate-200' : 'border-slate-600'}`}>
          {school?.logo_url ? (
            <img
              src={school.logo_url}
              alt={`${school.name} logo`}
              loading="lazy"
              className="w-10 h-10 rounded-lg object-cover"
            />
          ) : (
            <School className="w-8 h-8 text-primary-400" />
          )}
          <div className="min-w-0">
            <h1 className={`text-xl font-bold truncate ${liteMode ? 'text-slate-900' : 'text-white'}`}>
              {schoolLabel}
            </h1>
            <p className={`text-xs truncate ${liteMode ? 'text-slate-500' : 'text-slate-300'}`}>
              {isSuperAdmin
                ? 'The central connection point for all your school academic activities'
                : `${school?.plan_name || 'No plan'} · ${!isPlanApproved ? 'Payment required' : 'Admin'}`}
            </p>
          </div>
        </div>

        <nav className="flex-1 p-4 space-y-6 overflow-y-auto">
          {navigationSections.map((section) => (
            <div key={section.title}>
              <h2 className={`px-4 text-xs font-semibold uppercase tracking-wide ${liteMode ? 'text-slate-500' : 'text-slate-300'}`}>
                {section.title}
              </h2>
              <div className="mt-2 space-y-1">{section.items.map((item) => renderNavLink(item))}</div>
            </div>
          ))}
        </nav>

        <div className={`shrink-0 border-t p-4 ${liteMode ? 'border-slate-200' : 'border-slate-600'}`}>
          <button
            type="button"
            onClick={toggleLiteMode}
            className={`mb-2 flex w-full items-center justify-between rounded-lg px-4 py-2 text-left text-sm ${
              liteMode ? 'text-slate-700 hover:bg-slate-100' : 'text-slate-200 hover:bg-slate-700'
            }`}
          >
            <span>Lite Mode</span>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${liteMode ? 'bg-sky-500 text-white' : 'bg-slate-600 text-slate-300'}`}>
              {liteMode ? 'On' : 'Off'}
            </span>
          </button>
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 px-4 py-2 w-full text-red-400 rounded-lg hover:bg-red-800 transition-colors"
          >
            <LogOut className="w-5 h-5" />
            <span>Sign out</span>
          </button>
          <button
            type="button"
            onClick={handleLogoutAll}
            className="mt-1 flex w-full items-center px-4 py-1.5 text-left text-xs text-slate-400 hover:text-red-300"
          >
            End every session for this school
          </button>
        </div>
      </div>

      {youOpen ? (
        <>
          <button
            type="button"
            aria-label="Close account"
            className="fixed inset-0 z-40 bg-black/50 lg:hidden"
            onClick={() => setYouOpen(false)}
          />
          <div
            className={`fixed inset-x-3 z-50 rounded-3xl p-4 shadow-2xl lg:hidden ${
              dark ? 'bg-[#1c1c1e] text-white' : 'bg-white text-slate-900'
            }`}
            style={{ bottom: 'calc(5.75rem + env(safe-area-inset-bottom))' }}
          >
            <div className="flex items-center gap-3 pb-3">
              {school?.logo_url ? (
                <img src={school.logo_url} alt="" className="h-12 w-12 rounded-full object-cover" />
              ) : (
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-700 text-white">
                  <School className="h-6 w-6" />
                </div>
              )}
              <div className="min-w-0">
                <p className="truncate font-semibold">{schoolLabel}</p>
                <p className="truncate text-xs text-slate-400">
                  {isSuperAdmin ? 'Super admin' : `${school?.plan_name || 'No plan'} · Admin`}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={toggleLiteMode}
              className="flex w-full items-center justify-between rounded-xl px-2 py-3 text-sm"
            >
              <span>Lite Mode</span>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${liteMode ? 'bg-sky-500 text-white' : 'bg-slate-600 text-slate-300'}`}>
                {liteMode ? 'On' : 'Off'}
              </span>
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="flex w-full items-center gap-2 rounded-xl px-2 py-3 text-sm text-red-400"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
            <button
              type="button"
              onClick={handleLogoutAll}
              className="flex w-full px-2 py-2 text-left text-xs text-slate-400"
            >
              End every session for this school
            </button>
          </div>
        </>
      ) : null}

      <nav className="fixed inset-x-0 bottom-0 z-50 px-3 pb-[max(0.55rem,env(safe-area-inset-bottom))] pt-1 lg:hidden">
        <div
          className={`flex items-end justify-between rounded-[2rem] px-1.5 py-1.5 shadow-[0_8px_32px_rgba(0,0,0,0.45)] ${
            dark ? 'bg-[#1c1c1e] text-slate-300' : 'bg-white text-slate-600'
          }`}
        >
          {mobileTabs.map((tab) => {
            const active = !youActive && isNavActive(location, tab.href);
            return (
              <Link
                key={tab.href}
                to={tab.href}
                onClick={() => setYouOpen(false)}
                aria-current={active ? 'page' : undefined}
                className={`relative flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-3xl px-1 py-1.5 ${
                  active ? (dark ? 'bg-[#3a3a3e] text-white' : 'bg-slate-200 text-slate-900') : ''
                }`}
              >
                <span className="relative">
                  <tab.icon className="h-[1.35rem] w-[1.35rem]" strokeWidth={active ? 2.25 : 1.75} />
                  {tab.dot ? (
                    <span
                      className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full"
                      style={{ backgroundColor: WA_GREEN }}
                    />
                  ) : null}
                  {tab.badge > 0 ? (
                    <span
                      className="absolute -right-3 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold text-white"
                      style={{ backgroundColor: WA_GREEN }}
                    >
                      {tab.badge > 99 ? '99+' : tab.badge}
                    </span>
                  ) : null}
                </span>
                <span className="max-w-full truncate text-[10px] font-medium">{tab.name}</span>
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => {
              setMoreOpen(false);
              setYouOpen((open) => !open);
            }}
            className={`relative flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-3xl px-1 py-1.5 ${
              youActive ? (dark ? 'bg-[#3a3a3e] text-white' : 'bg-slate-200 text-slate-900') : ''
            }`}
          >
            <span className="relative">
              {school?.logo_url ? (
                <img
                  src={school.logo_url}
                  alt=""
                  className={`h-7 w-7 rounded-full object-cover ${youActive ? 'ring-2 ring-white/80' : ''}`}
                />
              ) : (
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-600 text-white">
                  <School className="h-4 w-4" />
                </span>
              )}
              <span
                className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-[#1c1c1e]"
                style={{ backgroundColor: WA_GREEN }}
              />
            </span>
            <span className="text-[10px] font-medium">You</span>
          </button>
        </div>
      </nav>

      <div className="min-w-0 lg:ml-64">
        <main className="w-full min-w-0 max-w-full overflow-x-clip p-4 pb-[calc(6.5rem+env(safe-area-inset-bottom))] pt-[calc(4.35rem+env(safe-area-inset-top))] sm:p-6 sm:pb-[calc(6.5rem+env(safe-area-inset-bottom))] lg:pb-6 lg:pt-6">
          <OfflineBanner />
          <div className={isAttendance ? 'h-[min(70dvh,40rem)] min-h-[22rem] sm:min-h-[28rem]' : undefined}>
            {children ?? <Outlet />}
          </div>
        </main>
      </div>
    </div>
  );
};

export default Layout;
