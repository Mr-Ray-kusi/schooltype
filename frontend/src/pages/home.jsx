import { Link } from 'react-router-dom';
import { Check } from 'lucide-react';
import MarketingChrome from '../components/MarketingChrome';
import FaqSection from '../components/FaqSection';

const ABOUT_POINTS = [
  {
    title: 'Who we are',
    body: 'Schooltype is a school operations company building the central connection point for academic life — from enrollment and attendance to fees, messaging, and reporting.',
  },
  {
    title: 'What we do',
    body: 'We design multi-tenant school management software that keeps student, staff, and finance data organized, auditable, and accessible to the right people.',
  },
  {
    title: 'How we support schools',
    body: 'Schools get guided onboarding, plan-based feature access, wallet and payment tooling, and a product roadmap shaped around real daily school workflows.',
  },
];

const FEATURE_GROUPS = [
  {
    title: 'People Management',
    items: [
      'Student registry and QR codes',
      'Staff and teacher profiles',
      'Non-staff records',
      'Enrollment forms',
    ],
  },
  {
    title: 'Attendance',
    items: ['Daily check-in scanner', 'Attendance logs and filters', 'Summary charts and export'],
  },
  {
    title: 'Communication',
    items: [
      'Bulk SMS to parents and staff',
      'Email broadcasts',
      'In-app school notifications',
      'Fee payment reminders',
    ],
  },
  {
    title: 'Academics and Finance',
    items: [
      'Class organization',
      'Report cards and teacher uploads',
      'Fees tracking',
      'School wallet and MoMo or bank payouts',
    ],
  },
];

const SECURITY_POINTS = [
  {
    title: 'Authenticated access',
    body: 'Every school session is protected with signed-in access. Passwords are hashed so they are never stored in plain text.',
  },
  {
    title: 'Tenant isolation',
    body: 'Each school operates in its own data boundary. Students, staff, attendance, fees, and messages stay scoped to that school account.',
  },
  {
    title: 'Controlled feature access',
    body: 'Plan approvals and feature gates ensure schools only reach modules they are entitled to use.',
  },
  {
    title: 'Trusted check-ins',
    body: 'QR attendance and scanner links tie check-ins to verified school identities.',
  },
  {
    title: 'Operational safeguards',
    body: 'Login and signup rate limits, password strength checks, and role-aware routing help keep admin dashboards authentic and abuse-resistant.',
  },
];

