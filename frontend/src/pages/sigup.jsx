import { useState, useEffect } from 'react';
import { useNavigate, Link, useSearchParams, Navigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useAuth, getPostAuthPath } from '../contexts/authcontext';
import { getPlan, formatPlanPriceGhs } from '../constants/plans';
import { User, Mail, ImagePlus, ShieldCheck } from 'lucide-react';
import AuthSplitLayout, { AuthBrandMark, AuthField, AUTH_ORANGE } from '../components/AuthSplitLayout';
import GoogleSignInButton from '../components/GoogleSignInButton';
import PlanCheckoutPay from '../components/PlanCheckoutPay';

const Signup = () => {
  const navigate = useNavigate();
  const { signup, loginWithGoogle, completePaidSignup, storeSessionFromAuth } = useAuth();
  const [searchParams] = useSearchParams();
  const planParam = searchParams.get('plan');
  const selectedPlan = planParam ? getPlan(planParam) : null;

  const [step, setStep] = useState('identity');
  const [formData, setFormData] = useState({
    email: '',
    schoolName: '',
  });
  const [logo, setLogo] = useState(null);
  const [logoPreview, setLogoPreview] = useState(null);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);

  useEffect(() => {
    if (planParam && !selectedPlan) {
      toast.error('Invalid plan selected');
    }
  }, [planParam, selectedPlan]);

  if (!planParam || !selectedPlan) {
    return <Navigate to="/plans" replace />;
  }

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  const handleLogoChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file');
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      toast.error('Logo must be smaller than 2MB');
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      setLogo(reader.result);
      setLogoPreview(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveLogo = () => {
    setLogo(null);
    setLogoPreview(null);
  };

  const goToPayment = (e) => {
    e.preventDefault();
    if (!privacyAccepted) {
      toast.error('Please accept the privacy notice to create an account.');
      return;
    }
    if (!formData.schoolName.trim() || !formData.email.trim()) {
      toast.error('Enter the school name and email first.');
      return;
    }
    setStep('payment');
  };

  const afterPaid = async (data) => {
    if (data?.token && data?.school) {
      storeSessionFromAuth(data);
      toast.success('Payment received. Your school account is ready.');
      navigate(getPostAuthPath(data.school), { replace: true });
      return;
    }
    if (data?.reference && !data?.requiresEmailVerification && !data?.email) {
      const completed = await completePaidSignup(data.reference);
      return afterPaid(completed);
    }
    toast.success(
      data?.emailSendFailed
        ? 'Payment received. We could not send email — use Resend on the sign-in page.'
        : 'Payment received. Check your email to verify and choose a password.'
    );
    navigate('/login', {
      replace: true,
      state: {
        pendingVerificationEmail: data?.email || formData.email,
        emailSendFailed: Boolean(data?.emailSendFailed),
      },
    });
  };

  return (
    <AuthSplitLayout mode="signup">
      <AuthBrandMark />
      <div className="mt-6">
        <h1 className="text-[2rem] font-bold leading-tight text-white">Join the crew</h1>
        <p className="mt-2 text-sm text-neutral-400">
          Pay for {selectedPlan.name} — {formatPlanPriceGhs(selectedPlan)} / year, then your school account is created and unlocked.
        </p>
        <Link to="/plans" className="mt-1 inline-block text-xs hover:underline" style={{ color: AUTH_ORANGE }}>
          Change plan
        </Link>
      </div>

      {step === 'identity' ? (
        <form onSubmit={goToPayment} className="mt-8 space-y-4">
          <AuthField
            label="School name"
            icon={User}
            name="schoolName"
            value={formData.schoolName}
            onChange={handleChange}
            required
            placeholder="Bright Future Academy"
          />

          <div>
            <span className="mb-1.5 block text-[13px] font-medium text-neutral-300">
              School logo <span className="font-normal text-neutral-500">(optional)</span>
            </span>
            {logoPreview ? (
              <div className="flex items-center gap-3 rounded-xl border border-[#3f3f3f] bg-[#1a1a1a] px-3 py-2">
                <img src={logoPreview} alt="Logo preview" className="h-11 w-11 rounded-lg object-cover" />
                <button type="button" onClick={handleRemoveLogo} className="text-sm text-red-400 hover:text-red-300">
                  Remove
                </button>
              </div>
            ) : (
              <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-[#3f3f3f] bg-[#1a1a1a] px-3 py-3 text-sm text-neutral-400 transition hover:border-[#3498DB]/50">
                <ImagePlus className="h-4 w-4 text-neutral-500" />
                <span>Upload a logo</span>
                <input type="file" accept="image/*" onChange={handleLogoChange} className="hidden" />
              </label>
            )}
          </div>

          <label className="flex items-start gap-3 rounded-xl border border-[#3f3f3f] bg-[#1a1a1a] px-3 py-3 text-xs text-neutral-300">
            <input
              type="checkbox"
              checked={privacyAccepted}
              onChange={(e) => setPrivacyAccepted(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-[#3498DB]"
              required
            />
            <span>
              I have read the{' '}
              <Link to="/privacy" className="font-medium hover:underline" style={{ color: AUTH_ORANGE }}>
                privacy notice
              </Link>
              . Schooltype will use this email to create and operate my school account.
            </span>
          </label>

          <AuthField
            label="Email"
            icon={Mail}
            type="email"
            name="email"
            value={formData.email}
            onChange={handleChange}
            required
            placeholder="admin@school.com"
          />

          <div className="rounded-xl border border-[#3f3f3f] bg-[#1a1a1a] px-3 py-3 text-xs text-neutral-400">
            <p className="flex items-center gap-2 font-medium text-neutral-300">
              <ShieldCheck className="h-4 w-4 text-[#3498DB]" />
              Pay first, then verify email
            </p>
            <p className="mt-1 pl-6">
              Next you choose MoMo, card, or bank. MoMo sends a PIN to the phone through Paystack. After payment we
              email a link so you can verify ownership and choose a password.
            </p>
          </div>

          <button
            type="submit"
            disabled={!privacyAccepted}
            className="auth-accent mt-2 w-full rounded-xl py-3.5 text-sm font-semibold text-white transition disabled:opacity-50"
          >
            Continue to payment
          </button>
        </form>
      ) : (
        <div className="mt-8">
          <button
            type="button"
            onClick={() => setStep('identity')}
            className="mb-4 text-xs hover:underline"
            style={{ color: AUTH_ORANGE }}
          >
            Back to school details
          </button>
          <PlanCheckoutPay
            submitLabel="Pay & create account"
            startPayment={({ method, phone, provider }) =>
              signup(formData.schoolName, formData.email, null, logo, planParam, { method, phone, provider })
            }
            onPaid={afterPaid}
            extraActions={({ method, phone, provider }) =>
              method === 'momo' ? null : (
                <GoogleSignInButton
                  label="Pay with Google account"
                  disabled={!privacyAccepted}
                  onCredential={async ({ accessToken }) => {
                    const data = await loginWithGoogle({
                      accessToken,
                      schoolName: formData.schoolName.trim(),
                      logo,
                      paymentPlan: planParam,
                      privacyAccepted: true,
                      method,
                      phone,
                      provider,
                    });
                    if (data.authorization_url) {
                      window.location.assign(data.authorization_url);
                      return;
                    }
                    toast.success('Account ready. Welcome to Schooltype.');
                    navigate(getPostAuthPath(data.school), { replace: true });
                  }}
                />
              )
            }
          />
        </div>
      )}

      <p className="mt-6 text-center text-sm text-neutral-400">
        Already registered?{' '}
        <Link to="/login" className="font-semibold hover:underline" style={{ color: AUTH_ORANGE }}>
          Sign in
        </Link>
      </p>
      <p className="mt-3 text-center text-xs text-neutral-500">
        <Link to="/privacy" className="hover:underline">
          Privacy notice
        </Link>
      </p>
    </AuthSplitLayout>
  );
};

export default Signup;
