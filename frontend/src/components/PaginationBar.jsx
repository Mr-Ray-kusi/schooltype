import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

const PaginationBar = ({ page = 1, total = 0, limit = 50, onPageChange }) => {
  const pages = Math.max(1, Math.ceil(Number(total || 0) / Number(limit || 50)));
  const current = Math.min(Math.max(1, Number(page) || 1), pages);
  const from = total === 0 ? 0 : (current - 1) * limit + 1;
  const to = Math.min(current * limit, total);

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-slate-400">
        Showing {from}–{to} of {total}
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={current <= 1}
          onClick={() => onPageChange(current - 1)}
          className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-40"
        >
          <ChevronLeft className="h-4 w-4" />
          Prev
        </button>
        <span className="min-w-[4.5rem] text-center text-sm text-slate-300">
          {current} / {pages}
        </span>
        <button
          type="button"
          disabled={current >= pages}
          onClick={() => onPageChange(current + 1)}
          className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-40"
        >
          Next
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
};

export default PaginationBar;
