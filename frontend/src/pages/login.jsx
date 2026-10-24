import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import { useAuth, getPostAuthPath } from '../contexts/authcontext';
import axios from 'axios';
import toast from 'react-hot-toast';
import { Mail, Lock, Eye, EyeOff, Loader2 } from 'lucide-react';
import AuthSplitLayout, { AuthBrandMark, AuthField, AUTH_ORANGE } from '../components/AuthSplitLayout';
import GoogleSignInButton from '../components/GoogleSignInButton';
import { openPaystackCheckout } from '../utils/paystackCheckout';

const REMEMBER_KEY = 'schootype_remember_email';

function isTransientNetworkError(error) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  if (error?.response) return false;
  const code = String(error?.code || error?.cause?.code || '');
  if (code === 'ECONNABORTED' || code === 'ERR_NETWORK' || code === 'ETIMEDOUT' || code === 'ECONNRESET') {
    return true;
  }
  if (error?.request && !error.response) return true;
  const message = String(error?.message || '').toLowerCase();
  return (
    message.includes('network') ||
    message.includes('timeout') ||
    message.includes('failed to fetch') ||
    message.includes('load failed')
  );
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForOnline() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined' || navigator.onLine) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const done = () => {
      window.removeEventListener('online', done);
      resolve();
    };
    window.addEventListener('online', done);
  });
}

async function waitForConnection(signal) {
  if (signal?.aborted) {
    const err = new Error('Login cancelled');
    err.aborted = true;
    throw err;
  }
  await Promise.race([wait(1200), waitForOnline()]);
  if (signal?.aborted) {
    const err = new Error('Login cancelled');
    err.aborted = true;
    throw err;
  }
}

async function runUntilConnected(action, signal) {
  let delayMs = 1500;
  for (;;) {
    try {
      return await action();
    } catch (error) {
      if (signal?.aborted) {
        error.aborted = true;
        throw error;
      }
      if (!isTransientNetworkError(error)) throw error;
      await Promise.race([wait(delayMs), waitForOnline()]);
      await waitForConnection(signal);
      delayMs = Math.min(Math.round(delayMs * 1.4), 8000);
    }
  }
}

