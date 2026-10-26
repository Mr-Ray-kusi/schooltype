import { Link } from 'react-router-dom';
import { GraduationCap } from 'lucide-react';

export const AUTH_FOREST = '#123028';
export const AUTH_CLAY = '#a3472a';
export const AUTH_ORANGE = AUTH_CLAY;

export function AuthBrandMark({ compact = false }) {
  return (
    <Link to="/" className="inline-flex items-center gap-2.5">
      <span className="flex h-9 w-9 items-center justify-center rounded-md bg-[#123028] text-[#fffaf2] shadow-sm">
        <GraduationCap className="h-5 w-5" strokeWidth={2.25} />
      </span>
      <span className="leading-none">
        <span className="block text-[12px] font-extrabold tracking-[0.16em] text-[#123028]">SCHOOLTYPE</span>
        {!compact && (
          <span className="mt-0.5 block text-[9px] font-medium tracking-[0.2em] text-[#5c564c]">
            Connect. Track. Manage.
          </span>
        )}
      </span>
    </Link>
  );
}

function PromoPanel({ mode }) {
  const isSignup = mode === 'signup';

  return (
    <div className="relative flex min-h-[280px] flex-col overflow-hidden bg-[#123028] px-8 py-10 text-[#fffaf2] md:min-h-[640px] md:px-12 md:py-12">
      <img
        src="/landing-hero.jpg"
        alt=""
        className="absolute inset-0 h-full w-full object-cover opacity-35"
      />
      <div className="absolute inset-0 bg-[#0b1f1a]/72" />

      <div className="relative flex flex-1 flex-col items-center justify-center text-center">
        <div className="mb-6 flex items-center gap-1.5">
          {[0, 1, 2, 3].map((i) => (
            <span
              key={i}
              className={`h-1 rounded-full ${i === 0 ? 'w-7 bg-[#e4c778]' : 'w-5 bg-white/35'}`}
            />
          ))}
        </div>

        <span className="mb-5 inline-flex items-center gap-1.5 rounded-full border border-[rgba(228,199,120,0.45)] bg-black/15 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#e4c778]">
          <GraduationCap className="h-3 w-3" />
          Schooltype
        </span>

        <h2 className="max-w-xs font-serif text-[2rem] font-bold leading-tight md:text-[2.35rem]">
          {isSignup ? "You're Welcome." : 'New to the crew?'}
        </h2>
        <p className="mt-4 max-w-sm text-sm leading-relaxed text-[#efe6d6] md:text-[15px]">
          {isSignup
            ? 'Sign in to keep the school moving.'
            : 'Create your school account and put academics to work in minutes.'}
        </p>

        <Link
          to={isSignup ? '/login' : '/plans'}
          className="auth-accent mt-8 inline-flex min-w-[160px] items-center justify-center rounded-sm px-8 py-2.5 text-sm font-semibold text-[#fffaf2] shadow-md transition hover:bg-[#8c3b22]"
        >
          {isSignup ? 'Sign in' : 'Create account'}
        </Link>
      </div>

      <p className="relative mt-8 text-center text-xs italic text-[#d8cfc0] md:mt-0">
        {isSignup
          ? "Let's build, manage and organise all school activities"
          : '"Every school deserves a connected academic life."'}
      </p>
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
      <span className="mb-1.5 block text-[13px] font-medium text-[#1a1712]">{label}</span>
      <span className="relative flex items-center">
        {Icon ? <Icon className="pointer-events-none absolute left-3 h-4 w-4 text-[#5c564c]" /> : null}
        <input
          type={type}
          name={name}
          value={value}
          onChange={onChange}
          required={required}
          placeholder={placeholder}
          className={`auth-field w-full rounded-sm py-3 text-base ${
            Icon ? 'pl-10' : 'pl-3.5'
          } ${rightSlot ? 'pr-11' : 'pr-3.5'}`}
        />
        {rightSlot ? <span className="absolute right-3 flex items-center">{rightSlot}</span> : null}
      </span>
    </label>
  );
}

export default function AuthSplitLayout({ mode = 'login', children }) {
  const isSignup = mode === 'signup';

  return (
    <div className="auth-page relative min-h-dvh overflow-x-clip overflow-y-auto bg-[#123028] font-sans text-[#1a1712]">
      <div
        aria-hidden
        className="absolute inset-0 scale-105 bg-cover bg-center"
        style={{
          backgroundImage:
            "linear-gradient(rgba(11,31,26,.78), rgba(11,31,26,.86)), url('/landing-hero.jpg')",
        }}
      />

      <div className="relative z-10 mx-auto flex min-h-dvh max-w-6xl flex-col px-3 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] sm:px-4 sm:py-6 md:px-8 md:py-8">
        <div className="mx-auto grid w-full max-w-5xl flex-1 overflow-hidden rounded-2xl bg-[#fffaf2] shadow-2xl shadow-black/30 sm:rounded-[28px] md:min-h-[640px] md:grid-cols-2">
          <div className={`order-1 ${isSignup ? 'md:order-2' : 'md:order-1'}`}>
            <div className="flex h-full flex-col justify-center px-5 py-7 sm:px-10 md:px-12">{children}</div>
          </div>
          <div className={`hidden md:block ${isSignup ? 'md:order-1' : 'md:order-2'}`}>
            <PromoPanel mode={mode} />
          </div>
        </div>
      </div>
    </div>
  );
}
