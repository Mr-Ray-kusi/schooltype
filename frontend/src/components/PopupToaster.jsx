import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import toast, { useToaster } from 'react-hot-toast';
import { AlertTriangle, CheckCircle2, Info, Loader2 } from 'lucide-react';

const kindOf = (type) => {
  if (type === 'error') return 'error';
  if (type === 'success') return 'success';
  if (type === 'loading') return 'loading';
  return 'notice';
};

const titleOf = (kind) => {
  if (kind === 'error') return 'Warning';
  if (kind === 'success') return 'Done';
  if (kind === 'loading') return 'Please wait';
  return 'Notice';
};

const IconOf = ({ kind }) => {
  if (kind === 'error') return <AlertTriangle className="h-6 w-6" />;
  if (kind === 'success') return <CheckCircle2 className="h-6 w-6" />;
  if (kind === 'loading') return <Loader2 className="h-6 w-6 animate-spin" />;
  return <Info className="h-6 w-6" />;
};

const PopupCard = ({ t }) => {
  const kind = kindOf(t.type);
  const message = typeof t.message === 'function' ? t.message(t) : t.message;
  const dismiss = () => {
    if (kind === 'loading') return;
    toast.dismiss(t.id);
  };

  return (
    <div
      className={`popup-toast-layer ${t.visible ? 'is-open' : ''}`}
      onClick={dismiss}
      role="presentation"
    >
      <div
        className={`popup-toast is-${kind}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={`popup-toast-title-${t.id}`}
        aria-describedby={`popup-toast-body-${t.id}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="popup-toast-icon" aria-hidden="true">
          <IconOf kind={kind} />
        </div>
        <p id={`popup-toast-title-${t.id}`} className="popup-toast-title">
          {titleOf(kind)}
        </p>
        <div id={`popup-toast-body-${t.id}`} className="popup-toast-body">
          {message}
        </div>
        {kind === 'loading' ? null : (
          <button type="button" className="popup-toast-ok" onClick={dismiss}>
            OK
          </button>
        )}
      </div>
    </div>
  );
};

const PopupToaster = () => {
  const { toasts } = useToaster({
    duration: 8000,
    success: { duration: 6000 },
    error: { duration: Infinity },
  });

  useEffect(() => {
    const wrap = (fn) => (message, options) => {
      toast.dismiss();
      return fn(message, options);
    };
    const original = toast;
    const success = original.success.bind(original);
    const error = original.error.bind(original);
    const loading = original.loading.bind(original);
    original.success = wrap(success);
    original.error = wrap(error);
    original.loading = wrap(loading);
    return () => {
      original.success = success;
      original.error = error;
      original.loading = loading;
    };
  }, []);

  const active = [...toasts].reverse().find((item) => item.visible);
  if (!active || typeof document === 'undefined') return null;

  return createPortal(<PopupCard t={active} />, document.body);
};

export default PopupToaster;