const Home = () => (
  <MarketingChrome observeHome overlayNav>
    <section id="home" className="relative min-h-[100svh] scroll-mt-0 overflow-hidden">
      <img
        src="/landing-hero.jpg"
        alt="Students in a school courtyard"
        className="absolute inset-0 h-full w-full object-cover"
      />
      <div className="absolute inset-0 bg-[linear-gradient(105deg,rgba(11,31,26,0.88)_0%,rgba(11,31,26,0.72)_48%,rgba(11,31,26,0.52)_100%)]" />
      <div className="relative z-10 mx-auto flex min-h-[100svh] max-w-[1120px] flex-col justify-center px-5 pb-24 pt-28 sm:px-7 sm:pt-32 lg:px-8">
        <p className="mk-kicker mk-kicker-light">SCHOOLTYPE</p>
        <h1 className="mt-4 max-w-3xl font-serif text-[1.85rem] font-bold leading-[1.18] tracking-tight text-[#fffaf2] sm:text-4xl lg:text-[2.75rem]">
          The central connection point for all your school academic activities
        </h1>
        <p className="mt-5 max-w-xl text-base leading-relaxed text-[#efe6d6] sm:text-lg">
          Track students and staff, mark attendance with QR codes, send SMS or email, manage fees and
          wallets — everything your school needs, connected in one place.
        </p>
        <div className="mk-hero-actions mt-8 flex flex-wrap gap-3">
          <Link to="/plans" className="mk-btn mk-btn-primary">
            Get started
          </Link>
          <Link to="/fees" className="mk-btn mk-btn-secondary">
            Pay fees
          </Link>
          <Link to="/login" className="mk-btn mk-btn-secondary">
            Sign in
          </Link>
        </div>
      </div>
    </section>

    <section id="about" className="scroll-mt-24 px-5 py-20 sm:px-7 lg:px-8 lg:py-28">
      <div className="mx-auto grid max-w-[1120px] items-end gap-10 lg:grid-cols-12 lg:gap-14">
        <div className="overflow-hidden lg:col-span-5">
          <img
            src="/landing-about.jpg"
            alt="A teacher helping students in class"
            className="mk-photo h-72 sm:h-80 lg:h-[28rem]"
            loading="lazy"
          />
        </div>
        <div className="lg:col-span-7">
          <p className="mk-kicker">About Schooltype</p>
          <h2 className="mt-3 font-serif text-3xl font-bold tracking-tight text-[var(--mk-ink)] sm:text-5xl">
            Built to connect every part of school life
          </h2>
          <p className="mk-lead mt-5 max-w-xl text-base sm:text-lg">
            Schooltype helps schools move from scattered registers and chats to one trusted system —
            connecting people, attendance, academics, messaging, and payments under a single brand
            your staff and parents can rely on.
          </p>
          <div className="mt-7 flex flex-wrap gap-2">
            {['Multi-tenant workspaces', 'End-to-end operations', 'Plan-ready packages'].map((label) => (
              <span key={label} className="mk-chip">
                {label}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="mx-auto mt-12 grid max-w-[1120px] gap-4 md:grid-cols-3">
        {ABOUT_POINTS.map((item) => (
          <article key={item.title} className="mk-card p-6 sm:p-7">
            <h3 className="font-serif text-xl font-bold text-[var(--mk-ink)]">{item.title}</h3>
            <p className="mk-lead mt-3 text-sm">{item.body}</p>
          </article>
        ))}
      </div>
    </section>

    <section id="features" className="scroll-mt-24 border-y border-[var(--mk-line)] bg-[#ebe3d4] px-5 py-20 sm:px-7 lg:px-8 lg:py-28">
      <div className="mx-auto max-w-[1120px]">
        <div className="grid items-end gap-8 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <p className="mk-kicker">Features</p>
            <h2 className="mt-3 font-serif text-3xl font-bold tracking-tight sm:text-5xl">
              Everything your school needs in one system
            </h2>
            <p className="mk-lead mt-5 max-w-2xl text-base sm:text-lg">
              From student IDs and QR check-in to report cards, bulk messaging, and school wallets —
              Schooltype covers the daily tools administrators actually use.
            </p>
          </div>
          <div className="overflow-hidden lg:col-span-5">
            <img
              src="/landing-features.jpg"
              alt="A school administrator checking student attendance"
              className="mk-photo h-52 sm:h-60"
              loading="lazy"
            />
          </div>
        </div>
        <div className="mt-12 grid gap-4 md:grid-cols-2">
          {FEATURE_GROUPS.map((group) => (
            <article key={group.title} className="mk-card p-6 sm:p-8">
              <h3 className="font-serif text-xl font-bold">{group.title}</h3>
              <ul className="mt-5 space-y-3">
                {group.items.map((item) => (
                  <li key={item} className="flex items-start gap-3 text-sm text-[var(--mk-muted)]">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-[var(--mk-forest)]" strokeWidth={2.4} />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
        <p className="mt-8 border-l-4 border-[var(--mk-brass)] bg-[var(--mk-forest)] px-5 py-4 text-sm text-[#f4efe6]">
          Plus school wallet, bank, and MoMo settings for deposits and payouts.
        </p>
      </div>
    </section>

    <section id="fees" className="scroll-mt-24 px-5 py-20 sm:px-7 lg:px-8 lg:py-28">
      <div className="mx-auto grid max-w-[1120px] items-center gap-10 lg:grid-cols-2 lg:gap-16">
        <div>
          <p className="mk-kicker">Fees payment</p>
          <h2 className="mt-3 font-serif text-3xl font-bold tracking-tight sm:text-5xl">
            Parents pay school fees online
          </h2>
          <p className="mk-lead mt-5 max-w-lg text-base sm:text-lg">
            Choose the school, enter the student ID, verify the student, then pay with MoMo or bank.
          </p>
          <ol className="mt-10 space-y-6">
            {[
              {
                step: '1',
                title: 'Select school and student ID',
                body: 'Pick the school, then enter the student ID from the ID card to search.',
              },
              {
                step: '2',
                title: 'Verify student details',
                body: 'Confirm the name, class, and fee belong to the right student before you pay.',
              },
              {
                step: '3',
                title: 'Pay and confirm',
                body: 'Choose MoMo or bank, enter the amount, and confirm the payment.',
              },
            ].map((item) => (
              <li key={item.step} className="flex gap-4">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center bg-[var(--mk-forest)] font-serif text-sm font-bold text-[#fffaf2]">
                  {item.step}
                </span>
                <div>
                  <h3 className="font-serif text-lg font-bold">{item.title}</h3>
                  <p className="mk-lead mt-1 text-sm">{item.body}</p>
                </div>
              </li>
            ))}
          </ol>
          <Link to="/fees" className="mk-btn mk-btn-primary mt-10">
            Pay fees
          </Link>
        </div>
        <div className="overflow-hidden">
          <img
            src="/landing-fees.jpg"
            alt="A parent paying school fees on a phone"
            className="mk-photo h-72 sm:h-[26rem]"
            loading="lazy"
          />
        </div>
      </div>
    </section>

    <section id="security" className="scroll-mt-24 bg-[var(--mk-forest-deep)] px-5 py-20 text-[#f4efe6] sm:px-7 lg:px-8 lg:py-28">
      <div className="mx-auto max-w-[1120px]">
        <div className="grid items-center gap-10 lg:grid-cols-12">
          <div className="lg:col-span-6">
            <p className="mk-kicker mk-kicker-light">Security</p>
            <h2 className="mt-3 font-serif text-3xl font-bold tracking-tight sm:text-4xl">
              Built to keep school data authentic and protected
            </h2>
            <p className="mt-5 text-base leading-relaxed text-[#d8cfc0] sm:text-lg">
              Schooltype treats school records as sensitive operational data. Access is authenticated,
              schools are isolated from each other, and critical actions stay behind verified sessions
              and plan-approved roles.
            </p>
          </div>
          <div className="overflow-hidden lg:col-span-6">
            <img
              src="/landing-security.jpg"
              alt="A school administrator reviewing records in a quiet office"
              className="mk-photo h-56 sm:h-72"
              loading="lazy"
            />
          </div>
        </div>
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {SECURITY_POINTS.map((item) => (
            <article key={item.title} className="border border-[rgba(240,224,184,0.14)] bg-[rgba(255,250,242,0.04)] p-6">
              <h3 className="font-serif text-lg font-bold text-[#fffaf2]">{item.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-[#d8cfc0]">{item.body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>

    <FaqSection />
  </MarketingChrome>
);

export default Home;
