import { useState, useEffect } from 'react';
import { useNavigate, Link, useSearchParams, Navigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useAuth, getPostAuthPath } from '../contexts/authcontext';
import { getPlan, formatPlanPriceGhs } from '../constants/plans';
import { User, Mail, ImagePlus, ShieldCheck } from 'lucide-react';
import AuthSplitLayout, { AuthBrandMark, AuthField, AUTH_ORANGE } from '../components/AuthSplitLayout';
import GoogleSignInButton from '../components/GoogleSignInButton';

const Signup = () => {
  const navigate = useNavigate();
  const { signup, loginWithGoogle } = useAuth();
  const [searchParams] = useSearchParams();
  const planParam = searchParams.get('plan');
  const selectedPlan = planParam ? getPlan(planParam) : null;

  const [loading, setLoading] = useState(false);
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

  const openPaystack = (data) => {
    if (data?.authorization_url) {
      toast.success('Continue on Paystack. Choose MoMo, card, or bank. MoMo sends a PIN to the phone.');
      window.location.assign(data.authorization_url);
      return true;
    }
    return false;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!privacyAccepted) {
      toast.error('Please accept the privacy notice to create an account.');
      return;
    }
    setLoading(true);
    try {
      const data = await signup(formData.schoolName, formData.email, null, logo, planParam);
      if (openPaystack(data)) return;
      toast.success(
        data.emailSendFailed
          ? 'Account started. We could not send email — use Resend on the sign-in page.'
          : 'Check your email to continue. Open the link to verify and choose a password.'
      );
      navigate('/login', {
        replace: true,
        state: {
          pendingVerificationEmail: data.email || formData.email,
          emailSendFailed: Boolean(data.emailSendFailed),
        },
      });
    } catch (error) {
      toast.error(error.response?.data?.error || error.response?.data?.message || 'Signup failed');
    } finally {
      setLoading(false);
    }
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

      <form onSubmit={handleSubmit} className="mt-8 space-y-4">
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

          <GoogleSignInButton
            label="Sign up with Google"
            disabled={loading || !privacyAccepted}
            onCredential={async ({ accessToken }) => {
              if (!formData.schoolName.trim()) {
                toast.error('Enter your school name first, then continue with Google.');
                return;
              }
              if (!privacyAccepted) {
                toast.error('Please accept the privacy notice to create an account.');
                return;
              }
              const data = await loginWithGoogle({
                accessToken,
                schoolName: formData.schoolName.trim(),
                logo,
                paymentPlan: planParam,
                privacyAccepted: true,
              });
              if (openPaystack(data)) return;
              toast.success('Account ready. Welcome to Schooltype.');
              navigate(getPostAuthPath(data.school), { replace: true });
            }}
          />

          <div className="relative my-2 text-center text-[11px] uppercase tracking-[0.14em] text-neutral-500">
            <span className="absolute inset-x-0 top-1/2 h-px bg-neutral-700" />
            <span className="relative bg-[#121212] px-3">or continue with email</span>
          </div>

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
              Pay on Paystack, then verify email
            </p>
            <p className="mt-1 pl-6">
              Paystack collects MoMo, card, or bank details. For MoMo, enter the number there so the PIN prompt is sent
              to the phone. After payment we email a link so you can verify ownership and choose a password.
            </p>
          </div>

          <button
            type="submit"
            disabled={loading || !privacyAccepted}
            className="auth-accent mt-2 w-full rounded-xl py-3.5 text-sm font-semibold text-white transition disabled:opacity-50"
          >
            {loading ? 'Opening Paystack…' : 'Pay & create account'}
          </button>
        </form>

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
