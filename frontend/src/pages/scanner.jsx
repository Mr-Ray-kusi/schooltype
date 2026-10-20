import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import QRCode from 'react-qr-code';
import { QrCode, CheckCircle, XCircle, Scan, Link2, Copy, ExternalLink, RefreshCw, Smartphone } from 'lucide-react';
import { extractAttendanceCode } from '../utils/studentIdQr';
import { invalidateCache } from '../utils/requestCache';
import toast from 'react-hot-toast';
import { useAuth } from '../contexts/authcontext';
import ScanIdentityCard from '../components/ScanIdentityCard';

const Scanner = () => {
  const { school } = useAuth();
  const [scanCode, setScanCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [scannerToken, setScannerToken] = useState(null);
  const [linkLoading, setLinkLoading] = useState(true);
  const [scannerOpen, setScannerOpen] = useState(true);
  const [scannerMessage, setScannerMessage] = useState('');
  const inputRef = useRef(null);
  const scanTimeoutRef = useRef(null);

  const mobileScannerUrl = scannerToken
    ? `${window.location.origin}/scan/${scannerToken}`
    : '';

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const fetchScannerLink = async () => {
      try {
        const response = await axios.get('/api/scanner/link');
        setScannerToken(response.data.token);
      } catch (err) {
        console.error('Failed to load scanner link:', err);
      } finally {
        setLinkLoading(false);
      }
    };

    fetchScannerLink();
  }, []);

  useEffect(() => {
    const loadWindow = async () => {
      try {
        const { data } = await axios.get('/api/attendance/settings');
        setScannerOpen(data.scannerOpen !== false);
        setScannerMessage(data.scannerMessage || '');
      } catch {
        // Keep the last known window if settings fail.
      }
    };
    loadWindow();
    const timer = window.setInterval(loadWindow, 30000);
    return () => window.clearInterval(timer);
  }, []);

  const handleSubmit = async (codeValue = null) => {
    const raw = codeValue || scanCode;
    const valueToSubmit = extractAttendanceCode(raw);
    if (!valueToSubmit) return;
    if (!scannerOpen) {
      setError(scannerMessage || 'Scanner is closed until the next attendance window.');
      return;
    }

    setLoading(true);
    setResult(null);
    setError(null);

    try {
      const response = await axios.post('/api/attendance/mark', { qrCode: valueToSubmit });
      invalidateCache('dashboard');
      invalidateCache('attendance');
      setResult(response.data);
      setScanCode('');
    } catch (err) {
      if (err.offlineQueued) {
        setResult({ message: 'Saved offline — will sync when online', user: { name: valueToSubmit, type: 'queued' } });
        setScanCode('');
        return;
      }
      const alreadyMarked = err.response?.data?.error === 'Attendance already marked for today';
      const scannedUser = err.response?.data?.user;
      if (alreadyMarked && scannedUser) {
        setResult({
          message: err.response.data.error,
          user: scannedUser,
          alreadyMarked: true,
        });
        setScanCode('');
        return;
      }
      setError(err.response?.data?.error || 'Failed to mark attendance');
    } finally {
      setLoading(false);
    }
  };

  const detectScanEnd = (currentCode) => {
    if (scanTimeoutRef.current) {
      clearTimeout(scanTimeoutRef.current);
    }

    scanTimeoutRef.current = setTimeout(() => {
      if (currentCode.trim().length > 5) {
        handleSubmit(currentCode);
      }
    }, 100);
  };

  const copyLink = async () => {
    if (!mobileScannerUrl) return;
    try {
      await navigator.clipboard.writeText(mobileScannerUrl);
      toast.success('Scanner link copied!');
    } catch {
      toast.error('Could not copy link');
    }
  };

  const regenerateLink = async () => {
    const confirmed = window.confirm(
      'Create a new scanner link? The current link will stop working on all phones until you share the new one.'
    );
    if (!confirmed) return;

    try {
      const response = await axios.post('/api/scanner/regenerate');
      setScannerToken(response.data.token);
      toast.success('New scanner link generated — old link is now invalid');
    } catch {
      toast.error('Failed to regenerate link');
    }
  };

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-white sm:text-3xl">Attendance Scanner</h1>
        <p className="mt-1 text-sm text-slate-400">
          Open the phone link at the gate, or type/scan a code here. The scanner only works from 4 hours before the late
          time until 30 minutes after it.
        </p>
        {scannerMessage ? (
          <p className={`mt-2 text-sm ${scannerOpen ? 'text-emerald-300' : 'text-amber-300'}`}>{scannerMessage}</p>
        ) : null}
      </div>

      <div className="rounded-2xl border border-sky-500/30 bg-gradient-to-br from-sky-500/15 to-slate-900 p-4 sm:p-6">
        <div className="mb-4 flex items-center gap-3">
          <div className="rounded-xl bg-sky-600 p-2">
            <Smartphone className="h-5 w-5 text-white" />
          </div>
          <h2 className="text-base font-semibold text-white sm:text-lg">Phone scanner</h2>
        </div>

        {linkLoading ? (
          <p className="text-sm text-slate-400">Loading scanner link...</p>
        ) : mobileScannerUrl ? (
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
            <div className="min-w-0 space-y-3">
              <div className="flex items-center gap-2 rounded-xl border border-slate-600 bg-slate-950/70 p-3">
                <Link2 className="h-5 w-5 shrink-0 text-sky-400" />
                <input
                  type="text"
                  readOnly
                  value={mobileScannerUrl}
                  className="min-w-0 flex-1 truncate bg-transparent text-sm text-slate-200 outline-none"
                />
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <button
                  type="button"
                  onClick={copyLink}
                  className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-500"
                >
                  <Copy className="h-4 w-4" />
                  Copy
                </button>
                <a
                  href={mobileScannerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-sky-400/40 bg-slate-900 px-3 py-2 text-sm font-medium text-sky-200 hover:bg-slate-800"
                >
                  <ExternalLink className="h-4 w-4" />
                  Open
                </a>
                <button
                  type="button"
                  onClick={regenerateLink}
                  className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"
                >
                  <RefreshCw className="h-4 w-4" />
                  New link
                </button>
              </div>
              {school?.name && (
                <p className="text-xs text-slate-400">
                  Unique to <span className="font-medium text-slate-200">{school.name}</span>.
                </p>
              )}
            </div>
            <div className="mx-auto rounded-xl bg-white p-3">
              <QRCode value={mobileScannerUrl} size={132} />
            </div>
          </div>
        ) : (
          <p className="text-sm text-red-400">Could not load scanner link. Refresh the page.</p>
        )}
      </div>

      <div className="rounded-2xl border border-slate-700 bg-slate-800/80 p-4 sm:p-6">
        <div className="mb-4 flex items-center gap-2">
          <QrCode className="h-5 w-5 text-slate-300" />
          <h2 className="text-base font-semibold text-white">Desktop / USB scanner</h2>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSubmit();
          }}
          className="space-y-3"
        >
          <label className="block text-sm font-medium text-slate-200">QR code input</label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              ref={inputRef}
              type="text"
              value={scanCode}
              onChange={(e) => {
                const newValue = e.target.value;
                setScanCode(newValue);
                detectScanEnd(newValue);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && scanCode.trim()) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              placeholder={scannerOpen ? 'Scan or paste QR code value' : 'Scanner is closed'}
              disabled={!scannerOpen}
              className="min-h-[48px] w-full flex-1 rounded-xl border border-slate-600 px-4 py-3 text-base disabled:opacity-50"
              autoComplete="off"
            />
            <button
              type="button"
              onClick={() => handleSubmit()}
              disabled={loading || !scanCode || !scannerOpen}
              className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-sky-600 px-5 py-3 font-medium text-white hover:bg-sky-500 disabled:opacity-50 sm:w-auto"
            >
              <Scan className="h-5 w-5" />
              {loading ? 'Processing…' : 'Mark'}
            </button>
          </div>
        </form>
      </div>

      {result && (
        <div
          className={`rounded-2xl border p-4 sm:p-5 ${
            result.alreadyMarked
              ? 'border-amber-400/40 bg-amber-500/15 text-amber-50'
              : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-50'
          }`}
        >
          <div className="mb-4 flex items-start gap-3">
            <CheckCircle
              className={`mt-0.5 h-7 w-7 shrink-0 ${
                result.alreadyMarked ? 'text-amber-300' : 'text-emerald-400'
              }`}
            />
            <div className="min-w-0">
              <h3 className="font-semibold">
                {result.alreadyMarked ? 'Already recorded' : 'Attendance marked'}
              </h3>
              <p className="break-words text-sm opacity-90">
                {result.message} at {new Date().toLocaleTimeString()}
              </p>
            </div>
          </div>
          <ScanIdentityCard user={result.user} alreadyMarked={Boolean(result.alreadyMarked)} />
        </div>
      )}

      {error && (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 sm:p-5">
          <div className="flex items-start gap-3">
            <XCircle className="mt-0.5 h-7 w-7 shrink-0 text-red-400" />
            <div>
              <h3 className="font-semibold text-red-100">Error</h3>
              <p className="text-sm text-red-200">{error}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Scanner;
