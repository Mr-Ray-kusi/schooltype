import React, { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate, useLocation, Outlet } from 'react-router-dom';
import { useAuth } from '../contexts/authcontext';
import {
  LayoutDashboard,
  Users,
  Briefcase,
  Calendar,
  QrCode,
  UserPlus,
  LogOut,
  Menu,
  X,
  School,
  BookOpen,
  MessageSquare,
  FileText,
  DollarSign,
  Receipt,
  Lock,
  Landmark,
  Wallet,
  Mail,
  ClipboardList,
  Bell,
  Activity,
  GraduationCap,
} from 'lucide-react';
import toast from 'react-hot-toast';
import axios from 'axios';
import OfflineBanner from './OfflineBanner';
import useLiteMode from '../hooks/useLiteMode';
import usePlatformTelemetry from '../hooks/usePlatformTelemetry';
import { cachedGet, DASHBOARD_CACHE_MS } from '../utils/requestCache';
import { schoolLocalDate } from '../utils/schoolDate';

/** True when the current location matches a nav href. */
const isNavActive = (location, href) => {
  if (!href) return false;
  const path = href.split('?')[0];
  if (location.pathname === path) return true;
  if (path === '/super-admin' || path === '/') return false;
  return location.pathname.startsWith(`${path}/`);
};

const Layout = ({ children }) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const { school, logout, isSuperAdmin, hasFeature, includesPlanFeature, isPlanApproved, token } =
    useAuth();
  const { liteMode, toggleLiteMode } = useLiteMode();
  const navigate = useNavigate();
  const location = useLocation();
  usePlatformTelemetry();

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
    const date = schoolLocalDate();
    cachedGet(
      `dashboard:${date}`,
      async () => (await axios.get(`/api/dashboard/stats?date=${date}`)).data,
      DASHBOARD_CACHE_MS
    ).catch(() => {});
    cachedGet('classes', async () => (await axios.get('/api/classes')).data || [], 45000).catch(() => {});
    return undefined;
  }, [token, isSuperAdmin]);

  const handleLogout = async () => {
    await logout();
    navigate('/');
  };

  const handleLogoutAll = async () => {
    await logout({ everywhere: true });
    toast.success('Signed out on every device for this school');
    navigate('/');
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
        { name: 'Add Student', href: '/add-student', icon: UserPlus, featureKey: 'add-student' },
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
        { name: 'Bank Settings', href: '/bank-settings', icon: Landmark, featureKey: 'bank-settings' },
        { name: 'School Wallet', href: '/school-wallet', icon: Wallet, featureKey: 'school-wallet' },
        { name: 'Fees Paid', href: '/fees-paid', icon: DollarSign, featureKey: 'fees-paid' },
        { name: 'Fees Unpaid', href: '/fees-unpaid', icon: Receipt, featureKey: 'fees-unpaid' },
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
            { name: 'Monitoring', href: '/super-admin/monitor', icon: ClipboardList },
            { name: 'Notifications', href: '/super-admin/notifications', icon: Bell },
            { name: 'Email Schools', href: '/super-admin/email-schools', icon: Mail },
            { name: 'SMS Units', href: '/super-admin/sms', icon: MessageSquare },
          ],
        },
        {
          title: 'Finance',
          items: [
            { name: 'Bank Settings', href: '/super-admin/bank-settings', icon: Landmark },
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

  return (
    <div className="min-h-screen bg-slate-900 text-slate-50">
      <div className="lg:hidden fixed top-4 left-4 z-50">
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="p-2 bg-slate-800 text-slate-50 rounded-lg shadow-md"
          aria-label={sidebarOpen ? 'Close menu' : 'Open menu'}
        >
          {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      <div className="fixed top-4 right-4 z-50">
        <Link
          to={isSuperAdmin ? '/super-admin/notifications' : '/notifications'}
          className="relative flex h-10 w-10 items-center justify-center rounded-lg bg-slate-800 text-slate-50 shadow-md hover:bg-slate-700"
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

      {sidebarOpen && (
        <button
          type="button"
          aria-label="Close sidebar"
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <div
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-slate-800 shadow-xl transform transition-transform duration-300 ease-in-out ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        } lg:translate-x-0`}
      >
        <div className="flex items-center gap-2 p-6 border-b border-slate-600 shrink-0">
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
            <h1 className="text-xl font-bold text-white truncate">
              {isSuperAdmin ? 'SCHOOLTYPE' : (school?.name || 'SCHOOLTYPE')}
            </h1>
            <p className="text-xs text-slate-300 truncate">
              {isSuperAdmin
                ? 'The central connection point for all your school academic activities'
                : `${school?.plan_name || 'No plan'} · ${!isPlanApproved ? 'Payment required' : 'Admin'}`}
            </p>
          </div>
        </div>

        <nav className="flex-1 p-4 space-y-6 overflow-y-auto">
          {navigationSections.map((section) => (
            <div key={section.title}>
              <h2 className="px-4 text-xs font-semibold uppercase tracking-wide text-slate-300">
                {section.title}
              </h2>
              <div className="mt-2 space-y-1">
                {section.items.map((item) => {
                  const active = isNavActive(location, item.href);
                  const isLocked =
                    !isSuperAdmin &&
                    Boolean(item.featureKey || item.featureKeys) &&
                    !isPlanApproved &&
                    (item.featureKeys
                      ? !item.featureKeys.some((key) => hasFeature(key))
                      : Boolean(item.featureKey) && !hasFeature(item.featureKey));

                  const itemClasses = `flex items-center gap-3 px-4 py-2 rounded-lg transition-colors whitespace-nowrap ${
                    isLocked
                      ? 'text-slate-400 cursor-not-allowed opacity-60'
                      : active
                        ? 'bg-sky-500/15 text-white'
                        : 'text-slate-100 hover:bg-slate-700'
                  }`;

                  if (isLocked) {
                    return (
                      <button
                        key={item.href}
                        type="button"
                        onClick={() => {
                          setSidebarOpen(false);
                          toast.error('This feature is locked until your plan is approved by the admin.');
                        }}
                        className={`${itemClasses} w-full text-left`}
                      >
                        <item.icon className="w-5 h-5 shrink-0" />
                        <span className="flex-1 truncate">{item.name}</span>
                        <Lock className="w-4 h-4 shrink-0" />
                      </button>
                    );
                  }

                  return (
                    <Link
                      key={item.href}
                      to={item.href}
                      onClick={() => setSidebarOpen(false)}
                      className={itemClasses}
                      aria-current={active ? 'page' : undefined}
                    >
                      <item.icon className="w-5 h-5 shrink-0" />
                      <span className="flex-1 truncate">{item.name}</span>
                      {item.name === 'Notifications' && unread > 0 && (
                        <span className="rounded-full bg-sky-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                          {unread > 99 ? '99+' : unread}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="shrink-0 border-t border-slate-600 p-4">
          <button
            type="button"
            onClick={toggleLiteMode}
            className="mb-2 flex w-full items-center justify-between rounded-lg px-4 py-2 text-left text-sm text-slate-200 hover:bg-slate-700"
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

      <div className="min-w-0 lg:ml-64">
        <main className="w-full min-w-0 max-w-full overflow-x-clip p-4 pt-16 sm:p-6 lg:pt-6">
          <OfflineBanner />
          {children ?? <Outlet />}
        </main>
      </div>
    </div>
  );
};

export default Layout;
