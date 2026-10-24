import { useState, useEffect } from 'react';
import { useNavigate, Link, useSearchParams, Navigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useAuth, getPostAuthPath } from '../contexts/authcontext';
import { getPlan, formatPlanPriceGhs } from '../constants/plans';
import MarketingChrome from '../components/MarketingChrome';
import GoogleSignInButton from '../components/GoogleSignInButton';
import { openPaystackCheckout } from '../utils/paystackCheckout';

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
    if (!data?.authorization_url) return false;
    const opened = openPaystackCheckout(data);
    if (opened) toast.success('Choose MoMo, card, or bank on Paystack.');
    return opened;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!privacyAccepted) {
      toast.error('Please accept the Privacy notice to create an account.');
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

  const planPrice = formatPlanPriceGhs(selectedPlan);

  return (
    <MarketingChrome>
      <div className="mk-page">
        <div className="mx-auto max-w-xl">
      <p className="mk-kicker">Step 2 of 2</p>
      <h1 className="mt-3 font-serif text-3xl font-bold text-[var(--mk-ink)]">Create account</h1>
      <p className="mt-2 text-sm text-[var(--mk-muted)]">
        {selectedPlan.name}, {planPrice} per year
      </p>

      <form onSubmit={handleSubmit} className="mt-8 space-y-4">
        <label className="block text-sm font-semibold">
          School name
          <input
            className="mk-field mt-1.5"
            name="schoolName"
            value={formData.schoolName}
            onChange={handleChange}
            required
            placeholder="Bright Future Academy"
          />
        </label>
        <label className="block text-sm font-semibold">
          Administrator email
          <input
            className="mk-field mt-1.5"
            type="email"
            name="email"
            value={formData.email}
            onChange={handleChange}
            required
            placeholder="admin@school.com"
          />
        </label>

        <div>
          <span className="mb-1.5 block text-sm font-semibold text-[var(--mk-ink)]">
            School logo <span className="font-normal text-[var(--mk-muted)]">(image, max 2MB, optional)</span>
          </span>
          {logoPreview ? (
            <div className="flex items-center gap-3 border border-[var(--mk-line)] bg-[var(--mk-paper)] px-3 py-2">
              <img src={logoPreview} alt="Logo preview" className="h-11 w-11 object-cover" />
              <button type="button" onClick={handleRemoveLogo} className="text-sm font-semibold text-[var(--mk-clay)]">
                Remove
              </button>
            </div>
          ) : (
            <label className="flex cursor-pointer items-center gap-3 border border-dashed border-[var(--mk-line)] bg-[var(--mk-paper)] px-3 py-3 text-sm text-[var(--mk-muted)]">
              <span>Upload a school logo</span>
              <input type="file" accept="image/*" onChange={handleLogoChange} className="hidden" />
            </label>
          )}
        </div>

        <label className="flex items-start gap-3 text-sm text-[var(--mk-ink)]">
          <input
            type="checkbox"
            checked={privacyAccepted}
            onChange={(e) => setPrivacyAccepted(e.target.checked)}
            className="mk-check mt-0.5 h-4 w-4 shrink-0"
            required
          />
          <span>
            I agree to the{' '}
            <Link to="/privacy" className="font-semibold text-[var(--mk-forest)] underline-offset-2 hover:underline">
              Privacy notice
            </Link>
          </span>
        </label>

        <button
          type="submit"
          disabled={loading || !privacyAccepted}
          className="mk-btn mk-btn-primary w-full disabled:opacity-50"
        >
          {loading ? 'Opening Paystack…' : 'Continue to payment'}
        </button>

        <GoogleSignInButton
          label="Sign up with Google"
          disabled={loading || !privacyAccepted}
          className="mk-google-btn"
          onCredential={async ({ accessToken }) => {
            if (!formData.schoolName.trim()) {
              toast.error('Enter your school name first, then continue with Google.');
              return;
            }
            if (!privacyAccepted) {
              toast.error('Please accept the Privacy notice to create an account.');
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
      </form>

      <p className="mt-6 text-sm leading-relaxed text-[var(--mk-muted)]">
        Payment is MoMo, card, or bank on Paystack. The account is created only after payment succeeds.
        A verification email is sent so the administrator can choose a password. There is no password
        field on this screen.
      </p>
      <p className="mt-5 text-sm">
        <Link to="/plans" className="font-semibold text-[var(--mk-forest)] underline-offset-2 hover:underline">
          Back to plans
        </Link>
        <span className="px-2 text-[var(--mk-line)]">·</span>
        <Link to="/login" className="font-semibold text-[var(--mk-forest)] underline-offset-2 hover:underline">
          Already have an account? Sign in
        </Link>
      </p>
        </div>
      </div>
    </MarketingChrome>
  );
};

export default Signup;
