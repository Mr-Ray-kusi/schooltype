import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import { BrowserQRCodeReader } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType, NotFoundException } from '@zxing/library';
import { extractAttendanceCode } from '../utils/studentIdQr';
import { invalidateCache } from '../utils/requestCache';
import { CheckCircle, XCircle, Camera, Loader2 } from 'lucide-react';
import ScanIdentityCard from '../components/ScanIdentityCard';

const SCAN_COOLDOWN_MS = 1600;
const IDENTITY_HOLD_MS = 12000;

const buildQrHints = () => {
  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE]);
  hints.set(DecodeHintType.TRY_HARDER, true);
  hints.set(DecodeHintType.ASSUME_GS1, false);
  return hints;
};

async function applySharpFocus(stream) {
  const track = stream?.getVideoTracks?.()?.[0];
  if (!track?.applyConstraints) return;

  const caps = track.getCapabilities?.() || {};
  const advanced = [];

  if (Array.isArray(caps.focusMode)) {
    if (caps.focusMode.includes('continuous')) advanced.push({ focusMode: 'continuous' });
    else if (caps.focusMode.includes('auto')) advanced.push({ focusMode: 'auto' });
    else if (caps.focusMode.includes('single-shot')) advanced.push({ focusMode: 'single-shot' });
  }

  if (caps.pointsOfInterest) {
    advanced.push({ pointsOfInterest: [{ x: 0.5, y: 0.5 }] });
  }

  if (typeof caps.sharpness?.max === 'number') {
    advanced.push({ sharpness: caps.sharpness.max });
  }

  try {
    if (advanced.length) {
      await track.applyConstraints({ advanced });
    } else {
      await track.applyConstraints({
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        facingMode: 'environment',
      });
    }
  } catch {
    // Device may ignore focus constraints; the high-res stream still helps.
  }
}

async function openRearCamera() {
  const attempts = [
    {
      audio: false,
      video: {
        facingMode: { exact: 'environment' },
        width: { min: 1280, ideal: 1920 },
        height: { min: 720, ideal: 1080 },
        frameRate: { ideal: 30 },
      },
    },
    {
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 30 },
      },
    },
    { audio: false, video: { facingMode: { ideal: 'environment' } } },
    { audio: false, video: true },
  ];

  let lastError = null;
  for (const constraints of attempts) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      await applySharpFocus(stream);
      return stream;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error('Camera unavailable');
}

