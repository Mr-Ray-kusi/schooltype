import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { downloadFeeReceiptPdf, formatGhs } from '../utils/feeReceiptPdf';
import MarketingChrome from '../components/MarketingChrome';

const FeesReceipt = () => {
  const [params] = useSearchParams();
  const reference = params.get('reference') || params.get('trxref') || '';
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!reference) {
      setError('Missing payment reference.');
      setLoading(false);
      return undefined;
    }
    let cancelled = false;
    let attempts = 0;
    const load = async () => {
      try {
        const { data } = await axios.get(`/api/public/fees/verify/${encodeURIComponent(reference)}`);
        if (cancelled) return;
        setResult(data);
        if (data.status === 'success' || data.status === 'failed' || data.status === 'timeout') {
          setLoading(false);
          return;
        }
        attempts += 1;
        if (attempts < 20) {
          window.setTimeout(load, 3000);
          return;
        }
        setLoading(false);
      } catch (err) {
        if (!cancelled) {
          setError(err.response?.data?.error || 'Could not confirm this payment.');
          setLoading(false);
        }
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [reference]);

  const success = result?.status === 'success';
  const outstanding = Number(result?.outstanding) || 0;
  const hasBalance = success && outstanding >= 0.01;

  const savePdf = () => {
    if (!result) return;
    downloadFeeReceiptPdf({
      schoolName: result.school_name || 'School',
      studentName: result.student_name || 'Student',
      className: result.class_name,
      rollNumber: result.roll_number,
      periodLabel: result.period_label || result.term_name || result.payment_month,
      feeAmount: result.fee_amount,
      paidAmount: result.paid_amount ?? result.amount,
      outstanding: result.outstanding,
      payments: result.payments || [],
      reference,
      recordedBy: result.recorded_by || 'Online',
    });
  };

  return (
    <MarketingChrome active="fees">
      <div className="mk-page">
        <div className="mx-auto w-full max-w-lg">
          <div className="mk-card p-8">
            {loading ? (
              <p className="text-[var(--mk-muted)]">Confirming payment…</p>
            ) : error ? (
              <p className="text-[var(--mk-clay)]">{error}</p>
            ) : (
              <>
                <h1 className="font-serif text-3xl font-bold">
                  {success ? 'Payment successful' : 'Payment not complete'}
                </h1>
                <dl className="mt-6 space-y-3 text-sm">
                  <div className="flex justify-between gap-4">
                    <dt className="text-[var(--mk-muted)]">Student name</dt>
                    <dd className="font-semibold">{result.student_name || 'Student'}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-[var(--mk-muted)]">Amount</dt>
                    <dd className="font-semibold">{formatGhs(result.amount)}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-[var(--mk-muted)]">Reference</dt>
                    <dd className="font-semibold">{reference}</dd>
                  </div>
                </dl>
                {hasBalance ? (
                  <p className="mt-4 text-sm text-[var(--mk-muted)]">
                    A balance of {formatGhs(outstanding)} is still due for this period.
                  </p>
                ) : null}
                {success ? (
                  <button type="button" onClick={savePdf} className="mk-btn mk-btn-primary mt-6">
                    Download receipt
                  </button>
                ) : null}
              </>
            )}
            <div className="mt-8 flex flex-wrap gap-4 text-sm">
              <Link to="/" className="font-semibold text-[var(--mk-forest)] underline-offset-2 hover:underline">
                Back to home
              </Link>
              <Link to="/fees" className="font-semibold text-[var(--mk-forest)] underline-offset-2 hover:underline">
                Pay fees
              </Link>
            </div>
          </div>
        </div>
      </div>
    </MarketingChrome>
  );
};

export default FeesReceipt;
