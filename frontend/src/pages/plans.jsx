import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PLAN_LIST, formatPlanPriceGhs } from '../constants/plans';
import MarketingChrome from '../components/MarketingChrome';

const Plans = () => {
  const navigate = useNavigate();
  const [selectedPlan, setSelectedPlan] = useState(
    PLAN_LIST.find((p) => p.highlighted)?.id || PLAN_LIST[0]?.id || ''
  );

  return (
    <MarketingChrome active="home">
      <div className="mk-page">
        <div className="mk-wrap">
          <p className="mk-kicker">Step 1 of 2</p>
          <h1 className="mt-3 font-serif text-4xl font-bold tracking-tight sm:text-5xl">Choose your plan</h1>
          <p className="mk-lead mt-4 max-w-2xl text-base sm:text-lg">
            Annual pricing by school size in Ghana cedis. You pay next. The school account is created
            only after payment succeeds, and every plan feature unlocks immediately.
          </p>
          <Link to="/login" className="mt-4 inline-block text-sm font-semibold text-[var(--mk-forest)] underline-offset-2 hover:underline">
            Already have an account? Sign in
          </Link>

          <div className="mt-10 grid gap-4 lg:grid-cols-3">
            {PLAN_LIST.map((plan) => {
              const selected = selectedPlan === plan.id;
              return (
                <button
                  key={plan.id}
                  type="button"
                  onClick={() => setSelectedPlan(plan.id)}
                  className={`mk-card relative flex flex-col p-6 text-left transition sm:p-7 ${
                    selected ? 'ring-2 ring-[var(--mk-brass)]' : ''
                  }`}
                >
                  {plan.highlighted ? (
                    <span className="absolute -top-3 left-6 bg-[var(--mk-clay)] px-3 py-1 text-xs font-bold text-[#fffaf2]">
                      Most popular
                    </span>
                  ) : null}
                  <h2 className="font-serif text-2xl font-bold">{plan.name}</h2>
                  <p className="mt-1 text-sm font-semibold text-[var(--mk-forest)]">{plan.sizeLabel}</p>
                  <p className="mt-4 font-serif text-3xl font-bold">
                    {formatPlanPriceGhs(plan)} <span className="text-base font-sans font-semibold text-[var(--mk-muted)]">per year</span>
                  </p>
                  <p className="mk-lead mt-3 text-sm">{plan.description}</p>
                </button>
              );
            })}
          </div>

          <div className="mt-10 flex flex-col items-start gap-4 sm:flex-row sm:items-center">
            <button
              type="button"
              onClick={() => selectedPlan && navigate(`/signup?plan=${selectedPlan}`)}
              disabled={!selectedPlan}
              className="mk-btn mk-btn-primary disabled:opacity-50"
            >
              Continue to signup
            </button>
            <Link to="/fees" className="text-sm font-semibold text-[var(--mk-forest)] underline-offset-2 hover:underline">
              Pay fees
            </Link>
          </div>
        </div>
      </div>
    </MarketingChrome>
  );
};

export default Plans;
