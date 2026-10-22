import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/authcontext';
import { useEffect, useState } from 'react';
import {
  Home as HomeIcon,
  Users,
  Hexagon,
  Shield,
  ArrowUpRight,
  Menu,
  X,
  Building2,
  Headphones,
  Workflow,
  Check,
  QrCode,
  MessageSquare,
  GraduationCap,
  Wallet,
  Lock,
  KeyRound,
  ShieldCheck,
  Database,
  Fingerprint,
} from 'lucide-react';
import { SYSTEM_CAPABILITY_GROUPS } from '../constants/plans';

const NAV_ITEMS = [
  { id: 'home', label: 'Home', to: '#home', Icon: HomeIcon },
  { id: 'about', label: 'About', to: '#about', Icon: Users },
  { id: 'features', label: 'Features', to: '#features', Icon: Hexagon },
  { id: 'fees', label: 'Fees', to: '/fees', Icon: Wallet },
  { id: 'security', label: 'Security', to: '#security', Icon: Shield },
];

const ABOUT_POINTS = [
  {
    Icon: Building2,
    title: 'Who we are',
    body: 'Schooltype is a school operations company building the central connection point for academic life — from enrollment and attendance to fees, messaging, and reporting.',
  },
  {
    Icon: Workflow,
    title: 'What we do',
    body: 'We design multi-tenant school management software that keeps student, staff, and finance data organized, auditable, and accessible to the right people.',
  },
  {
    Icon: Headphones,
    title: 'How we support schools',
    body: 'Schools get guided onboarding, plan-based feature access, wallet and payment tooling, and a product roadmap shaped around real daily school workflows.',
  },
];

const FEATURE_ICONS = [Users, QrCode, MessageSquare, GraduationCap];

const SECURITY_POINTS = [
  {
    Icon: KeyRound,
    title: 'Authenticated access',
    body: 'Every school session is protected with JWT-based sign-in. Passwords are hashed with bcrypt so credentials are never stored in plain text.',
  },
  {
    Icon: Database,
    title: 'Tenant isolation',
    body: 'Each school operates in its own data boundary. Students, staff, attendance, fees, and messages stay scoped to the authenticated school account.',
  },
  {
    Icon: Lock,
    title: 'Controlled feature access',
    body: 'Plan approvals and feature gates ensure schools only reach modules they are entitled to use — reducing accidental exposure of sensitive tools.',
  },
  {
    Icon: Fingerprint,
    title: 'Trusted check-ins',
    body: 'QR attendance and scanner tokens tie check-ins to verified school identities, so records remain attributable and harder to spoof.',
  },
  {
    Icon: ShieldCheck,
    title: 'Operational safeguards',
    body: 'Login and signup rate limits, password strength checks, and role-aware routing help keep admin dashboards authentic and abuse-resistant.',
  },
];

