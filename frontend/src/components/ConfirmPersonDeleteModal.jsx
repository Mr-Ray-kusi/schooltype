import React, { useState } from 'react';
import { Download, Trash2, X } from 'lucide-react';

const ConfirmPersonDeleteModal = ({
  open,
  name,
  kind = 'student',
  onClose,
  onDownload,
  onRemove,
}) => {
  const [busy, setBusy] = useState('');
  if (!open) return null;

  const label = kind === 'staff' ? 'staff member' : kind === 'non-staff' ? 'non-staff member' : 'student';

  const run = async (action, key) => {
    if (busy) return;
    setBusy(key);
    try {
      await action();
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-3xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-bold text-white">Remove {name || 'this person'}?</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={Boolean(busy)}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white disabled:opacity-50"
            aria-label="Cancel"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-slate-300">
          Permanently removing this {label} deletes their attendance, reports, fee receipts, and the
          rest of their record. Download their details first if the school still needs a copy.
        </p>
        <div className="mt-6 flex flex-col gap-2">
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={() => run(onDownload, 'download')}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-100 px-4 py-2.5 text-sm font-medium text-slate-900 hover:bg-white disabled:opacity-60"
          >
            <Download className="h-4 w-4" />
            {busy === 'download' ? 'Preparing…' : 'Download details'}
          </button>
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={() => run(onRemove, 'remove')}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-rose-500 disabled:opacity-60"
          >
            <Trash2 className="h-4 w-4" />
            {busy === 'remove' ? 'Removing…' : 'Permanently remove records'}
          </button>
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={onClose}
            className="rounded-xl px-4 py-2 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-60"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmPersonDeleteModal;
