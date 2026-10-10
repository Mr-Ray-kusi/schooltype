import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import axios from 'axios';
import { ArrowLeft, Building2, CreditCard, Landmark, Loader2, Smartphone } from 'lucide-react';

const MOMO_PROVIDERS = [
  { id: 'mtn', label: 'MTN MoMo' },
  { id: 'vod', label: 'Telecel' },
  { id: 'atl', label: 'AT (AirtelTigo)' },
];

const STEPS = [
  { id: 1, title: 'School & ID' },
  { id: 2, title: 'Verify' },
  { id: 3, title: 'Pay' },
];

const formatGhs = (value) =>
  `GHS ${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const isFullyPaid = (info) =>
  Boolean(info?.paid) || (Number(info?.fee_amount) > 0 && Number(info?.outstanding) < 0.01);

const fieldClass =
  'w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none transition focus:border-sky-500/70 focus:ring-2 focus:ring-sky-500/20';

const FeesPay = () => {
  const { barcode } = useParams();
  const [step, setStep] = useState(barcode ? 2 : 1);
  const [schools, setSchools] = useState([]);
  const [schoolId, setSchoolId] = useState('');
  const [studentId, setStudentId] = useState(barcode || '');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('momo');
  const [phone, setPhone] = useState('');
  const [provider, setProvider] = useState('mtn');
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  const [loadingSchools, setLoadingSchools] = useState(!barcode);
  const [lookingUp, setLookingUp] = useState(Boolean(barcode));
  const [paying, setPaying] = useState(false);
  const [momoPrompt, setMomoPrompt] = useState(null);
  const [otpCode, setOtpCode] = useState('');
  const momoPromptRef = useRef(null);
  const abortingRef = useRef(false);
  const momoWaitStartedAtRef = useRef(0);
  momoPromptRef.current = momoPrompt;

  const abortPayment = useCallback((message) => {
    const reference = momoPromptRef.current?.reference;
    if (abortingRef.current) return;
    abortingRef.current = true;
    setMomoPrompt(null);
    setOtpCode('');
    setPaying(false);
    setStep(2);
    setError(message || 'Payment cancelled. Tap Continue to payment to start again.');
    if (!reference) return;
    axios.post('/api/public/fees/cancel', { reference }, { timeout: 8000 }).catch(() => {});
  }, []);

  useEffect(() => {
    if (barcode) return undefined;
    let cancelled = false;
    const load = async () => {
      setLoadingSchools(true);
      try {
        const { data } = await axios.get('/api/public/schools');
        if (!cancelled) setSchools(data.schools || []);
      } catch (err) {
        if (!cancelled) setError(err.response?.data?.error || 'Could not load schools.');
      } finally {
        if (!cancelled) setLoadingSchools(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [barcode]);

  useEffect(() => {
    if (!barcode) return undefined;
    let cancelled = false;
    const load = async () => {
      setLookingUp(true);
      setError('');
      try {
        const { data } = await axios.get(`/api/public/fees/${encodeURIComponent(barcode)}`);
        if (cancelled) return;
        setInfo(data);
        setSchoolId(data.school_id || '');
        setStudentId(data.barcode || barcode);
        setAmount(data.outstanding > 0 ? String(data.outstanding) : data.amount > 0 ? String(data.amount) : '');
        setStep(2);
      } catch (err) {
        if (!cancelled) {
          setError(err.response?.data?.error || 'Could not load this fee page.');
          setStep(1);
        }
      } finally {
        if (!cancelled) setLookingUp(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [barcode]);

  useEffect(() => {
    const reference = momoPrompt?.reference;
    if (!reference) return undefined;

    const remaining = Math.max(0, 30000 - (Date.now() - (momoWaitStartedAtRef.current || Date.now())));
    const timeout = window.setTimeout(() => {
      abortPayment('MoMo PIN was not confirmed in 30 seconds. Tap Continue to payment to start again.');
    }, remaining);

    const onLeave = () => {
      fetch('/api/public/fees/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reference }),
        keepalive: true,
      }).catch(() => {});
    };
    window.addEventListener('pagehide', onLeave);
    window.addEventListener('beforeunload', onLeave);
    const onPageShow = (event) => {
      if (event.persisted && momoPromptRef.current?.reference) {
        abortPayment('Payment cancelled. Tap Continue to payment to start again.');
      }
    };
    window.addEventListener('pageshow', onPageShow);

    if (momoPrompt.needs_code) {
      return () => {
        window.clearTimeout(timeout);
        window.removeEventListener('pagehide', onLeave);
        window.removeEventListener('beforeunload', onLeave);
        window.removeEventListener('pageshow', onPageShow);
      };
    }

    let cancelled = false;
    const poll = async () => {
      try {
        const { data } = await axios.get(`/api/public/fees/charge/${encodeURIComponent(reference)}`, {
          timeout: 12000,
        });
        if (cancelled) return;
        if (data.authorization_url) {
          window.location.href = data.authorization_url;
          return;
        }
        if (data.status === 'success') {
          window.location.href = `/pay/receipt?reference=${encodeURIComponent(reference)}`;
          return;
        }
        if (data.status === 'failed' || data.status === 'timeout' || data.status === 'cancelled') {
          abortPayment(data.display_text || 'Payment was cancelled. Tap Continue to payment to start again.');
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
    const interval = window.setInterval(poll, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.clearTimeout(timeout);
      window.removeEventListener('pagehide', onLeave);
      window.removeEventListener('beforeunload', onLeave);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, [momoPrompt?.reference, momoPrompt?.needs_code, abortPayment]);

  const lookupStudent = async (event) => {
    event?.preventDefault();
    setError('');
    setInfo(null);
    if (!schoolId || !studentId.trim()) {
      setError('Select the school and enter the student ID.');
      return;
    }
    setLookingUp(true);
    try {
      const { data } = await axios.post('/api/public/fees/lookup', {
        schoolId,
        studentId: studentId.trim(),
      });
      setInfo(data);
      setAmount(data.outstanding > 0 ? String(data.outstanding) : data.amount > 0 ? String(data.amount) : '');
      setStep(2);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not find this student.');
    } finally {
      setLookingUp(false);
    }
  };

  const goToPayment = (event) => {
    event?.preventDefault();
    if (!info) {
      setError('Find the student first.');
      return;
    }
    if (isFullyPaid(info)) {
      setError(`There is no outstanding payment to make for ${info.term_name || 'this term'}.`);
      return;
    }
    setError('');
    setMomoPrompt(null);
    setOtpCode('');
    setStep(3);
  };

  const startPay = async (event) => {
    event?.preventDefault();
    setPaying(true);
    setError('');
    try {
      const payload = {
        schoolId: info?.school_id || schoolId,
        studentId: info?.barcode || info?.roll_number || studentId.trim(),
        amount: Number(amount),
        method,
        phone: method === 'momo' ? phone : undefined,
        provider: method === 'momo' ? provider : undefined,
      };
      const path = barcode
        ? `/api/public/fees/${encodeURIComponent(barcode)}/checkout`
        : '/api/public/fees/pay';
      const { data } = await axios.post(path, payload, { timeout: 45000 });
      if (method === 'momo' || data.mode === 'momo') {
        if (data.authorization_url) {
          window.location.href = data.authorization_url;
          return;
        }
        abortingRef.current = false;
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
          window.location.href = `/pay/receipt?reference=${encodeURIComponent(data.reference)}`;
        }
        return;
      }
      if (data.authorization_url) {
        window.location.href = data.authorization_url;
        return;
      }
      setError('Paystack did not return a checkout link.');
      setPaying(false);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not start payment.');
      setPaying(false);
    }
  };

  const submitMomoCode = async (event) => {
    event?.preventDefault();
    if (!momoPrompt?.reference || !otpCode.trim()) {
      setError('Enter the verification code to continue.');
      return;
    }
    setPaying(true);
    setError('');
    try {
      const { data } = await axios.post(
        '/api/public/fees/authorize',
        {
          reference: momoPrompt.reference,
          otp: otpCode.trim(),
          code_type: momoPrompt.code_type || 'otp',
        },
        { timeout: 30000 }
      );
      if (data.authorization_url) {
        window.location.href = data.authorization_url;
        return;
      }
      if (data.status === 'success') {
        window.location.href = `/pay/receipt?reference=${encodeURIComponent(data.reference || momoPrompt.reference)}`;
        return;
      }
      if (data.status === 'failed' || data.status === 'timeout' || data.status === 'cancelled') {
        abortPayment(data.display_text || 'That code was not accepted. Tap Continue to payment to start again.');
        return;
      }
      setMomoPrompt((prev) => ({
        ...prev,
        reference: data.reference || prev?.reference,
        needs_code: Boolean(data.needs_code),
        display_text:
          data.display_text ||
          prev?.display_text ||
          'Code accepted. Approve the confirmation on your phone if it appears.',
      }));
      if (!data.needs_code) setOtpCode('');
      setPaying(!data.needs_code);
    } catch (err) {
      setError(err.response?.data?.error || 'That code was not accepted.');
      setPaying(false);
    }
  };

  const onSubmit =
    step === 1 ? lookupStudent : step === 2 ? goToPayment : momoPrompt?.needs_code ? submitMomoCode : startPay;

  const submitLabel = (() => {
    if (step === 1) return lookingUp ? 'Finding student…' : 'Find student';
    if (step === 2) {
      if (isFullyPaid(info)) return 'Cannot proceed';
      return Number(info?.paid_amount) > 0 ? 'Pay the amount left' : 'Continue to payment';
    }
    if (momoPrompt?.needs_code) return paying ? 'Submitting code…' : 'Submit code';
    if (paying) return 'Waiting for confirmation…';
    return 'Pay';
  })();

  return (
    <div className="min-h-screen bg-slate-950 px-5 py-10 text-white">
      <div className="mx-auto w-full max-w-lg space-y-6">
        <header className="text-center">
          <Link to="/" className="text-xs uppercase tracking-[0.2em] text-sky-300/80">
            Schooltype
          </Link>
          <h1 className="mt-2 text-3xl font-bold">Fees payment</h1>
        </header>

        <ol className="grid grid-cols-3 gap-2">
          {STEPS.map((item) => {
            const active = step === item.id;
            const done = step > item.id;
            return (
              <li
                key={item.id}
                className={`rounded-2xl border px-3 py-2 text-center ${
                  active
                    ? 'border-sky-400 bg-sky-500/10 text-white'
                    : done
                      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-100'
                      : 'border-slate-800 bg-slate-900/50 text-slate-500'
                }`}
              >
                <p className="text-[11px] font-semibold uppercase tracking-wide">Step {item.id}</p>
                <p className="mt-0.5 text-xs">{item.title}</p>
              </li>
            );
          })}
        </ol>

        <form onSubmit={onSubmit} className="space-y-4 rounded-3xl border border-slate-700 bg-slate-900/70 p-6">
          {step === 1 ? (
            <>
              <label className="block text-sm font-medium text-slate-300">
                School name
                <select
                  className={`${fieldClass} mt-2`}
                  value={schoolId}
                  onChange={(e) => {
                    setSchoolId(e.target.value);
                    setInfo(null);
                  }}
                  disabled={loadingSchools}
                  required
                >
                  <option value="">{loadingSchools ? 'Loading schools…' : 'Select school'}</option>
                  {schools.map((school) => (
                    <option key={school.id} value={school.id}>
                      {school.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm font-medium text-slate-300">
                Student ID
                <input
                  className={`${fieldClass} mt-2`}
                  value={studentId}
                  onChange={(e) => {
                    setStudentId(e.target.value);
                    setInfo(null);
                  }}
                  placeholder="Roll number or ID on the student card"
                  required
                />
              </label>
            </>
          ) : null}

          {step === 2 ? (
            lookingUp && !info ? (
              <p className="text-sm text-slate-400">Finding student…</p>
            ) : info ? (
              <div className="rounded-2xl border border-slate-700 bg-slate-950/50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Confirm this student</p>
                <p className="mt-2 text-lg font-semibold">{info.student_name}</p>
                <p className="mt-1 text-sm text-slate-400">
                  {info.school_name}
                  {info.class_name ? ` · ${info.class_name}` : ''}
                  {info.roll_number ? ` · ${info.roll_number}` : ''}
                </p>
                <p className="mt-3 text-xs uppercase tracking-wide text-slate-500">
                  {info.term_name || info.period_label || 'Current term'}
                </p>
                <dl className="mt-3 space-y-2 text-sm">
                  <div className="flex justify-between gap-4">
                    <dt className="text-slate-400">Fee this term</dt>
                    <dd className="font-medium text-white">{formatGhs(info.fee_amount ?? info.amount)}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-slate-400">Already paid</dt>
                    <dd className="font-medium text-emerald-300">{formatGhs(info.paid_amount || 0)}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-slate-400">Amount left</dt>
                    <dd className={`font-semibold ${isFullyPaid(info) ? 'text-emerald-300' : 'text-amber-300'}`}>
                      {formatGhs(info.outstanding ?? info.amount)}
                    </dd>
                  </div>
                </dl>
                {isFullyPaid(info) ? (
                  <div className="mt-4 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-3 text-sm text-emerald-100">
                    There is no outstanding payment to make for {info.term_name || 'this term'}. You cannot proceed.
                  </div>
                ) : Number(info.paid_amount) > 0 ? (
                  <p className="mt-3 text-sm text-amber-200">A part payment is already recorded. Pay the amount left to complete this term.</p>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-rose-300">No student loaded. Go back and search again.</p>
            )
          ) : null}

          {step === 3 && info ? (
            <>
              <div className="rounded-2xl border border-slate-700 bg-slate-950/50 px-4 py-3 text-sm text-slate-300">
                <p className="font-semibold text-white">{info.student_name}</p>
                <p className="mt-0.5 text-slate-400">
                  {info.school_name}
                  {info.class_name ? ` · ${info.class_name}` : ''}
                </p>
                <dl className="mt-3 space-y-1.5 border-t border-slate-800 pt-3">
                  <div className="flex justify-between gap-4">
                    <dt className="text-slate-400">Already paid</dt>
                    <dd className="text-emerald-300">{formatGhs(info.paid_amount || 0)}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-slate-400">Amount left</dt>
                    <dd className="font-semibold text-white">{formatGhs(info.outstanding ?? info.amount)}</dd>
                  </div>
                </dl>
              </div>

              <label className="block text-sm font-medium text-slate-300">
                Amount left to pay (GHS)
                <input
                  className={`${fieldClass} mt-2`}
                  type="number"
                  min="1"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  required
                />
              </label>

              <div>
                <p className="text-sm font-medium text-slate-300">Payment method</p>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {[
                    { id: 'momo', label: 'MoMo', Icon: Smartphone, hint: 'Mobile money' },
                    { id: 'bank', label: 'Bank', Icon: Landmark, hint: 'Bank checkout' },
                  ].map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => setMethod(option.id)}
                      className={`rounded-2xl border p-4 text-left transition ${
                        method === option.id
                          ? 'border-sky-400 bg-sky-500/10'
                          : 'border-slate-700 bg-slate-950/40 hover:border-slate-500'
                      }`}
                    >
                      <option.Icon className="h-4 w-4 text-sky-300" />
                      <p className="mt-2 text-sm font-semibold">{option.label}</p>
                      <p className="mt-1 text-xs text-slate-500">{option.hint}</p>
                    </button>
                  ))}
                </div>
              </div>

              {method === 'momo' ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-sm font-medium text-slate-300">
                    Network
                    <select className={`${fieldClass} mt-2`} value={provider} onChange={(e) => setProvider(e.target.value)}>
                      {MOMO_PROVIDERS.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-sm font-medium text-slate-300">
                    MoMo number
                    <input
                      className={`${fieldClass} mt-2`}
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="0551234567"
                      required={method === 'momo'}
                    />
                  </label>
                </div>
              ) : (
                <p className="rounded-2xl border border-slate-700 bg-slate-950/40 px-4 py-3 text-sm text-slate-400">
                  You will finish this payment on the bank checkout page.
                </p>
              )}
            </>
          ) : null}

          {step === 3 && momoPrompt ? (
            <div className="space-y-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
              <div className="flex items-start gap-3">
                {!momoPrompt.needs_code ? <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" /> : null}
                <p>
                  {momoPrompt.display_text ||
                    (momoPrompt.needs_code
                      ? momoPrompt.code_type === 'pin'
                        ? 'Enter the MoMo PIN from the prompt.'
                        : 'Enter the verification code sent for this payment.'
                      : 'Waiting for the confirmation prompt on your phone.')}
                </p>
              </div>
              {momoPrompt.needs_code ? (
                <label className="block text-sm font-medium text-emerald-50">
                  {momoPrompt.code_type === 'pin' ? 'MoMo PIN' : 'Verification code'}
                  <input
                    className={`${fieldClass} mt-2`}
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value)}
                    placeholder={momoPrompt.code_type === 'pin' ? 'Enter your PIN' : 'Enter the code'}
                    autoComplete={momoPrompt.code_type === 'pin' ? 'off' : 'one-time-code'}
                    inputMode="numeric"
                    autoFocus
                  />
                </label>
              ) : null}
            </div>
          ) : null}

          {error ? <p className="text-sm text-rose-300">{error}</p> : null}

          <div className="flex flex-wrap gap-2">
            {step > 1 && (!paying || momoPrompt) ? (
              <button
                type="button"
                onClick={() => {
                  if (momoPrompt) {
                    abortPayment('Payment cancelled. Tap Continue to payment to start again.');
                    return;
                  }
                  setError('');
                  setOtpCode('');
                  setPaying(false);
                  setStep(step - 1);
                }}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-600 px-4 py-3 text-sm font-semibold text-slate-200 hover:bg-slate-800"
              >
                <ArrowLeft className="h-4 w-4" />
                Back
              </button>
            ) : null}
            {momoPrompt ? (
              <button
                type="button"
                onClick={() => abortPayment('Payment cancelled. Tap Continue to payment to start again.')}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-rose-500/50 px-4 py-3 text-sm font-semibold text-rose-200 hover:bg-rose-950/40"
              >
                Cancel payment
              </button>
            ) : null}
            <button
              type="submit"
              disabled={
                paying ||
                lookingUp ||
                loadingSchools ||
                (step === 2 && (!info || isFullyPaid(info))) ||
                (step === 3 && !(Number(amount) > 0))
              }
              className="inline-flex min-w-0 flex-1 items-center justify-center gap-2 rounded-2xl bg-sky-500 px-5 py-3 font-semibold text-white hover:bg-sky-400 disabled:opacity-50"
            >
              {paying || lookingUp ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : step === 3 ? (
                <CreditCard className="h-4 w-4" />
              ) : (
                <Building2 className="h-4 w-4" />
              )}
              {submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default FeesPay;