const Login = () => {
  const location = useLocation();
  const pendingFromSignup = location.state?.pendingVerificationEmail || '';
  const [email, setEmail] = useState(pendingFromSignup);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [needsVerification, setNeedsVerification] = useState(Boolean(pendingFromSignup));
  const { login, loginWithGoogle } = useAuth();
  const navigate = useNavigate();
  const loginAttemptRef = useRef(0);

  useEffect(() => {
    import('../pages/Dashboard').catch(() => {});
    return () => {
      loginAttemptRef.current += 1;
    };
  }, []);

  useEffect(() => {
    if (pendingFromSignup) return;
    try {
      const saved = localStorage.getItem(REMEMBER_KEY);
      if (saved) {
        setEmail(saved);
        setRememberMe(true);
      }
    } catch {
      // ignore storage errors
    }
  }, [pendingFromSignup]);

  const handleForgotPassword = async () => {
    const target = email.trim().toLowerCase();
    if (!target) {
      toast.error('Enter the school email first');
      return;
    }
    setResetting(true);
    try {
      const { data } = await axios.post('/api/auth/forgot-password', { email: target });
      toast.success(data.message || 'A reset link was sent to that school email.');
    } catch (error) {
      toast.error(error.response?.data?.error || 'Could not send a reset link');
    } finally {
      setResetting(false);
    }
  };

  const handleResend = async () => {
    const target = email.trim().toLowerCase();
    if (!target) {
      toast.error('Enter your email first');
      return;
    }
    setResending(true);
    try {
      await axios.post('/api/auth/resend-verification', { email: target });
      toast.success('If that account needs verification, a new link was sent.');
      setNeedsVerification(true);
    } catch (error) {
      toast.error(error.response?.data?.error || 'Could not resend verification email');
    } finally {
      setResending(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const attempt = ++loginAttemptRef.current;
    const signal = { get aborted() { return loginAttemptRef.current !== attempt; } };
    setLoading(true);

    try {
      const data = await runUntilConnected(
        () => login(email, password, { remember: rememberMe }),
        signal
      );
      try {
        if (rememberMe) localStorage.setItem(REMEMBER_KEY, email.trim().toLowerCase());
        else localStorage.removeItem(REMEMBER_KEY);
      } catch {
        // ignore
      }
      navigate(getPostAuthPath(data.school), { replace: true });
      toast.success('Login successful!');
    } catch (error) {
      if (error?.aborted || signal.aborted) return;
      const data = error.response?.data;
      if (error.response?.status === 403 && data?.code === 'EMAIL_NOT_VERIFIED') {
        setNeedsVerification(true);
        if (data.email) setEmail(data.email);
        toast.error(data.error || 'Please verify your email before signing in.');
      } else if (error.response?.status === 403 && data?.code === 'PASSWORD_NOT_SET') {
        setNeedsVerification(true);
        if (data.email) setEmail(data.email);
        toast.error(data.error || 'Finish setup from your email link first.');
      } else if (isTransientNetworkError(error)) {
        return;
      } else {
        const message = data?.error || 'Check your email and password.';
        if (error.response?.status === 429 && data?.retryAfter) {
          toast.error(`${message} (${data.retryAfter}s)`);
        } else {
          toast.error(message);
        }
      }
    } finally {
      if (loginAttemptRef.current === attempt) setLoading(false);
    }
  };

  return (
    <AuthSplitLayout mode="login">
      <AuthBrandMark />

      {needsVerification && (
        <div className="mt-6 rounded-sm border border-[#b08a3a] bg-[#f2ebe0] px-4 py-3 text-sm text-[#1a1712]">
          <p className="font-medium">Check your email to finish setup</p>
          <p className="mt-1 text-[#5c564c]">
            Open the link we sent to verify your email and choose a password. Then come back here to sign in.
          </p>
          <button
            type="button"
            disabled={resending}
            onClick={handleResend}
            className="mt-3 text-sm font-semibold text-[#123028] underline-offset-2 hover:underline disabled:opacity-50"
          >
            {resending ? 'Sending…' : 'Resend email'}
          </button>
        </div>
      )}

      <div className="mt-8">
        <GoogleSignInButton
          label="Sign in with Google"
          disabled={loading}
          className="mk-google-btn"
          onCredential={async ({ accessToken }) => {
            const attempt = ++loginAttemptRef.current;
            const signal = { get aborted() { return loginAttemptRef.current !== attempt; } };
            setLoading(true);
            try {
              const data = await runUntilConnected(
                () => loginWithGoogle({ accessToken, remember: rememberMe }),
                signal
              );
              if (data.authorization_url) {
                openPaystackCheckout(data);
                return;
              }
              toast.success('Login successful!');
              navigate(getPostAuthPath(data.school));
            } catch (error) {
              if (error?.aborted || signal.aborted) return;
              if (error.response?.data?.code === 'ACCOUNT_NOT_FOUND') {
                toast.error('No school account for this Google email. Create an account first.');
                navigate('/plans');
                return;
              }
              if (isTransientNetworkError(error)) return;
              throw error;
            } finally {
              if (loginAttemptRef.current === attempt) setLoading(false);
            }
          }}
        />
      </div>

      <div className="relative my-6 text-center text-[11px] uppercase tracking-[0.14em] text-[#5c564c]">
        <span className="absolute inset-x-0 top-1/2 h-px bg-[#d8cfc0]" />
        <span className="relative bg-[#fffaf2] px-3">or continue with email</span>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <AuthField
          label="Email"
          icon={Mail}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          placeholder="admin@school.com"
        />

        <AuthField
          label="Password"
          icon={Lock}
          type={showPassword ? 'text' : 'password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          placeholder="Enter your password"
          rightSlot={
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="text-[#5c564c] hover:text-[#1a1712]"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          }
        />

        <div className="flex items-center justify-between gap-3 text-sm">
          <label className="inline-flex cursor-pointer items-center gap-2 text-[#1a1712]">
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
              className="auth-checkbox h-4 w-4 rounded border-neutral-600"
            />
            Remember this device
          </label>
          <button
            type="button"
            disabled={resetting}
            onClick={handleForgotPassword}
            className="font-medium hover:underline disabled:opacity-50"
            style={{ color: AUTH_ORANGE }}
          >
            {resetting ? 'Sending…' : 'Forgot password?'}
          </button>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="auth-accent inline-flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-semibold text-white transition disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-[#5c564c]">
        New school?{' '}
        <Link to="/plans" className="font-semibold hover:underline" style={{ color: AUTH_ORANGE }}>
          Create an account
        </Link>
      </p>
      <p className="mt-3 text-center text-xs text-[#5c564c]">
        <Link to="/privacy" className="hover:underline">
          Privacy notice
        </Link>
      </p>
    </AuthSplitLayout>
  );
};

export default Login;
