import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';

let scriptPromise = null;

function loadGoogleScript() {
  if (typeof window === 'undefined') return Promise.reject(new Error('Google sign-in needs a browser'));
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-google-gsi]');
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Could not load Google sign-in')), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.dataset.googleGsi = 'true';
    script.onload = () => resolve();
    script.onerror = () => {
      scriptPromise = null;
      reject(new Error('Could not load Google sign-in'));
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

const GoogleIcon = () => (
  <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
    <path fill="#EA4335" d="M12 10.2v3.6h5.1c-.2 1.2-.9 2.3-1.9 3l3.1 2.4c1.8-1.7 2.9-4.1 2.9-7 0-.7-.1-1.3-.2-1.9H12z" />
    <path
      fill="#34A853"
      d="M5.3 14.3l-.8.6-2.6 2C3.6 20.2 7.5 22.5 12 22.5c3 0 5.5-1 7.3-2.7l-3.1-2.4c-.9.6-2 1-3.3 1-2.5 0-4.6-1.7-5.4-3.9z"
    />
    <path fill="#FBBC05" d="M2 7.1C1.4 8.3 1 9.6 1 11s.4 2.7 1 3.9l3.4-2.6C5.1 11.5 5 10.8 5 11c0-.8.1-1.5.4-2.2z" />
    <path
      fill="#4285F4"
      d="M12 4.8c1.7 0 3.2.6 4.3 1.7l2.6-2.6C17.5 2.1 15 1 12 1 7.5 1 3.6 3.3 1.9 6.7L5.3 9.3C6.1 7.1 8.2 4.8 12 4.8z"
    />
  </svg>
);

export default function GoogleSignInButton({ label = 'Continue with Google', disabled, onCredential, className = '' }) {
  const [busy, setBusy] = useState(false);
  const clientIdRef = useRef('');

  useEffect(() => {
    let cancelled = false;
    const setup = async () => {
      try {
        const { data } = await axios.get('/api/auth/google-config');
        if (cancelled) return;
        if (data?.configured && data.clientId) {
          clientIdRef.current = data.clientId;
        }
      } catch {
        // Button still shows; click will explain if Google is not ready.
      }
      try {
        await loadGoogleScript();
      } catch {
        // Click handler reports if the Google script never loaded.
      }
    };
    setup();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleClick = useCallback(() => {
    if (disabled || busy) return;
    if (!clientIdRef.current) {
      toast.error('Google sign-in is not configured on the server yet.');
      return;
    }
    if (!window.google?.accounts?.oauth2) {
      toast.error('Google sign-in is still loading. Try again in a moment.');
      return;
    }

    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: clientIdRef.current,
      scope: 'openid email profile',
      callback: async (response) => {
        if (response?.error) {
          setBusy(false);
          if (response.error !== 'popup_closed_by_user') {
            toast.error('Google sign-in was cancelled or blocked.');
          }
          return;
        }
        try {
          await onCredential({ accessToken: response.access_token });
        } catch (error) {
          const message = error.response?.data?.error || error.message || 'Google sign-in failed';
          toast.error(message);
        } finally {
          setBusy(false);
        }
      },
    });

    setBusy(true);
    client.requestAccessToken({ prompt: 'select_account' });
  }, [busy, disabled, onCredential]);

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled || busy}
      className={
        className ||
        'inline-flex w-full items-center justify-center gap-2 rounded-xl border border-neutral-600 bg-[#1a1a1a] py-2.5 text-sm font-medium text-white hover:bg-[#222] disabled:opacity-50'
      }
    >
      <GoogleIcon />
      {busy ? 'Connecting to Google…' : label}
    </button>
  );
}
