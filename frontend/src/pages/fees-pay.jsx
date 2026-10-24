import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import axios from 'axios';
import { ArrowLeft, Building2, CreditCard, Landmark, Loader2, Smartphone } from 'lucide-react';
import MarketingChrome from '../components/MarketingChrome';

const MOMO_PROVIDERS = [
  { id: 'mtn', label: 'MTN MoMo' },
  { id: 'vod', label: 'Telecel' },
  { id: 'atl', label: 'AT (AirtelTigo)' },
];

const momoNetworkFromPhone = (value) => {
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

const STEPS = [
  { id: 1, title: 'School and ID' },
  { id: 2, title: 'Verify' },
  { id: 3, title: 'Pay' },
];

const formatGhs = (value) =>
  `GHS ${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const isFullyPaid = (info) =>
  Boolean(info?.paid) || (Number(info?.fee_amount) > 0 && Number(info?.outstanding) < 0.01);

const fieldClass = 'mk-field mt-2';

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
    const timeout = momoPrompt.needs_code
      ? null
      : window.setTimeout(() => {
          abortPayment('MoMo PIN was not confirmed. Tap Continue to payment to start again.');
        }, remaining);

    let cancelled = false;
    const poll = async () => {
      try {
        const { data } = await axios.get(`/api/public/fees/charge/${encodeURIComponent(reference)}`, {
          timeout: 8000,
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
        if (data.needs_code) {
          setMomoPrompt((prev) => ({
            ...prev,
            needs_code: true,
            code_type: data.code_type || prev?.code_type || 'otp',
            display_text: data.display_text || prev?.display_text || 'Enter the 6-digit code sent to the phone.',
          }));
          setPaying(false);
          return;
        }
        if (data.status === 'cancelled') {
          abortPayment(
            data.display_text || 'Payment was cancelled on the phone. Tap Continue to payment to start again.'
          );
          return;
        }
        if (data.status === 'failed' || data.status === 'timeout') {
          abortPayment(data.display_text || 'Payment failed. Tap Continue to payment to start again.');
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
        provider: method === 'momo' ? momoNetworkFromPhone(phone) || provider : undefined,
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
        if (
          !data.needs_code &&
          (data.status === 'cancelled' || data.status === 'failed' || data.status === 'timeout')
        ) {
          setPaying(false);
          setStep(2);
          setError(
            data.display_text || 'Payment was cancelled on the phone. Tap Continue to payment to start again.'
          );
          if (data.reference) {
            axios.post('/api/public/fees/cancel', { reference: data.reference }, { timeout: 8000 }).catch(() => {});
          }
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
      if (data.needs_code) {
        setMomoPrompt((prev) => ({
          ...prev,
          reference: data.reference || prev?.reference,
          needs_code: true,
          display_text: data.display_text || prev?.display_text || 'Enter the 6-digit code sent for this payment.',
        }));
        setPaying(false);
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

  const askingForPin = Boolean(momoPrompt?.needs_code && momoPrompt.code_type === 'pin');
  const askingForOtp = Boolean(momoPrompt?.needs_code && momoPrompt.code_type !== 'pin');

  return (
    <MarketingChrome active="fees">
      <div className="mk-page">
        <div className="mx-auto w-full max-w-lg space-y-6">
          <header>
            <h1 className="font-serif text-4xl font-bold">Pay school fees</h1>
            <Link to="/" className="mt-3 inline-block text-sm font-semibold text-[var(--mk-forest)] underline-offset-2 hover:underline">
              Back to home
            </Link>
          </header>

          <ol className="grid grid-cols-3 gap-2">
            {STEPS.map((item) => {
              const current = step === item.id;
              const done = step > item.id;
              return (
                <li
                  key={item.id}
                  className={`border px-3 py-2 text-center ${
                    current
                      ? 'border-[var(--mk-forest)] bg-[var(--mk-forest)] text-[#fffaf2]'
                      : done
                        ? 'border-[var(--mk-brass)] bg-[var(--mk-card)] text-[var(--mk-ink)]'
                        : 'border-[var(--mk-line)] bg-[var(--mk-card)] text-[var(--mk-muted)]'
                  }`}
                >
                  <p className="text-[11px] font-semibold uppercase tracking-wide">{item.id}</p>
                  <p className="mt-0.5 text-xs font-semibold">{item.title}</p>
                </li>
              );
            })}
          </ol>

          <form onSubmit={onSubmit} className="mk-card space-y-4 p-6">
            {step === 1 ? (
              <>
                <label className="block text-sm font-semibold">
                  School
                  <select
                    className={fieldClass}
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
                <label className="block text-sm font-semibold">
                  Student ID
                  <input
                    className={fieldClass}
                    value={studentId}
                    onChange={(e) => {
                      setStudentId(e.target.value);
                      setInfo(null);
                    }}
                    placeholder="Student ID"
                    required
                  />
                </label>
                <p className="text-sm text-[var(--mk-muted)]">Enter the student ID from the school ID card.</p>
              </>
            ) : null}

            {step === 2 ? (
              lookingUp && !info ? (
                <p className="text-sm text-[var(--mk-muted)]">Finding student…</p>
              ) : info ? (
                <div className="border border-[var(--mk-line)] bg-[var(--mk-paper)] p-4">
                  <p className="font-serif text-xl font-bold">{info.student_name}</p>
                  <dl className="mt-4 space-y-2 text-sm">
                    <div className="flex justify-between gap-4">
                      <dt className="text-[var(--mk-muted)]">Class</dt>
                      <dd>{info.class_name || '—'}</dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="text-[var(--mk-muted)]">Student ID</dt>
                      <dd>{info.barcode || info.roll_number || studentId}</dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="text-[var(--mk-muted)]">Fee amount</dt>
                      <dd className="font-semibold">{formatGhs(info.fee_amount ?? info.amount)}</dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="text-[var(--mk-muted)]">Amount already paid</dt>
                      <dd>{formatGhs(info.paid_amount || 0)}</dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="text-[var(--mk-muted)]">Amount outstanding</dt>
                      <dd className="font-semibold">{formatGhs(info.outstanding ?? info.amount)}</dd>
                    </div>
                  </dl>
                  {isFullyPaid(info) ? (
                    <p className="mt-4 text-sm text-[var(--mk-forest)]">
                      There is no outstanding payment to make for {info.term_name || 'this term'}.
                    </p>
                  ) : null}
                </div>
              ) : (
                <p className="text-sm text-[var(--mk-clay)]">No student loaded. Go back and search again.</p>
              )
            ) : null}

            {step === 3 && info ? (
              <>
                <label className="block text-sm font-semibold">
                  Amount in GHS
                  <input
                    className={fieldClass}
                    type="number"
                    min="1"
                    step="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    required
                  />
                </label>

                <div>
                  <p className="text-sm font-semibold">Method</p>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {[
                      { id: 'momo', label: 'MoMo', Icon: Smartphone },
                      { id: 'bank', label: 'Bank', Icon: Landmark },
                    ].map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => setMethod(option.id)}
                        className={`border p-4 text-left ${
                          method === option.id
                            ? 'border-[var(--mk-forest)] bg-[var(--mk-paper)]'
                            : 'border-[var(--mk-line)]'
                        }`}
                      >
                        <option.Icon className="h-4 w-4 text-[var(--mk-forest)]" />
                        <p className="mt-2 text-sm font-semibold">{option.label}</p>
                      </button>
                    ))}
                  </div>
                </div>

                {method === 'momo' ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block text-sm font-semibold">
                      Phone number
                      <input
                        className={fieldClass}
                        value={phone}
                        onChange={(e) => {
                          const next = e.target.value;
                          setPhone(next);
                          const network = momoNetworkFromPhone(next);
                          if (network) setProvider(network);
                        }}
                        placeholder="0551234567"
                        required={method === 'momo'}
                      />
                    </label>
                    <label className="block text-sm font-semibold">
                      Network
                      <select className={fieldClass} value={provider} onChange={(e) => setProvider(e.target.value)}>
                        {MOMO_PROVIDERS.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                ) : (
                  <p className="border border-[var(--mk-line)] bg-[var(--mk-paper)] px-4 py-3 text-sm text-[var(--mk-muted)]">
                    You will finish this payment on the bank checkout page.
                  </p>
                )}
                {method === 'momo' ? (
                  <p className="text-sm text-[var(--mk-muted)]">
                    You will confirm the MoMo prompt on the phone. Schooltype does not ask for your MoMo PIN.
                  </p>
                ) : null}
              </>
            ) : null}

            {step === 3 && momoPrompt ? (
              <div className="space-y-3 border border-[var(--mk-line)] bg-[var(--mk-paper)] px-4 py-3 text-sm">
                <div className="flex items-start gap-3">
                  {!momoPrompt.needs_code || askingForPin ? <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" /> : null}
                  <p>
                    {askingForPin
                      ? 'You will confirm the MoMo prompt on the phone. Schooltype does not ask for your MoMo PIN.'
                      : momoPrompt.display_text ||
                        (askingForOtp
                          ? 'Enter the verification code sent for this payment.'
                          : 'Waiting for the confirmation prompt on your phone.')}
                  </p>
                </div>
                {askingForOtp ? (
                  <label className="block text-sm font-semibold">
                    Verification code
                    <input
                      className={fieldClass}
                      value={otpCode}
                      onChange={(e) => setOtpCode(e.target.value)}
                      placeholder="Enter the code"
                      autoComplete="one-time-code"
                      inputMode="numeric"
                      autoFocus
                    />
                  </label>
                ) : null}
              </div>
            ) : null}

            {error ? <p className="text-sm text-[var(--mk-clay)]">{error}</p> : null}

            <div className="flex flex-wrap gap-2">
              {step === 2 ? (
                <button
                  type="button"
                  onClick={() => {
                    setError('');
                    setInfo(null);
                    setStep(1);
                  }}
                  className="mk-btn mk-btn-outline"
                >
                  This is not my child
                </button>
              ) : null}
              {step > 1 && step !== 2 && (!paying || momoPrompt) ? (
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
                  className="mk-btn mk-btn-outline"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back
                </button>
              ) : null}
              {momoPrompt ? (
                <button
                  type="button"
                  onClick={() => abortPayment('Payment cancelled. Tap Continue to payment to start again.')}
                  className="mk-btn mk-btn-outline"
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
                  askingForPin ||
                  (step === 2 && (!info || isFullyPaid(info))) ||
                  (step === 3 && !(Number(amount) > 0))
                }
                className="mk-btn mk-btn-primary inline-flex min-w-0 flex-1 items-center justify-center gap-2 disabled:opacity-50"
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
    </MarketingChrome>
  );
};

export default FeesPay;
