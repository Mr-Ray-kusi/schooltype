import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useAuth } from '../contexts/authcontext';
import { PLAN_LIST, formatPlanPriceGhs, formatPlanPriceUsd } from '../constants/plans';
import { Check, School } from 'lucide-react';
import PlanCheckoutPay from '../components/PlanCheckoutPay';

const SelectPlan = () => {
  const { school, selectPlan, token, storeSessionFromAuth, refreshSchool } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [selectedPlan, setSelectedPlan] = useState(
    searchParams.get('plan') || school?.payment_plan || ''
  );

  useEffect(() => {
    if (!selectedPlan && school?.payment_plan) {
      setSelectedPlan(school.payment_plan);
    }
  }, [school?.payment_plan, selectedPlan]);

  useEffect(() => {
    if (!token) {
      navigate('/login', { replace: true });
      return;
    }
    if (school?.role === 'super_admin') {
      navigate('/super-admin', { replace: true });
      return;
    }
    if (school?.plan_approved === true || school?.plan_status === 'approved') {
      navigate('/dashboard', { replace: true });
    }
  }, [token, school, navigate]);

  const afterPaid = async (data) => {
    if (data?.token && data?.school) {
      storeSessionFromAuth(data);
    } else {
      await refreshSchool().catch(() => {});
    }
    toast.success('Plan is active. All features are unlocked.');
    navigate('/dashboard');
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-50">
      <header className="border-b border-slate-700">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center gap-2">
          <School className="w-7 h-7 text-primary-400" />
          <span className="text-lg font-bold text-white">SCHOOLTYPE</span>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-12">
        <div className="text-center mb-12">
          <h1 className="text-3xl font-bold text-white">Pay to unlock your school</h1>
          <p className="text-slate-300 mt-2">
            Welcome, {school?.name}! Complete payment for a plan to create access and unlock every feature.
          </p>
        </div>

        <div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            {PLAN_LIST.map((plan) => (
              <label
                key={plan.id}
                className={`cursor-pointer rounded-2xl border p-6 transition-all ${
                  selectedPlan === plan.id
                    ? 'border-primary-500 bg-primary-500/10 ring-2 ring-primary-500'
                    : 'border-slate-600 bg-slate-800 hover:border-slate-500'
                }`}
              >
                <input
                  type="radio"
                  name="plan"
                  value={plan.id}
                  checked={selectedPlan === plan.id}
                  onChange={(e) => setSelectedPlan(e.target.value)}
                  className="sr-only"
                />
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div>
                    <h3 className="text-lg font-bold text-white">{plan.name}</h3>
                    <p className="text-xs text-sky-300 mt-1">{plan.sizeLabel}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-primary-400 font-semibold text-sm">{formatPlanPriceGhs(plan)}</p>
                    <p className="text-xs text-slate-400">{formatPlanPriceUsd(plan)} / yr</p>
                  </div>
                </div>
                <ul className="space-y-2">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2 text-sm text-slate-200">
                      <Check className="w-4 h-4 text-green-400 mt-0.5 shrink-0" />
                      {feature}
                    </li>
                  ))}
                </ul>
              </label>
            ))}
          </div>

          <div className="mx-auto max-w-xl">
            <PlanCheckoutPay
              dark={false}
              submitLabel="Pay & unlock features"
              startPayment={async ({ method, phone, provider }) => {
                if (!selectedPlan) {
                  toast.error('Please select a payment plan');
                  throw new Error('Please select a payment plan');
                }
                return selectPlan(selectedPlan, { method, phone, provider });
              }}
              onPaid={afterPaid}
            />
            <div className="mt-4 text-center">
              <Link to="/" className="text-slate-300 hover:text-slate-200 text-sm">
                Back to home
              </Link>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default SelectPlan;
