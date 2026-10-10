import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PLAN_LIST, formatPlanPriceGhs, formatPlanPriceUsd } from '../constants/plans';
import { Check, ArrowLeft } from 'lucide-react';

const Plans = () => {
  const navigate = useNavigate();
  const [selectedPlan, setSelectedPlan] = useState(
    PLAN_LIST.find((p) => p.highlighted)?.id || PLAN_LIST[0]?.id || ''
  );

  const handleContinue = () => {
    if (!selectedPlan) return;
    navigate(`/signup?plan=${selectedPlan}`);
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-950 font-sans text-white">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 60% 45% at 10% 0%, rgba(52, 152, 219, 0.18), transparent 55%), radial-gradient(ellipse 45% 40% at 100% 20%, rgba(39, 174, 96, 0.1), transparent 50%), #020617',
        }}
      />

      <div className="relative z-10 mx-auto max-w-6xl px-6 py-8 md:py-12">
        <div className="flex items-center justify-between gap-4">
          <Link to="/" className="font-display text-xl font-extrabold tracking-tight text-white">
            SCHOOLTYPE
          </Link>
          <Link
            to="/login"
            className="text-sm font-medium text-slate-300 transition hover:text-white"
          >
            Already have an account? Sign in
          </Link>
        </div>

        <div className="mt-12 text-center md:mt-16">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-sky-300/90">
            Step 1 of 2
          </p>
          <h1 className="mt-4 font-display text-3xl font-bold tracking-tight text-white md:text-5xl">
            Choose your plan
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-base text-slate-300">
            Annual pricing by school size (USD and GHS). You’ll pay next — the school account is created only after
            payment succeeds, and every plan feature unlocks immediately.
          </p>
        </div>

        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {PLAN_LIST.map((plan) => {
            const selected = selectedPlan === plan.id;
            return (
              <button
                key={plan.id}
                type="button"
                onClick={() => setSelectedPlan(plan.id)}
                className={`relative flex flex-col rounded-3xl border p-6 text-left transition md:p-7 ${
                  selected
                    ? 'border-sky-400/70 bg-sky-500/10 ring-2 ring-sky-400/40'
                    : 'border-slate-700/80 bg-slate-900/50 hover:border-slate-500'
                }`}
              >
                {plan.highlighted && (
                  <span className="absolute -top-3 left-6 rounded-full bg-sky-500 px-3 py-1 text-xs font-semibold text-white">
                    Most popular
                  </span>
                )}
                <h2 className="font-display text-xl font-bold text-white">{plan.name}</h2>
                <p className="mt-1 text-sm font-medium text-sky-300">{plan.sizeLabel}</p>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">{plan.description}</p>
                <div className="mt-6 space-y-1">
                  <p className="font-display text-2xl font-bold text-white">{formatPlanPriceGhs(plan)}</p>
                  <p className="text-sm text-slate-400">{formatPlanPriceUsd(plan)} / year</p>
                </div>
                <ul className="mt-6 flex-1 space-y-2.5">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2 text-sm text-slate-200">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                      {feature}
                    </li>
                  ))}
                </ul>
                <span
                  className={`mt-6 block w-full rounded-xl py-2.5 text-center text-sm font-semibold ${
                    selected
                      ? 'bg-sky-500 text-white'
                      : 'bg-slate-800 text-slate-300'
                  }`}
                >
                  {selected ? 'Selected' : 'Select plan'}
                </span>
              </button>
            );
          })}
        </div>

        <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
          <button
            type="button"
            onClick={handleContinue}
            disabled={!selectedPlan}
            className="w-full rounded-full bg-sky-500 px-8 py-3.5 text-sm font-semibold text-white shadow-lg shadow-sky-500/25 transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          >
            Continue to pay & register
          </button>
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-sm text-slate-400 transition hover:text-slate-200"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to home
          </Link>
        </div>
      </div>
    </div>
  );
};

export default Plans;
