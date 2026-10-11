import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useAuth } from '../contexts/authcontext';
import { PLAN_LIST, formatPlanPriceGhs, formatPlanPriceUsd } from '../constants/plans';
import { Check, School } from 'lucide-react';
import SubscriptionMomoPrompt, { momoNetworkFromPhone } from '../components/SubscriptionMomoPrompt';

const SelectPlan = () => {
  const { school, selectPlan, token, completePaidSignup, storeSessionFromAuth, refreshSchool } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [selectedPlan, setSelectedPlan] = useState(
    searchParams.get('plan') || school?.payment_plan || ''
  );
  const [loading, setLoading] = useState(false);
  const [phone, setPhone] = useState('');
  const [momoPrompt, setMomoPrompt] = useState(null);

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

  const finishPaidPlan = async (payload) => {
    let data = payload;
    if (!data?.ok) {
      data = await completePaidSignup(payload?.reference || momoPrompt?.reference);
    } else if (data.token && data.school) {
      storeSessionFromAuth(data);
    } else if (data.school) {
      await refreshSchool?.();
    }
    setMomoPrompt(null);
    toast.success('Payment received. All features are unlocked.');
    navigate('/dashboard');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedPlan) {
      toast.error('Please select a payment plan');
      return;
    }
    if (!phone.trim()) {
      toast.error('Enter the MoMo number so the PIN prompt can be sent to the phone.');
      return;
    }

    setLoading(true);
    try {
      const data = await selectPlan(selectedPlan, {
        phone,
        provider: momoNetworkFromPhone(phone),
      });
      if (data.alreadyPaid) {
        toast.success('Plan is active. All features are unlocked.');
        navigate('/dashboard');
        return;
      }
      if (data.status === 'success') {
        await finishPaidPlan(data.fulfillment || data);
        return;
      }
      if (data.authorization_url && data.status === 'open_url') {
        window.location.assign(data.authorization_url);
        return;
      }
      if (data.mode === 'momo' || data.reference) {
        toast.success('Approve the PIN on your phone to complete payment.');
        setMomoPrompt({
          reference: data.reference,
          display_text: data.display_text,
          needs_code: Boolean(data.needs_code),
          code_type: data.code_type,
        });
        return;
      }
      if (data.authorization_url) {
        window.location.assign(data.authorization_url);
        return;
      }
      toast.success('Plan is active. All features are unlocked.');
      navigate('/dashboard');
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to select plan');
    } finally {
      setLoading(false);
    }
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

        <form onSubmit={handleSubmit}>
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

          <div className="mx-auto mb-8 max-w-md">
            <label className="block text-sm text-slate-300">
              MoMo number
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
                placeholder="0551234567"
                className="mt-2 w-full rounded-xl border border-slate-600 bg-slate-800 px-4 py-3 text-white outline-none focus:border-sky-500"
              />
            </label>
            <p className="mt-2 text-xs text-slate-400">
              A PIN prompt is sent to this number. Approve it on the phone to complete subscription payment.
            </p>
          </div>

          {momoPrompt ? (
            <div className="mx-auto mb-8 max-w-md">
              <SubscriptionMomoPrompt
                prompt={momoPrompt}
                onPromptChange={setMomoPrompt}
                onSuccess={finishPaidPlan}
                onCancel={(message) => {
                  setMomoPrompt(null);
                  setLoading(false);
                  toast.error(message);
                }}
                dark={false}
              />
            </div>
          ) : null}

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <button
              type="submit"
              disabled={loading || !selectedPlan || Boolean(momoPrompt)}
              className="px-8 py-3 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white rounded-lg font-medium transition-colors"
            >
              {loading ? 'Sending PIN prompt…' : 'Pay & unlock features'}
            </button>
            <Link to="/" className="text-slate-300 hover:text-slate-200 text-sm">
              Back to home
            </Link>
          </div>
        </form>
      </main>
    </div>
  );
};

export default SelectPlan;
