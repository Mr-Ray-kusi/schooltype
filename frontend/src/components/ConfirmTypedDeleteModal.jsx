import React, { useEffect, useState } from 'react';
import { Trash2, X } from 'lucide-react';

const phraseOf = (value) => String(value || '').trim() || 'DELETE';

const ConfirmTypedDeleteModal = ({
  open,
  title = 'Confirm deletion',
  description,
  confirmText,
  actionLabel = 'Permanently delete',
  busyLabel = 'Deleting…',
  busy = false,
  onClose,
  onConfirm,
}) => {
  const phrase = phraseOf(confirmText);
  const [typed, setTyped] = useState('');

  useEffect(() => {
    if (open) setTyped('');
  }, [open, phrase]);

  if (!open) return null;

  const matches = typed.trim() === phrase;

  const submit = () => {
    if (!matches || busy) return;
    onConfirm?.();
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/70 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-sm sm:items-center sm:p-4">
      <div className="w-full max-w-md rounded-t-3xl border border-slate-700 bg-slate-900 p-6 shadow-2xl sm:rounded-3xl">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-bold text-white">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white disabled:opacity-50"
            aria-label="Cancel"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        {description ? (
          <p className="mt-3 text-sm leading-relaxed text-slate-100">{description}</p>
        ) : null}
        <p className="mt-4 rounded-xl bg-slate-950 px-3 py-2 font-mono text-sm text-amber-200">{phrase}</p>
        <label className="mt-4 block text-sm text-slate-100">
          Type the text above to confirm
          <input
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                submit();
              }
            }}
            autoFocus
            autoComplete="off"
            spellCheck={false}
            disabled={busy}
            className="mt-1.5 w-full rounded-xl border border-slate-600 bg-slate-950 px-3 py-2.5 font-mono text-sm text-white outline-none focus:border-sky-500 disabled:opacity-60"
            placeholder={phrase}
          />
        </label>
        <div className="mt-6 flex flex-col gap-2">
          <button
            type="button"
            disabled={busy || !matches}
            onClick={submit}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4" />
            {busy ? busyLabel : actionLabel}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="rounded-xl px-4 py-2 text-sm text-slate-100 hover:bg-slate-800 disabled:opacity-60"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmTypedDeleteModal;