const MobileScanner = () => {
  const { token } = useParams();
  const videoRef = useRef(null);
  const controlsRef = useRef(null);
  const readerRef = useRef(null);
  const scanLockRef = useRef(false);
  const resumeTimerRef = useRef(null);
  const mountedRef = useRef(true);
  const markAttendanceRef = useRef(async () => {});

  const [schoolName, setSchoolName] = useState('');
  const [loading, setLoading] = useState(true);
  const [invalidLink, setInvalidLink] = useState(false);
  const [cameraError, setCameraError] = useState(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [scannerOpen, setScannerOpen] = useState(true);
  const [scannerMessage, setScannerMessage] = useState('');

  const stopScanner = useCallback(() => {
    if (resumeTimerRef.current) {
      clearTimeout(resumeTimerRef.current);
      resumeTimerRef.current = null;
    }

    try {
      controlsRef.current?.stop?.();
    } catch {
      // ignore
    }
    controlsRef.current = null;

    try {
      readerRef.current?.reset?.();
    } catch {
      // ignore
    }
    readerRef.current = null;

    const video = videoRef.current;
    if (video?.srcObject) {
      try {
        video.srcObject.getTracks?.().forEach((track) => track.stop());
      } catch {
        // ignore
      }
      video.srcObject = null;
    }
  }, []);

  const startScanner = useCallback(async () => {
    if (!videoRef.current || scanLockRef.current || !mountedRef.current) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('This browser cannot open the camera. Use Chrome or Safari over HTTPS.');
      return;
    }

    setCameraError(null);
    setCameraReady(false);
    stopScanner();

    try {
      const reader = new BrowserQRCodeReader(buildQrHints(), {
        delayBetweenScanAttempts: 80,
        delayBetweenScanSuccess: 400,
        tryPlayVideoTimeout: 5000,
      });
      readerRef.current = reader;

      const stream = await openRearCamera();
      const video = videoRef.current;
      if (!video) {
        stream.getTracks().forEach((track) => track.stop());
        throw new Error('Camera view is not ready');
      }

      video.setAttribute('playsinline', 'true');
      video.setAttribute('webkit-playsinline', 'true');
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      try {
        await video.play();
      } catch {
        // zxing may attach and play the stream itself
      }

      const onResult = (result, error) => {
        if (!mountedRef.current || scanLockRef.current) return;
        if (error && !(error instanceof NotFoundException)) {
          if (error?.name && error.name !== 'NotFoundException') {
            console.warn('QR decode error:', error.name, error.message);
          }
          return;
        }
        if (!result) return;
        const text = result.getText?.()?.trim?.() || '';
        if (text) markAttendanceRef.current(text);
      };

      let controls = null;
      if (typeof reader.decodeFromStream === 'function') {
        controls = await reader.decodeFromStream(stream, video, onResult);
      } else {
        controls = await reader.decodeFromConstraints(
          { audio: false, video: { facingMode: { ideal: 'environment' } } },
          video,
          onResult
        );
      }

      controlsRef.current = controls;
      if (mountedRef.current) setCameraReady(true);
    } catch (err) {
      if (!mountedRef.current) return;
      console.error('Scanner camera/decode error:', err);
      const name = err?.name || '';
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        setCameraError('Camera permission blocked. Allow camera access for this site and reload.');
      } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        setCameraError('No camera found on this device.');
      } else if (window.isSecureContext === false) {
        setCameraError('Camera requires HTTPS. Open the scanner link from the secure school URL.');
      } else {
        setCameraError('Could not start QR scanning. Allow camera permission and tap retry.');
      }
      setCameraReady(false);
    }
  }, [stopScanner]);

  const markAttendance = useCallback(
    async (rawCode) => {
      const attendanceCode = extractAttendanceCode(rawCode);
      if (!attendanceCode) return;
      if (!scannerOpen) return;
      if (scanLockRef.current) return;

      // Keep the camera stream warm — full stop/restart made the next scan feel slow.
      scanLockRef.current = true;
      setFeedback({
        type: 'pending',
        title: 'Reading…',
        message: 'Marking attendance',
      });

      let holdMs = SCAN_COOLDOWN_MS;
      try {
        const response = await axios.post(`/api/scanner/mark/${token}`, { qrCode: attendanceCode });
        invalidateCache('dashboard');
        invalidateCache('attendance');
        if (!mountedRef.current) return;
        holdMs = IDENTITY_HOLD_MS;
        setFeedback({
          type: 'success',
          title: 'Recorded!',
          message: response.data.message,
          user: response.data.user,
          alreadyMarked: false,
        });
      } catch (err) {
        if (!mountedRef.current) return;
        const alreadyMarked = err.response?.data?.error === 'Attendance already marked for today';
        const scannedUser = err.response?.data?.user;
        if (alreadyMarked && scannedUser) {
          holdMs = IDENTITY_HOLD_MS;
          setFeedback({
            type: 'success',
            title: 'Already recorded',
            message: err.response.data.error,
            user: scannedUser,
            alreadyMarked: true,
          });
        } else {
          setFeedback({
            type: 'error',
            title: 'Not recorded',
            message: err.response?.data?.error || 'Could not mark attendance',
          });
        }
      }

      resumeTimerRef.current = setTimeout(() => {
        if (!mountedRef.current) return;
        scanLockRef.current = false;
        setFeedback(null);
      }, holdMs);
    },
    [token, scannerOpen]
  );

  markAttendanceRef.current = markAttendance;

  // Load school info first — camera must wait until <video> is mounted.
  useEffect(() => {
    mountedRef.current = true;

    const loadSchool = async (first = false) => {
      try {
        const response = await axios.get(`/api/scanner/school/${token}`);
        if (!mountedRef.current) return;
        setSchoolName(response.data.schoolName);
        setScannerOpen(response.data.scannerOpen !== false);
        setScannerMessage(response.data.scannerMessage || '');
        setInvalidLink(false);
      } catch {
        if (!mountedRef.current) return;
        if (first) setInvalidLink(true);
      } finally {
        if (mountedRef.current && first) setLoading(false);
      }
    };

    loadSchool(true);
    const timer = window.setInterval(() => loadSchool(false), 30000);

    return () => {
      mountedRef.current = false;
      window.clearInterval(timer);
      stopScanner();
    };
  }, [token, stopScanner]);

  // Start camera/decoder once, after the video element exists.
  useEffect(() => {
    if (loading || invalidLink || !schoolName || !scannerOpen) return undefined;

    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (!cancelled) startScanner();
    }, 150);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      stopScanner();
    };
    // Intentionally only re-run when the page becomes ready — not when startScanner identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, invalidLink, schoolName, scannerOpen]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center text-slate-200">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  if (invalidLink) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-6 text-center">
        <XCircle className="w-16 h-16 text-red-400 mb-4" />
        <h1 className="text-xl font-semibold text-white mb-2">Invalid scanner link</h1>
        <p className="text-slate-300">Ask your school admin for a new attendance scanner link.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 text-white flex flex-col">
      <header className="px-4 py-5 text-center border-b border-slate-700">
        <p className="text-xs uppercase tracking-wider text-slate-400 mb-1">Attendance Scanner</p>
        <h1 className="text-lg font-semibold">{schoolName}</h1>
        {scannerMessage ? (
          <p className={`mt-2 text-sm ${scannerOpen ? 'text-emerald-300' : 'text-amber-300'}`}>{scannerMessage}</p>
        ) : null}
      </header>

      {!scannerOpen ? (
        <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
          <XCircle className="mb-4 h-16 w-16 text-amber-400" />
          <h2 className="text-xl font-semibold text-white">Scanner is closed</h2>
          <p className="mt-2 max-w-sm text-sm text-slate-300">
            {scannerMessage || 'Attendance can only be taken from 4 hours before the late time until 30 minutes after it.'}
          </p>
        </div>
      ) : (
      <div className="flex-1 flex flex-col items-center justify-center p-4 relative">
        <div className="relative w-full max-w-md min-h-[55vh] aspect-[3/4] max-h-[72vh] rounded-2xl overflow-hidden bg-black border-2 border-slate-600">
          <video
            ref={videoRef}
            className="h-full w-full object-contain bg-black"
            playsInline
            muted
            autoPlay
            onClick={async (event) => {
              const video = videoRef.current;
              const track = video?.srcObject?.getVideoTracks?.()?.[0];
              if (!track?.getCapabilities || !track.applyConstraints) return;
              const caps = track.getCapabilities();
              if (!caps.pointsOfInterest) return;
              const rect = video.getBoundingClientRect();
              const x = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
              const y = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
              try {
                await track.applyConstraints({ advanced: [{ pointsOfInterest: [{ x, y }] }] });
              } catch {
                // tap-to-focus is optional
              }
            }}
          />
          {!cameraReady && !cameraError && !feedback && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/70 text-sm text-slate-200 gap-2">
              <Loader2 className="w-5 h-5 animate-spin" />
              Opening camera…
            </div>
          )}
          {cameraReady && !feedback && (
            <div className="absolute inset-0 pointer-events-none">
              <div className="absolute inset-8 border-2 border-primary-400/70 rounded-xl" />
              <div className="absolute bottom-4 left-0 right-0 text-center text-sm text-white/90 bg-black/40 py-2">
                Hold the QR still, 15–25cm from the camera. Tap to focus.
              </div>
            </div>
          )}
        </div>

        {cameraError && (
          <div className="mt-4 flex flex-col items-center gap-3 text-red-300 text-sm max-w-sm text-center">
            <div className="flex items-start gap-2">
              <Camera className="w-5 h-5 shrink-0 mt-0.5" />
              <span>{cameraError}</span>
            </div>
            <button
              type="button"
              onClick={() => {
                scanLockRef.current = false;
                startScanner();
              }}
              className="rounded-full bg-sky-500 px-4 py-2 text-white font-medium hover:bg-sky-400"
            >
              Try camera again
            </button>
          </div>
        )}

        {feedback?.type === 'pending' && (
          <div className="absolute inset-x-4 top-1/2 -translate-y-1/2 max-w-sm mx-auto bg-slate-800 rounded-2xl p-8 text-center shadow-2xl animate-fade-in z-10 border border-slate-600">
            <Loader2 className="w-12 h-12 mx-auto mb-4 text-sky-300 animate-spin" />
            <h2 className="text-xl font-bold mb-1">{feedback.title}</h2>
            <p className="text-slate-300 text-sm">{feedback.message}</p>
          </div>
        )}

        {feedback?.type === 'success' && (
          <div
            className={`absolute inset-x-4 top-1/2 z-10 mx-auto max-h-[85vh] w-full max-w-sm -translate-y-1/2 overflow-y-auto rounded-2xl p-6 text-white shadow-2xl animate-fade-in ${
              feedback.alreadyMarked ? 'bg-amber-600' : 'bg-green-600'
            }`}
          >
            <CheckCircle className="mx-auto mb-3 h-12 w-12 text-white" />
            <h2 className="mb-3 text-center text-xl font-bold">{feedback.title}</h2>
            <ScanIdentityCard
              user={feedback.user}
              message={
                feedback.user?.punctuality
                  ? feedback.user.punctuality === 'late'
                    ? 'Late'
                    : 'Early'
                  : feedback.message
              }
              alreadyMarked={Boolean(feedback.alreadyMarked)}
            />
            <button
              type="button"
              onClick={() => {
                if (resumeTimerRef.current) {
                  clearTimeout(resumeTimerRef.current);
                  resumeTimerRef.current = null;
                }
                scanLockRef.current = false;
                setFeedback(null);
              }}
              className="mt-4 w-full rounded-xl bg-white/15 px-4 py-2.5 text-sm font-semibold text-white hover:bg-white/25"
            >
              Scan next
            </button>
          </div>
        )}

        {feedback?.type === 'error' && (
          <div className="absolute inset-x-4 top-1/2 -translate-y-1/2 max-w-sm mx-auto bg-red-600 rounded-2xl p-8 text-center shadow-2xl animate-fade-in z-10">
            <XCircle className="w-20 h-20 mx-auto mb-4 text-white" />
            <h2 className="text-2xl font-bold mb-2">{feedback.title}</h2>
            <p className="text-red-100">{feedback.message}</p>
          </div>
        )}
      </div>
      )}

      <footer className="px-4 py-4 text-center text-xs text-slate-400 border-t border-slate-700">
        Records appear on the school admin dashboard only
      </footer>

      <style>{`
        @keyframes fade-in {
          from { opacity: 0; transform: scale(0.95); }
          to { opacity: 1; transform: scale(1); }
        }
        .animate-fade-in { animation: fade-in 0.25s ease-out; }
      `}</style>
    </div>
  );
};

export default MobileScanner;
