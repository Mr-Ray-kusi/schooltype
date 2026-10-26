import React, { useMemo, useState } from 'react';
import { Copy, Download, Edit2, Trash2, X } from 'lucide-react';

const ACCENTS = {
  sky: {
    badge: 'bg-sky-500/15 text-sky-200 ring-1 ring-sky-500/25',
  },
  emerald: {
    badge: 'bg-emerald-500/15 text-emerald-200 ring-1 ring-emerald-500/25',
  },
  violet: {
    badge: 'bg-violet-500/15 text-violet-200 ring-1 ring-violet-500/25',
  },
};

const PersonDetailModal = ({
  open,
  name,
  badge,
  fields = [],
  accent = 'sky',
  onClose,
  onEdit,
  onDelete,
  onDownload,
  downloadLabel = 'Download pack',
}) => {
  const [downloading, setDownloading] = useState(false);
  const [copiedLabel, setCopiedLabel] = useState('');
  const colors = ACCENTS[accent] || ACCENTS.sky;

  const groups = useMemo(() => {
    const visible = fields.filter((field) => field?.label);
    const sections = [];
    const index = new Map();
    visible.forEach((field) => {
      const title = field.group || '';
      if (!index.has(title)) {
        index.set(title, sections.length);
        sections.push({ title, items: [] });
      }
      sections[index.get(title)].items.push(field);
    });
    return sections;
  }, [fields]);

  if (!open) return null;

  const handleDownload = async () => {
    if (!onDownload || downloading) return;
    setDownloading(true);
    try {
      await onDownload();
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/70 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-sm sm:items-center sm:p-4">
      <div className="max-h-[min(92dvh,40rem)] w-full max-w-2xl overflow-hidden rounded-t-3xl border border-slate-700 bg-slate-900 shadow-2xl shadow-black/40 sm:rounded-3xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-800 px-5 py-4 sm:px-6">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Record</p>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="max-h-[calc(90vh-8.5rem)] overflow-y-auto px-5 py-5 sm:px-6">
          <div className="min-w-0">
            <h2 className="text-2xl font-bold tracking-tight text-white">{name || 'Details'}</h2>
            {badge ? (
              <span className={`mt-3 inline-flex rounded-full px-3 py-1 text-xs font-medium ${colors.badge}`}>
                {badge}
              </span>
            ) : null}
          </div>

          <div className="mt-6 space-y-6">
            {groups.map((group) => (
              <section key={group.title || 'details'}>
                {group.title ? (
                  <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                    {group.title}
                  </h3>
                ) : null}
                <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {group.items.map((field) => (
                    <div
                      key={`${group.title}-${field.label}`}
                      className="rounded-2xl border border-slate-800 bg-slate-950/50 px-4 py-3"
                    >
                      <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        {field.label}
                      </dt>
                      <dd className="mt-1.5 flex items-start justify-between gap-2 break-words text-sm text-slate-100">
                        <span className="min-w-0">{field.value || '—'}</span>
                        {field.copy && field.value ? (
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                await navigator.clipboard.writeText(String(field.value));
                                setCopiedLabel(field.label);
                                window.setTimeout(() => setCopiedLabel(''), 1500);
                              } catch {
                                /* ignore */
                              }
                            }}
                            className="shrink-0 rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
                            aria-label={`Copy ${field.label}`}
                            title="Copy"
                          >
                            <Copy className="h-4 w-4" />
                            <span className="sr-only">
                              {copiedLabel === field.label ? 'Copied' : 'Copy'}
                            </span>
                          </button>
                        ) : null}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-slate-800 bg-slate-950/40 px-5 py-4 sm:px-6">
          {onDownload ? (
            <button
              type="button"
              onClick={handleDownload}
              disabled={downloading}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-100 px-4 py-2.5 text-sm font-medium text-slate-900 hover:bg-white disabled:opacity-60"
            >
              <Download className="h-4 w-4" />
              {downloading ? 'Preparing…' : downloadLabel}
            </button>
          ) : null}
          {onEdit ? (
            <button
              type="button"
              onClick={onEdit}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-600 px-4 py-2.5 text-sm text-slate-100 hover:bg-slate-800"
            >
              <Edit2 className="h-4 w-4" />
              Edit
            </button>
          ) : null}
          {onDelete ? (
            <button
              type="button"
              onClick={onDelete}
              className="inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm text-red-300 hover:bg-red-500/10"
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default PersonDetailModal;
