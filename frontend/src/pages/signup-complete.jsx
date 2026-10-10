import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useAuth, getPostAuthPath } from '../contexts/authcontext';
import { ArrowLeft, CheckCircle2, Loader2, XCircle } from 'lucide-react';

const SignupComplete = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { completePaidSignup } = useAuth();
  const reference = searchParams.get('reference') || searchParams.get('trxref') || '';
  const [status, setStatus] = useState(reference ? 'loading' : 'missing');
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [needsVerify, setNeedsVerify] = useState(false);

  useEffect(() => {
    if (!reference) return;

    let cancelled = false;
    (async () => {
      try {
        const data = await completePaidSignup(reference);
        if (cancelled) return;
        setEmail(data.email || data.school?.email || '');
        setMessage(data.message || 'Payment received.');
        if (data.requiresEmailVerification) {
          setNeedsVerify(true);
          setStatus('verify');
          toast.success('Payment successful. Check your email to finish setup.');
          return;
        }
        setStatus('ready');
        toast.success('Payment successful. All features are unlocked.');
        navigate(getPostAuthPath(data.school), { replace: true });
      } catch (error) {
        if (cancelled) return;
        const data = error.response?.data;
        if (data?.pending) {
          setStatus('pending');
          setMessage(data.error || 'Payment is still processing. Refresh this page in a moment.');
          return;
        }
        setStatus('error');
        setMessage(data?.error || 'We could not confirm this payment.');
      }
    })();

    return () => {
      cancelled = true;
    };
    // confirm once per Paystack reference
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reference]);

  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-950 font-sans text-white">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 55% 40% at 0% 0%, rgba(52, 152, 219, 0.16), transparent 55%), #020617',
        }}
      />

      <div className="relative z-10 flex min-h-screen items-center justify-center px-4 py-10">
        <div className="w-full max-w-md rounded-3xl border border-slate-700/80 bg-slate-900/60 p-8 text-center">
          <Link to="/" className="font-display text-2xl font-extrabold tracking-tight text-white">
            SCHOOLTYPE
          </Link>

          {status === 'loading' && (
            <div className="mt-8 space-y-4">
              <Loader2 className="mx-auto h-10 w-10 animate-spin text-sky-400" />
              <h1 className="font-display text-2xl font-bold">Confirming payment…</h1>
              <p className="text-sm text-slate-400">Creating your school account and unlocking features.</p>
            </div>
          )}

          {status === 'pending' && (
            <div className="mt-8 space-y-4">
              <Loader2 className="mx-auto h-10 w-10 animate-spin text-amber-400" />
              <h1 className="font-display text-2xl font-bold">Payment still processing</h1>
              <p className="text-sm text-slate-300">{message}</p>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="mt-2 w-full rounded-full bg-sky-500 py-3 text-sm font-semibold text-white hover:bg-sky-400"
              >
                Check again
              </button>
            </div>
          )}

          {status === 'verify' && (
            <div className="mt-8 space-y-4">
              <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-400" />
              <h1 className="font-display text-2xl font-bold">Payment received</h1>
              <p className="text-sm text-slate-300">{message}</p>
              {email && <p className="text-xs text-slate-500">{email}</p>}
              {needsVerify && (
                <p className="text-sm text-slate-400">
                  Open the verification link we sent, choose a password, then sign in. All plan features are unlocked.
                </p>
              )}
              <button
                type="button"
                onClick={() =>
                  navigate('/login', {
                    replace: true,
                    state: { pendingVerificationEmail: email },
                  })
                }
                className="mt-2 w-full rounded-full bg-sky-500 py-3 text-sm font-semibold text-white hover:bg-sky-400"
              >
                Continue to sign in
              </button>
            </div>
          )}

          {status === 'ready' && (
            <div className="mt-8 space-y-4">
              <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-400" />
              <h1 className="font-display text-2xl font-bold">Account unlocked</h1>
              <p className="text-sm text-slate-300">{message || 'Redirecting to your dashboard…'}</p>
            </div>
          )}

          {(status === 'error' || status === 'missing') && (
            <div className="mt-8 space-y-4">
              <XCircle className="mx-auto h-10 w-10 text-amber-400" />
              <h1 className="font-display text-2xl font-bold">Payment needed</h1>
              <p className="text-sm text-slate-300">
                {status === 'missing'
                  ? 'This page needs a Paystack reference. Start signup and complete payment first.'
                  : message}
              </p>
              <Link
                to="/plans"
                className="mt-2 inline-flex w-full items-center justify-center rounded-full bg-sky-500 py-3 text-sm font-semibold text-white hover:bg-sky-400"
              >
                Choose a plan
              </Link>
              <Link
                to="/login"
                className="inline-flex items-center gap-1.5 text-sm text-sky-400 hover:text-sky-300"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Back to sign in
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SignupComplete;
