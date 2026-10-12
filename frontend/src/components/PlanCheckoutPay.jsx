import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { CreditCard, Landmark, Loader2, Smartphone } from 'lucide-react';

const MOMO_PROVIDERS = [
  { id: 'mtn', label: 'MTN MoMo' },
  { id: 'vod', label: 'Telecel' },
  { id: 'atl', label: 'AT (AirtelTigo)' },
];

export const momoNetworkFromPhone = (value) => {
  const digits = String(value || '').replace(/\D/g, '');
  const local =
    digits.startsWith('233') && digits.length >= 12
      ? `0${digits.slice(3)}`
      : digits.length === 9
        ? `0${digits}`
        : digits;
  const prefix = local.slice(0, 3);
  if (['024', '025', '053', '054', '055', '059', '023'].includes(prefix)) return 'mtn';
  if (['020', '050'].includes(prefix)) return 'vod';
  if (['026', '027', '056', '057'].includes(prefix)) return 'atl';
  return null;
};

const METHODS = [
  { id: 'momo', label: 'MoMo', Icon: Smartphone, hint: 'PIN prompt on the phone' },
  { id: 'card', label: 'Card', Icon: CreditCard, hint: 'Paystack card checkout' },
  { id: 'bank', label: 'Bank', Icon: Landmark, hint: 'Paystack bank checkout' },
];

const localMomoNumber = (value) => {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('233') && digits.length >= 12) return `0${digits.slice(3)}`;
  if (digits.length === 9) return `0${digits}`;
  return digits;
};

