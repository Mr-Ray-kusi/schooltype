import React from 'react';

const PersonRecordTable = ({ columns, rows, onSelect, minWidth = '720px', compact = false }) => {
  if (!rows?.length) return null;
  const cell = compact ? 'px-3 py-2' : 'px-4 py-3';
  const primary = columns[0];
  const rest = columns.slice(1);

  return (
    <>
      <div className="space-y-2 md:hidden">
        {rows.map((row) => (
          <button
            key={`${row.kind || 'person'}:${row.id}`}
            type="button"
            onClick={() => onSelect?.(row)}
            className="w-full rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 text-left text-slate-100"
          >
            <p className="truncate text-sm font-semibold text-white">
              {primary?.render ? primary.render(row) : row[primary?.key] || '—'}
            </p>
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-400">
              {rest.map((col) => (
                <div key={col.key} className="min-w-0">
                  <dt className="uppercase tracking-wide text-slate-500">{col.header}</dt>
                  <dd className="mt-0.5 truncate text-slate-200">
                    {col.render ? col.render(row) : row[col.key] || '—'}
                  </dd>
                </div>
              ))}
            </dl>
          </button>
        ))}
      </div>

      <div className="hidden overflow-x-auto rounded-3xl border border-slate-700 md:block">
        <table className="w-full text-left text-sm" style={{ minWidth }}>
          <thead className="bg-slate-800 text-slate-300">
            <tr>
              {columns.map((col) => (
                <th key={col.key} className={`${cell} font-medium`}>
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={`${row.kind || 'person'}:${row.id}`}
                onClick={() => onSelect?.(row)}
                className="cursor-pointer border-t border-slate-700 bg-slate-900 text-slate-100 hover:bg-slate-800/80"
              >
                {columns.map((col) => (
                  <td key={col.key} className={cell}>
                    {col.render ? col.render(row) : row[col.key] || '—'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
};

export default PersonRecordTable;