const scrollToId = (id) => {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

const Home = () => {
  const { token, school } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeId, setActiveId] = useState('home');

  useEffect(() => {
    // Always keep "/" as the marketing home. Logged-in users can open the dashboard from the nav.
  }, []);

  useEffect(() => {
    const sectionIds = NAV_ITEMS.filter((item) => item.to.startsWith('#')).map((item) => item.id);
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible?.target?.id) setActiveId(visible.target.id);
      },
      { rootMargin: '-20% 0px -55% 0px', threshold: [0.15, 0.35, 0.55] }
    );

    sectionIds.forEach((id) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, [token]);

  const handleNavClick = (item) => {
    setActiveId(item.id);
    setMenuOpen(false);
    if (item.to.startsWith('/')) {
      navigate(item.to);
      return;
    }
    if (item.to.startsWith('#')) {
      scrollToId(item.id);
    }
  };

  const navBar = (
    <>
      <div className="landing-nav mx-auto flex max-w-6xl items-center justify-between gap-2 rounded-full px-3 py-2 shadow-[0_8px_30px_rgba(15,23,42,0.12)] sm:gap-3 sm:px-4 sm:py-2.5">
        <a
          href="#home"
          className="flex shrink-0 items-center gap-2 pl-0.5 sm:gap-2.5"
          onClick={(e) => {
            e.preventDefault();
            handleNavClick(NAV_ITEMS[0]);
          }}
        >
          <img
            src="/logo.svg"
            alt=""
            className="landing-nav-logo h-8 w-8 shrink-0 rounded-full object-cover sm:h-10 sm:w-10"
          />
          <span className="leading-tight">
            <span className="block whitespace-nowrap font-display text-[15px] font-extrabold tracking-tight text-slate-900 sm:text-lg">
              SCHOOLTYPE
            </span>
            <span className="hidden text-[10px] font-medium tracking-wide text-slate-500 sm:block">
              Connect. Track. Manage.
            </span>
          </span>
        </a>

        <nav className="landing-nav-rail mx-auto hidden min-w-0 flex-1 items-stretch justify-center rounded-full px-1.5 py-1 lg:flex">
          {NAV_ITEMS.map((item, index) => {
            const isActive = activeId === item.id;
            const showDivider = index === 2;
            const content = (
              <>
                <item.Icon
                  className={`h-4 w-4 ${isActive ? 'text-violet-600' : 'text-slate-500'}`}
                  strokeWidth={1.75}
                />
                <span
                  className={`text-[11px] font-semibold tracking-wide ${
                    isActive ? 'text-violet-700' : 'text-slate-600'
                  }`}
                >
                  {item.label}
                </span>
                {isActive && <span className="mt-0.5 h-1 w-1 rounded-full bg-violet-600" />}
              </>
            );

            return (
              <div key={item.id} className="flex items-center">
                {showDivider && <span className="mx-0.5 h-7 w-px bg-slate-200/90" aria-hidden />}
                <a
                  href={item.to}
                  onClick={(e) => {
                    e.preventDefault();
                    handleNavClick(item);
                  }}
                  className={`flex min-w-[4.5rem] flex-col items-center gap-0.5 rounded-2xl px-2.5 py-1.5 transition ${
                    isActive ? 'bg-white shadow-sm' : 'hover:bg-white/70'
                  }`}
                >
                  {content}
                </a>
              </div>
            );
          })}
        </nav>

        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          {token ? (
            <Link
              to={
                school?.role === 'super_admin'
                  ? '/super-admin'
                  : !school?.payment_plan
                    ? '/select-plan'
                    : '/dashboard'
              }
              className="hidden rounded-full px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-white/80 lg:inline-flex"
            >
              Dashboard
            </Link>
          ) : (
            <>
              <Link
                to="/login"
                className="hidden rounded-full px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-white/80 sm:inline-flex"
              >
                Sign in
              </Link>
              <Link
                to="/plans"
                className="landing-nav-cta group hidden items-center gap-2 rounded-full py-2 pl-4 pr-2 text-sm font-semibold text-white shadow-md shadow-violet-500/25 transition hover:brightness-110 sm:inline-flex"
              >
                <span className="whitespace-nowrap">Get started</span>
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-violet-600 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5">
                  <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={2.5} />
                </span>
              </Link>
            </>
          )}

          <button
            type="button"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
            className="landing-nav-menu flex h-9 w-9 items-center justify-center rounded-full text-slate-700 shadow-[0_4px_14px_rgba(15,23,42,0.1)] transition hover:bg-slate-50 sm:h-11 sm:w-11 lg:hidden"
          >
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {menuOpen && (
        <div className="landing-nav mx-auto mt-2 max-w-6xl overflow-hidden rounded-[1.5rem] p-3 shadow-[0_12px_40px_rgba(15,23,42,0.14)] lg:hidden">
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-3">
            {NAV_ITEMS.map((item) => {
              const isActive = activeId === item.id;
              return (
                <a
                  key={item.id}
                  href={item.to}
                  className={`flex flex-col items-center gap-1 rounded-2xl px-2 py-3 transition ${
                    isActive ? 'bg-violet-50 text-violet-700' : 'text-slate-600 hover:bg-slate-50'
                  }`}
                  onClick={(e) => {
                    e.preventDefault();
                    handleNavClick(item);
                  }}
                >
                  <item.Icon
                    className={`h-5 w-5 ${isActive ? 'text-violet-600' : 'text-slate-500'}`}
                    strokeWidth={1.75}
                  />
                  <span className="text-xs font-semibold">{item.label}</span>
                </a>
              );
            })}
          </div>
          {token ? (
            <Link
              to={
                school?.role === 'super_admin'
                  ? '/super-admin'
                  : !school?.payment_plan
                    ? '/select-plan'
                    : '/dashboard'
              }
              onClick={() => setMenuOpen(false)}
              className="mt-2 flex items-center justify-center rounded-full border border-slate-200 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              Dashboard
            </Link>
          ) : (
            <Link
              to="/login"
              onClick={() => setMenuOpen(false)}
              className="mt-2 flex items-center justify-center rounded-full border border-slate-200 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              Sign in
            </Link>
          )}
        </div>
      )}
    </>
  );

  return (
    <div className="relative bg-slate-950 font-sans text-white">
      <header className="animate-hero-fade sticky top-0 z-50 px-3 pt-4 sm:px-5 md:px-8">
        {navBar}
      </header>

      {/* Hero — full-bleed under sticky nav */}
      <section id="home" className="relative -mt-[4.75rem] min-h-screen scroll-mt-0 overflow-hidden pt-[4.75rem]">
        <div className="absolute inset-0">
          <img
            src="/landing-hero.jpg"
            alt="Students at a school courtyard"
            className="h-full w-full object-cover animate-ken-burns"
          />
          <div
            className="absolute inset-0"
            style={{
              background:
                'linear-gradient(105deg, rgba(2, 12, 27, 0.92) 0%, rgba(2, 12, 27, 0.78) 42%, rgba(2, 12, 27, 0.45) 70%, rgba(2, 12, 27, 0.55) 100%)',
            }}
          />
          <div
            className="absolute inset-0 opacity-40"
            style={{
              backgroundImage:
                'radial-gradient(ellipse 50% 40% at 15% 80%, rgba(52, 152, 219, 0.25), transparent), radial-gradient(ellipse 40% 35% at 85% 20%, rgba(39, 174, 96, 0.12), transparent)',
            }}
          />
        </div>

        <div className="relative z-10 flex min-h-[calc(100vh-4.75rem)] flex-col justify-center px-4 pb-12 pt-6 sm:px-6 md:px-10 lg:px-14 lg:pb-24">
          <div className="max-w-2xl">
            <p className="animate-hero-fade font-display text-[1.65rem] font-extrabold tracking-tight text-white sm:text-4xl md:text-6xl lg:text-7xl">
              SCHOOLTYPE
            </p>
            <h1 className="animate-hero-rise mt-3 font-display text-lg font-bold leading-snug tracking-tight text-white/95 sm:mt-5 sm:text-2xl md:text-4xl">
              The central connection point for all your school academic activities
            </h1>
            <p className="animate-hero-rise-late mt-3 max-w-lg text-sm leading-relaxed text-slate-200/90 sm:mt-5 sm:text-base md:text-lg">
              Track students and staff, mark attendance with QR codes, send SMS or email, manage fees
              and wallets — everything your school needs, connected in one place.
            </p>

            <div className="animate-hero-rise-late mt-6 grid grid-cols-3 gap-1.5 sm:mt-10 sm:flex sm:flex-wrap sm:items-center sm:gap-4">
              <Link
                to="/plans"
                className="inline-flex items-center justify-center rounded-full bg-sky-500 px-2 py-2.5 text-center text-[11px] font-semibold leading-tight text-white shadow-xl shadow-sky-500/30 transition hover:bg-sky-400 sm:px-7 sm:py-3.5 sm:text-sm"
              >
                Get started
              </Link>
              <Link
                to="/fees"
                className="inline-flex items-center justify-center rounded-full border border-white/25 bg-white/5 px-2 py-2.5 text-center text-[11px] font-semibold leading-tight text-white backdrop-blur-sm transition hover:border-white/40 hover:bg-white/10 sm:px-7 sm:py-3.5 sm:text-sm"
              >
                Pay fees
              </Link>
              <Link
                to="/login"
                className="inline-flex items-center justify-center rounded-full border border-white/25 bg-white/5 px-2 py-2.5 text-center text-[11px] font-semibold leading-tight text-white backdrop-blur-sm transition hover:border-white/40 hover:bg-white/10 sm:px-7 sm:py-3.5 sm:text-sm"
              >
                Sign in
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* About */}
      <section id="about" className="scroll-mt-28 bg-[#eef4fa] px-4 py-20 text-slate-900 sm:px-6 md:px-10 lg:px-14 lg:py-28">
        <div className="mx-auto max-w-6xl">
          <div className="grid items-end gap-10 lg:grid-cols-12 lg:gap-12">
            <div className="relative lg:col-span-5">
              <div className="absolute -left-3 top-8 hidden h-40 w-3 rounded-full bg-sky-500 sm:block" />
              <div className="overflow-hidden rounded-[2rem] bg-[#ffffff] shadow-[0_24px_60px_rgba(15,23,42,0.12)]">
                <img
                  src="/landing-about.jpg"
                  alt="A teacher helping students in class"
                  className="h-64 w-full object-cover sm:h-80 lg:h-[30rem]"
                  loading="lazy"
                />
              </div>
            </div>
            <div className="lg:col-span-7 lg:pb-4">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-sky-600">About Schooltype</p>
              <h2 className="mt-4 font-display text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl md:text-5xl">
                Built to connect every part of school life
              </h2>
              <p className="mt-5 max-w-xl text-base leading-relaxed text-slate-600 sm:text-lg">
                Schooltype helps schools move from scattered registers and chats to one trusted system —
                connecting people, attendance, academics, messaging, and payments under a single brand
                your staff and parents can rely on.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                {['Multi-tenant workspaces', 'End-to-end operations', 'Plan-ready packages'].map((label) => (
                  <span
                    key={label}
                    className="rounded-full border border-slate-200 bg-[#ffffff] px-4 py-2 text-sm font-medium text-slate-700"
                  >
                    {label}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-14 grid gap-px overflow-hidden rounded-[2rem] bg-slate-200/80 sm:grid-cols-3">
            {ABOUT_POINTS.map(({ Icon, title, body }, index) => (
              <div key={title} className="bg-[#eef4fa] p-7 sm:bg-[#ffffff]">
                <span className="font-display text-sm font-bold text-sky-500">0{index + 1}</span>
                <Icon className="mt-5 h-8 w-8 text-slate-900" strokeWidth={1.6} />
                <h3 className="mt-4 font-display text-xl font-bold text-slate-950">{title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-slate-600">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="scroll-mt-28 bg-[#ffffff] px-4 py-20 text-slate-900 sm:px-6 md:px-10 lg:px-14 lg:py-28">
        <div className="mx-auto max-w-6xl">
          <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-sky-600">Features</p>
              <h2 className="mt-4 font-display text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl md:text-5xl">
                Everything your school needs in one system
              </h2>
              <p className="mt-5 text-base leading-relaxed text-slate-600 sm:text-lg">
                From student IDs and QR check-in to report cards, bulk messaging, and school wallets —
                Schooltype covers the daily tools administrators actually use.
              </p>
            </div>
            <div className="w-full max-w-sm overflow-hidden rounded-[1.75rem] shadow-[0_18px_50px_rgba(15,23,42,0.12)] lg:mb-1">
              <img
                src="/landing-features.jpg"
                alt="A school administrator checking student attendance"
                className="h-44 w-full object-cover sm:h-52"
                loading="lazy"
              />
            </div>
          </div>

          <div className="mt-14 grid gap-5 md:grid-cols-2">
            {SYSTEM_CAPABILITY_GROUPS.map((group, index) => {
              const Icon = FEATURE_ICONS[index] || Hexagon;
              const accents = [
                'bg-sky-50 text-sky-700',
                'bg-emerald-50 text-emerald-700',
                'bg-violet-50 text-violet-700',
                'bg-amber-50 text-amber-700',
              ];
              return (
                <article
                  key={group.title}
                  className="rounded-[1.75rem] border border-slate-200/80 bg-slate-50/80 p-6 sm:p-8"
                >
                  <div className="flex items-center gap-3">
                    <span className={`flex h-11 w-11 items-center justify-center rounded-2xl ${accents[index] || accents[0]}`}>
                      <Icon className="h-5 w-5" strokeWidth={1.75} />
                    </span>
                    <h3 className="font-display text-xl font-bold text-slate-950">{group.title}</h3>
                  </div>
                  <ul className="mt-6 space-y-3">
                    {group.items.map((item) => (
                      <li key={item} className="flex items-start gap-3 text-sm text-slate-600">
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-sky-500" strokeWidth={2.5} />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </article>
              );
            })}
          </div>

          <p className="mt-10 flex items-start gap-3 rounded-2xl bg-slate-950 px-5 py-4 text-sm text-slate-200 sm:items-center">
            <Wallet className="mt-0.5 h-5 w-5 shrink-0 text-sky-400 sm:mt-0" strokeWidth={1.75} />
            Plus school wallet, bank, and MoMo settings for deposits and payouts.
          </p>
        </div>
      </section>

      {/* Fees payment */}
      <section
        id="fees"
        className="scroll-mt-28 bg-gradient-to-br from-sky-600 via-sky-500 to-emerald-600 px-4 py-20 text-white sm:px-6 md:px-10 lg:px-14 lg:py-28"
      >
        <div className="mx-auto max-w-6xl">
          <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-white/80">Fees payment</p>
              <h2 className="mt-4 font-display text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl">
                Parents pay school fees online
              </h2>
              <p className="mt-5 max-w-lg text-base leading-relaxed text-sky-50 sm:text-lg">
                Choose the school, enter the student ID, verify the student, then pay with MoMo or bank.
              </p>
              <ol className="mt-10 space-y-5">
                {[
                  { step: '1', title: 'Select school and student ID', body: 'Pick the school, then enter the student ID from the ID card to search.' },
                  { step: '2', title: 'Verify student details', body: 'Confirm the name, class, and fee belong to the right student before you pay.' },
                  { step: '3', title: 'Pay and confirm', body: 'Choose MoMo or bank, enter the amount, and confirm the payment.' },
                ].map((item) => (
                  <li key={item.step} className="flex gap-4">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#ffffff] font-display text-sm font-bold text-sky-700">
                      {item.step}
                    </span>
                    <div>
                      <h3 className="font-display text-lg font-bold">{item.title}</h3>
                      <p className="mt-1 text-sm leading-relaxed text-sky-50/90">{item.body}</p>
                    </div>
                  </li>
                ))}
              </ol>
              <Link
                to="/fees"
                className="mt-10 inline-flex items-center justify-center rounded-full bg-[#ffffff] px-7 py-3.5 text-sm font-semibold text-sky-700 shadow-lg shadow-slate-950/20 transition hover:bg-sky-50"
              >
                Pay fees
              </Link>
            </div>
            <div className="relative">
              <div className="overflow-hidden rounded-[2rem] bg-white/10 shadow-[0_24px_60px_rgba(2,12,27,0.28)] ring-1 ring-white/20">
                <img
                  src="/landing-fees.jpg"
                  alt="A parent paying school fees on a phone"
                  className="h-72 w-full object-cover sm:h-[26rem]"
                  loading="lazy"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Security */}
      <section id="security" className="scroll-mt-28 bg-slate-950 px-4 py-20 sm:px-6 md:px-10 lg:px-14 lg:py-28">
        <div className="mx-auto max-w-6xl">
          <div className="grid gap-10 lg:grid-cols-12 lg:items-center">
            <div className="lg:col-span-5">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-sky-400">Security</p>
              <h2 className="mt-4 font-display text-3xl font-bold tracking-tight text-white sm:text-4xl">
                Built to keep school data authentic and protected
              </h2>
              <p className="mt-5 text-base leading-relaxed text-slate-400 sm:text-lg">
                Schooltype treats school records as sensitive operational data. Access is authenticated,
                schools are isolated from each other, and critical actions stay behind verified
                sessions and plan-approved roles.
              </p>
            </div>
            <div className="overflow-hidden rounded-[2rem] lg:col-span-7">
              <img
                src="/landing-security.jpg"
                alt="A school administrator reviewing records in a quiet office"
                className="h-56 w-full object-cover sm:h-72 lg:h-80"
                loading="lazy"
              />
            </div>
          </div>

          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {SECURITY_POINTS.map(({ Icon, title, body }) => (
              <div
                key={title}
                className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur-sm"
              >
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-sky-500/15 text-sky-300">
                  <Icon className="h-5 w-5" strokeWidth={1.75} />
                </span>
                <h3 className="mt-5 font-display text-lg font-bold text-white">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="border-t border-white/10 bg-[#07111f] px-6 py-12 md:px-10 lg:px-14">
        <div className="mx-auto flex max-w-6xl flex-col gap-8 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-display text-2xl font-bold text-white">SCHOOLTYPE</p>
            <p className="mt-1 text-sm text-slate-500">Connect. Track. Manage.</p>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-3 text-sm text-slate-400">
            <Link to="/fees" className="hover:text-white">
              Fees payment
            </Link>
            <Link to="/privacy" className="hover:text-white">
              Privacy
            </Link>
            <Link to="/login" className="hover:text-white">
              Sign in
            </Link>
            <Link to="/plans" className="hover:text-white">
              Get started
            </Link>
            <a href="#about" onClick={(e) => { e.preventDefault(); scrollToId('about'); }} className="hover:text-white">
              About
            </a>
            <a href="#security" onClick={(e) => { e.preventDefault(); scrollToId('security'); }} className="hover:text-white">
              Security
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Home;
