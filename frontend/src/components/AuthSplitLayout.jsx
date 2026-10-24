import { Link } from 'react-router-dom';
import MarketingChrome from './MarketingChrome';

export const AUTH_ORANGE = '#a3472a';

export function AuthBrandMark() {
  return (
    <div>
      <p className="mk-kicker">SCHOOLTYPE</p>
      <p className="mt-1 text-sm text-[var(--mk-muted)]">Connect. Track. Manage.</p>
    </div>
  );
}

export function AuthField({
  label,
  icon: Icon,
  type = 'text',
  value,
  onChange,
  name,
  placeholder,
  required,
  rightSlot,
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-semibold text-[var(--mk-ink)]">{label}</span>
      <span className="relative flex items-center">
        {Icon ? <Icon className="pointer-events-none absolute left-3 h-4 w-4 text-[var(--mk-muted)]" /> : null}
        <input
          type={type}
          name={name}
          value={value}
          onChange={onChange}
          required={required}
          placeholder={placeholder}
          className={`mk-field ${Icon ? 'pl-10' : ''} ${rightSlot ? 'pr-11' : ''}`}
        />
        {rightSlot ? <span className="absolute right-3 flex items-center">{rightSlot}</span> : null}
      </span>
    </label>
  );
}

export default function AuthSplitLayout({
  mode = 'login',
  planName,
  planPrice,
  children,
}) {
  const isSignup = mode === 'signup';

  return (
    <MarketingChrome active={isSignup ? 'home' : 'home'}>
      <div className="mk-page">
        <div className="mk-wrap grid overflow-hidden border border-[var(--mk-line)] bg-[var(--mk-card)] lg:min-h-[640px] lg:grid-cols-2">
          <aside className="relative hidden min-h-[280px] lg:block">
            <img
              src={isSignup ? '/landing-about.jpg' : '/landing-security.jpg'}
              alt={isSignup ? 'A teacher helping students in class' : 'A school administrator reviewing records in a quiet office'}
              className="absolute inset-0 h-full w-full object-cover"
            />
            <div className="absolute inset-0 bg-[var(--mk-forest-deep)]/78" />
            <div className="relative z-10 flex h-full flex-col justify-between p-10 text-[#fffaf2]">
              <div>
                <p className="mk-kicker mk-kicker-light">SCHOOLTYPE</p>
                <p className="mt-2 text-sm text-[#d8cfc0]">Connect. Track. Manage.</p>
              </div>
              <div>
                <h2 className="font-serif text-4xl font-bold leading-tight">
                  {isSignup ? 'Create account' : 'Sign in'}
                </h2>
                {isSignup && planName ? (
                  <p className="mt-4 text-lg text-[#efe6d6]">
                    {planName}, {planPrice} per year
                  </p>
                ) : (
                  <p className="mt-4 max-w-sm text-sm leading-relaxed text-[#d8cfc0]">
                    The central connection point for all your school academic activities
                  </p>
                )}
                <div className="mt-8 flex flex-wrap gap-3">
                  <Link to="/plans" className="mk-btn mk-btn-primary">
                    Get started
                  </Link>
                  <Link to="/fees" className="mk-btn mk-btn-secondary">
                    Pay fees
                  </Link>
                </div>
              </div>
            </div>
          </aside>
          <div className="flex flex-col justify-center px-5 py-8 sm:px-10">{children}</div>
        </div>
      </div>
    </MarketingChrome>
  );
}