export default function PlanCheckoutPay({
  startPayment,
  onPaid,
  submitLabel = 'Pay & create account',
  extraActions,
  className = '',
  dark = true,
}) {
  const [method, setMethod] = useState('momo');
  const [phone, setPhone] = useState('');
  const [provider, setProvider] = useState('mtn');
  const [paying, setPaying] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [error, setError] = useState('');
  const [momoPrompt, setMomoPrompt] = useState(null);
  const momoWaitStartedAtRef = useRef(0);
  const abortingRef = useRef(false);

  const abortPayment = useCallback(
    (message) => {
      abortingRef.current = true;
      const reference = momoPrompt?.reference;
      setPaying(false);
      setMomoPrompt(null);
      setOtpCode('');
      setError(message || 'Payment was not confirmed. Try again.');
      if (reference) {
        axios.post('/api/auth/signup-charge/cancel', { reference }, { timeout: 8000 }).catch(() => {});
      }
    },
    [momoPrompt?.reference]
  );

  const finishPaid = useCallback(
    async (data) => {
      const payload = data?.fulfillment && data.fulfillment.ok !== false ? data.fulfillment : data;
      if (typeof onPaid === 'function') {
        await onPaid(payload, data);
      }
    },
    [onPaid]
  );

  useEffect(() => {
    const reference = momoPrompt?.reference;
    if (!reference) return undefined;

    const remaining = Math.max(0, 180000 - (Date.now() - (momoWaitStartedAtRef.current || Date.now())));
    const timeout = momoPrompt.needs_code
      ? null
      : window.setTimeout(() => {
          abortPayment('MoMo PIN was not confirmed. Start payment again.');
        }, remaining);

    let cancelled = false;
    const poll = async () => {
      try {
        const { data } = await axios.get(`/api/auth/signup-charge/${encodeURIComponent(reference)}`, {
          timeout: 8000,
        });
        if (cancelled || abortingRef.current) return;
        if (data.status === 'open_url' && data.authorization_url) {
          window.location.assign(data.authorization_url);
          return;
        }
        if (data.status === 'success') {
          await finishPaid(data);
          return;
        }
        if (data.needs_code) {
          setMomoPrompt((prev) => ({
            ...prev,
            needs_code: true,
            code_type: data.code_type || prev?.code_type || 'otp',
            display_text: data.display_text || prev?.display_text,
          }));
          setPaying(false);
          return;
        }
        if (data.status === 'cancelled') {
          abortPayment(data.display_text || 'Payment was cancelled on the phone. Start payment again.');
          return;
        }
        if (data.status === 'failed' || data.status === 'timeout') {
          abortPayment(data.display_text || 'Payment failed. Start payment again.');
          return;
        }
        if (data.display_text) {
          setMomoPrompt((prev) =>
            prev?.display_text === data.display_text ? prev : { ...prev, display_text: data.display_text }
          );
        }
      } catch {
        // Keep waiting while Paystack finalizes the charge.
      }
    };
    poll();
    const interval = window.setInterval(poll, 800);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      if (timeout) window.clearTimeout(timeout);
    };
  }, [momoPrompt?.reference, momoPrompt?.needs_code, abortPayment, finishPaid]);

  const beginCharge = async (event) => {
    event?.preventDefault();
    setError('');
    if (method === 'momo' && !/^0\d{9}$/.test(localMomoNumber(phone))) {
      setError('Enter a Ghana MoMo number like 0551234567 so Paystack can send the PIN to the phone.');
      return;
    }
    setPaying(true);
    abortingRef.current = false;
    try {
      const data = await startPayment({
        method,
        phone: method === 'momo' ? phone : undefined,
        provider: method === 'momo' ? momoNetworkFromPhone(phone) || provider : undefined,
      });
      if (data?.alreadyPaid) {
        await finishPaid(data);
        return;
      }
      if (data?.mode === 'checkout' && data.authorization_url) {
        window.location.assign(data.authorization_url);
        return;
      }
      if (method === 'momo' || data?.mode === 'momo') {
        if (data.status === 'open_url' && data.authorization_url) {
          window.location.assign(data.authorization_url);
          return;
        }
        if (
          !data.needs_code &&
          (data.status === 'cancelled' || data.status === 'failed' || data.status === 'timeout')
        ) {
          setPaying(false);
          setError(data.display_text || 'Payment was cancelled on the phone. Start payment again.');
          return;
        }
        momoWaitStartedAtRef.current = Date.now();
        setMomoPrompt({
          reference: data.reference,
          display_text: data.display_text,
          needs_code: Boolean(data.needs_code),
          code_type: data.code_type || (data.status === 'send_pin' ? 'pin' : 'otp'),
          live_mode: data.live_mode !== false,
        });
        setPaying(Boolean(!data.needs_code && data.status !== 'success'));
        if (data.status === 'success') {
          await finishPaid(data);
        }
        return;
      }
      if (data?.authorization_url) {
        window.location.assign(data.authorization_url);
        return;
      }
      setPaying(false);
      setError('Could not start checkout. Try another payment method.');
    } catch (err) {
      setPaying(false);
      setError(err.response?.data?.error || err.message || 'Could not start payment.');
    }
  };

  const submitMomoCode = async (event) => {
    event?.preventDefault();
    if (!momoPrompt?.reference || !otpCode.trim()) {
      setError('Enter the code from the prompt.');
      return;
    }
    setPaying(true);
    setError('');
    try {
      const { data } = await axios.post('/api/auth/signup-charge/authorize', {
        reference: momoPrompt.reference,
        otp: otpCode.trim(),
        code_type: momoPrompt.code_type || 'otp',
      });
      if (data.status === 'open_url' && data.authorization_url) {
        window.location.assign(data.authorization_url);
        return;
      }
      if (data.status === 'success') {
        await finishPaid(data);
        return;
      }
      if (data.needs_code) {
        setMomoPrompt((prev) => ({
          ...prev,
          display_text: data.display_text || prev?.display_text,
          code_type: data.code_type || prev?.code_type,
        }));
        setPaying(false);
        return;
      }
      setPaying(false);
      setError(data.display_text || 'That code was not accepted.');
    } catch (err) {
      setPaying(false);
      setError(err.response?.data?.error || 'Could not submit that code.');
    }
  };

  const box = dark
    ? 'rounded-xl border border-[#3f3f3f] bg-[#1a1a1a]'
    : 'rounded-2xl border border-slate-600 bg-slate-800';
  const btnIdle = dark
    ? 'border-[#3f3f3f] bg-[#121212] hover:border-[#3498DB]/50'
    : 'border-slate-600 bg-slate-900 hover:border-sky-400';
  const btnActive = dark ? 'border-[#3498DB] bg-[#3498DB]/10' : 'border-sky-400 bg-sky-500/10';
  const field = dark
    ? 'mt-1.5 w-full rounded-xl border border-[#3f3f3f] bg-[#121212] px-3 py-2.5 text-sm text-white outline-none focus:border-[#3498DB]'
    : 'mt-1.5 w-full rounded-xl border border-slate-600 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none focus:border-sky-400';

  return (
    <form onSubmit={momoPrompt?.needs_code ? submitMomoCode : beginCharge} className={className}>
      <p className={`text-sm font-medium ${dark ? 'text-neutral-300' : 'text-slate-200'}`}>Pay with</p>
      <div className="mt-2 grid grid-cols-3 gap-2">
        {METHODS.map((option) => (
          <button
            key={option.id}
            type="button"
            disabled={paying || Boolean(momoPrompt)}
            onClick={() => setMethod(option.id)}
            className={`rounded-xl border p-3 text-left transition disabled:opacity-60 ${
              method === option.id ? btnActive : btnIdle
            }`}
          >
            <option.Icon className="h-4 w-4 text-[#3498DB]" />
            <p className="mt-1.5 text-sm font-semibold text-white">{option.label}</p>
            <p className={`mt-0.5 text-[11px] ${dark ? 'text-neutral-500' : 'text-slate-400'}`}>{option.hint}</p>
          </button>
        ))}
      </div>

      {method === 'momo' && !momoPrompt ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className={`block text-[13px] ${dark ? 'text-neutral-300' : 'text-slate-300'}`}>
            Network
            <select className={field} value={provider} onChange={(e) => setProvider(e.target.value)}>
              {MOMO_PROVIDERS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label className={`block text-[13px] ${dark ? 'text-neutral-300' : 'text-slate-300'}`}>
            MoMo number
            <input
              className={field}
              inputMode="tel"
              autoComplete="tel"
              placeholder="0551234567"
              value={phone}
              onChange={(e) => {
                const next = e.target.value;
                setPhone(next);
                const network = momoNetworkFromPhone(next);
                if (network) setProvider(network);
              }}
              required={method === 'momo'}
            />
          </label>
        </div>
      ) : null}

      {momoPrompt ? (
        <div className={`${box} mt-4 flex gap-2 px-3 py-3 text-sm ${dark ? 'text-neutral-300' : 'text-slate-200'}`}>
          {!momoPrompt.needs_code ? <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-[#3498DB]" /> : null}
          <div>
            <p>
              {momoPrompt.display_text ||
                (momoPrompt.needs_code
                  ? 'Enter the code from the prompt.'
                  : 'Approve the PIN on the phone. Keep this page open.')}
            </p>
            {momoPrompt.needs_code ? (
              <input
                className={field}
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value)}
                placeholder={momoPrompt.code_type === 'pin' ? 'PIN' : '6-digit code'}
                autoComplete="one-time-code"
              />
            ) : null}
          </div>
        </div>
      ) : null}

      {error ? <p className="mt-3 text-sm text-red-400">{error}</p> : null}

      <div className="mt-4 flex flex-col gap-3">
        {extraActions && !momoPrompt
          ? typeof extraActions === 'function'
            ? extraActions({ method, phone, provider })
            : extraActions
          : null}
        <button
          type="submit"
          disabled={paying}
          className="auth-accent w-full rounded-xl py-3.5 text-sm font-semibold text-white transition disabled:opacity-50"
        >
          {paying
            ? momoPrompt?.needs_code
              ? 'Submitting code…'
              : method === 'momo'
                ? 'Sending PIN to phone…'
                : 'Opening checkout…'
            : momoPrompt?.needs_code
              ? 'Submit code'
              : submitLabel}
        </button>
        {momoPrompt ? (
          <button
            type="button"
            onClick={() => abortPayment('Payment cancelled. Start again.')}
            className={`text-sm ${dark ? 'text-neutral-400 hover:text-white' : 'text-slate-300 hover:text-white'}`}
          >
            Cancel and try again
          </button>
        ) : null}
      </div>
    </form>
  );
}
