import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { Loader2 } from 'lucide-react';

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

const SubscriptionMomoPrompt = ({ prompt, onPromptChange, onSuccess, onCancel, dark = true }) => {
  const [otpCode, setOtpCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const promptRef = useRef(prompt);
  const startedAtRef = useRef(Date.now());
  const onSuccessRef = useRef(onSuccess);
  const onPromptChangeRef = useRef(onPromptChange);
  promptRef.current = prompt;
  onSuccessRef.current = onSuccess;
  onPromptChangeRef.current = onPromptChange;

  const cancel = useCallback(
    (message) => {
      const reference = promptRef.current?.reference;
      onCancel(message || 'Payment cancelled. Start again with the MoMo number.');
      if (reference) {
        axios.post('/api/auth/signup-cancel', { reference }, { timeout: 8000 }).catch(() => {});
      }
    },
    [onCancel]
  );

  useEffect(() => {
    startedAtRef.current = Date.now();
  }, [prompt?.reference]);

  useEffect(() => {
    const reference = prompt?.reference;
    if (!reference) return undefined;

    const remaining = Math.max(0, 30000 - (Date.now() - (startedAtRef.current || Date.now())));
    const timeout = prompt.needs_code
      ? null
      : window.setTimeout(() => {
          cancel('MoMo PIN was not confirmed. Start payment again.');
        }, remaining);

    let cancelled = false;
    const poll = async () => {
      try {
        const { data } = await axios.get(`/api/auth/signup-charge/${encodeURIComponent(reference)}`, {
          timeout: 8000,
        });
        if (cancelled) return;
        if (data.authorization_url) {
          window.location.href = data.authorization_url;
          return;
        }
        if (data.status === 'success') {
          onSuccessRef.current(data.fulfillment || { reference });
          return;
        }
        if (data.needs_code) {
          onPromptChangeRef.current((prev) => ({
            ...prev,
            needs_code: true,
            code_type: data.code_type || prev?.code_type || 'otp',
            display_text: data.display_text || prev?.display_text || 'Enter the 6-digit code sent to the phone.',
          }));
          return;
        }
        if (data.status === 'cancelled') {
          cancel(data.display_text || 'Payment was cancelled on the phone. Start payment again.');
          return;
        }
        if (data.status === 'failed' || data.status === 'timeout') {
          cancel(data.display_text || 'Payment failed. Start payment again.');
          return;
        }
        if (data.display_text) {
          onPromptChangeRef.current((prev) =>
            prev?.display_text === data.display_text ? prev : { ...prev, display_text: data.display_text }
          );
        }
      } catch {
        // Keep waiting while Paystack sends the PIN prompt.
      }
    };
    poll();
    const interval = window.setInterval(poll, 800);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      if (timeout) window.clearTimeout(timeout);
    };
  }, [prompt?.reference, prompt?.needs_code, cancel]);

  const submitCode = async (event) => {
    event?.preventDefault();
    if (!prompt?.reference || !otpCode.trim()) {
      setError('Enter the verification code to continue.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const { data } = await axios.post(
        '/api/auth/signup-authorize',
        {
          reference: prompt.reference,
          otp: otpCode.trim(),
          code_type: prompt.code_type || 'otp',
        },
        { timeout: 30000 }
      );
      if (data.authorization_url) {
        window.location.href = data.authorization_url;
        return;
      }
      if (data.status === 'success') {
        onSuccess(data.fulfillment || { reference: data.reference || prompt.reference });
        return;
      }
      if (data.needs_code) {
        onPromptChange((prev) => ({
          ...prev,
          needs_code: true,
          display_text: data.display_text || prev?.display_text || 'Enter the 6-digit code sent for this payment.',
        }));
        setSubmitting(false);
        return;
      }
      if (data.status === 'failed' || data.status === 'timeout' || data.status === 'cancelled') {
        cancel(data.display_text || 'That code was not accepted. Start payment again.');
        return;
      }
      onPromptChange((prev) => ({
        ...prev,
        reference: data.reference || prev?.reference,
        needs_code: Boolean(data.needs_code),
        display_text:
          data.display_text ||
          prev?.display_text ||
          'Code accepted. Approve the confirmation on your phone if it appears.',
      }));
      if (!data.needs_code) setOtpCode('');
    } catch (err) {
      setError(err.response?.data?.error || 'That code was not accepted.');
    } finally {
      setSubmitting(false);
    }
  };

  const boxClass = dark
    ? 'rounded-xl border border-[#3f3f3f] bg-[#1a1a1a] px-3 py-3 text-sm text-neutral-300'
    : 'rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-4 text-sm text-slate-200';

  return (
    <div className={boxClass}>
      <div className="flex items-start gap-2">
        {!prompt.needs_code ? <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" /> : null}
        <p>
          {prompt.display_text ||
            (prompt.needs_code
              ? prompt.code_type === 'pin'
                ? 'Enter your MoMo PIN to confirm.'
                : 'Enter the 6-digit code sent for this payment.'
              : 'A confirmation prompt was sent to your phone. Approve it to finish payment.')}
        </p>
      </div>
      {error ? <p className="mt-2 text-xs text-red-400">{error}</p> : null}
      {prompt.needs_code ? (
        <form onSubmit={submitCode} className="mt-3 space-y-3">
          <label className="block text-xs">
            {prompt.code_type === 'pin' ? 'MoMo PIN' : 'Verification code'}
            <input
              value={otpCode}
              onChange={(e) => setOtpCode(e.target.value)}
              inputMode="numeric"
              autoComplete={prompt.code_type === 'pin' ? 'off' : 'one-time-code'}
              placeholder={prompt.code_type === 'pin' ? 'Enter your PIN' : 'Enter the code'}
              className={
                dark
                  ? 'auth-field mt-1 w-full rounded-xl px-3 py-2.5 text-sm'
                  : 'mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white'
              }
            />
          </label>
          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-xl bg-sky-600 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {submitting ? 'Submitting code…' : 'Submit code'}
          </button>
        </form>
      ) : null}
      <button type="button" onClick={() => cancel()} className="mt-3 text-xs text-neutral-400 hover:underline">
        Cancel payment
      </button>
    </div>
  );
};

export default SubscriptionMomoPrompt;
