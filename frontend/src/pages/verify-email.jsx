import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import toast from 'react-hot-toast';
import { useAuth, getPostAuthPath } from '../contexts/authcontext';
import { ArrowLeft, CheckCircle2, Loader2, XCircle } from 'lucide-react';

const VerifyEmail = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { storeSessionFromAuth } = useAuth();
  const token = searchParams.get('token') || '';
  const [status, setStatus] = useState(token ? 'loading' : 'missing');
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [setupToken, setSetupToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [resending, setResending] = useState(false);

  useEffect(() => {
    if (!token) return;

    let cancelled = false;
    (async () => {
      try {
        const { data } = await axios.get('/api/auth/verify-email', {
          params: { token },
          timeout: 45000,
        });
        if (cancelled) return;
        setEmail(data.email || '');
        setMessage(data.message || 'Email verified.');
        // Always collect a password when the API issues a setup token.
        if (data.setupToken) {
          setSetupToken(data.setupToken);
          setStatus('set_password');
          toast.success('Email verified — choose a password');
        } else if (data.needsPasswordSetup) {
          setStatus('error');
          setMessage('Email verified, but password setup failed to start. Please resend the email.');
        } else {
          setStatus('success');
          toast.success('Email verified');
        }
      } catch (error) {
        if (cancelled) return;
        const data = error.response?.data;
        setStatus('error');
        setMessage(data?.error || 'Verification failed');
        setEmail(data?.email || '');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token]);

  const handleResend = async () => {
    if (!email) {
      toast.error('Open the link from your email, or resend from the login page.');
      return;
    }
    setResending(true);
    try {
      await axios.post('/api/auth/resend-verification', { email });
      toast.success('If setup is still needed, a new link was sent.');
    } catch (error) {
      toast.error(error.response?.data?.error || 'Could not resend verification email');
    } finally {
      setResending(false);
    }
  };

  const handleSetPassword = async (e) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }
    if (password.length < 8) {
      toast.error('Password must be at least 8 characters');
      return;
    }
    if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
      toast.error('Password must include at least one letter and one number');
      return;
    }

    setSaving(true);
    try {
      const { data } = await axios.post('/api/auth/set-password', {
        setupToken,
        password,
      });
      if (storeSessionFromAuth) {
        storeSessionFromAuth(data);
      } else if (data.school) {
        localStorage.setItem('school', JSON.stringify(data.school));
      }
      toast.success('Account ready');
      navigate(getPostAuthPath(data.school), { replace: true });
    } catch (error) {
      toast.error(error.response?.data?.error || 'Could not save password');
    } finally {
      setSaving(false);
    }
  };

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
              <h1 className="font-display text-2xl font-bold">Verifying email…</h1>
              <p className="text-sm text-slate-400">Please wait a moment.</p>
            </div>
          )}

          {status === 'set_password' && (
            <div className="mt-8 space-y-5 text-left">
              <div className="text-center">
                <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-400" />
                <h1 className="mt-4 font-display text-2xl font-bold">Choose a password</h1>
                <p className="mt-2 text-sm text-slate-300">{message}</p>
                {email && <p className="mt-1 text-xs text-slate-500">{email}</p>}
              </div>
              <form onSubmit={handleSetPassword} className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-200">Password</label>
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="input"
                    placeholder="••••••••"
                  />
                  <p className="mt-1 text-xs text-slate-500">At least 8 characters with letters and numbers.</p>
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-200">Confirm password</label>
                  <input
                    type="password"
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="input"
                    placeholder="••••••••"
                  />
                </div>
                <button
                  type="submit"
                  disabled={saving}
                  className="w-full rounded-full bg-sky-500 py-3 text-sm font-semibold text-white hover:bg-sky-400 disabled:opacity-50"
                >
                  {saving ? 'Saving…' : 'Finish account setup'}
                </button>
              </form>
            </div>
          )}

          {status === 'success' && (
            <div className="mt-8 space-y-4">
              <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-400" />
              <h1 className="font-display text-2xl font-bold">Email verified</h1>
              <p className="text-sm text-slate-300">{message}</p>
              <button
                type="button"
                onClick={() => navigate('/login')}
                className="mt-2 w-full rounded-full bg-sky-500 py-3 text-sm font-semibold text-white hover:bg-sky-400"
              >
                Continue to sign in
              </button>
            </div>
          )}

          {(status === 'error' || status === 'missing') && (
            <div className="mt-8 space-y-4">
              <XCircle className="mx-auto h-10 w-10 text-amber-400" />
              <h1 className="font-display text-2xl font-bold">Verification needed</h1>
              <p className="text-sm text-slate-300">
                {status === 'missing' ? 'This page needs a valid link from your signup email.' : message}
              </p>
              {email && (
                <button
                  type="button"
                  disabled={resending}
                  onClick={handleResend}
                  className="w-full rounded-full border border-slate-600 bg-slate-800 py-3 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
                >
                  {resending ? 'Sending…' : 'Resend email'}
                </button>
              )}
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

export default VerifyEmail;
