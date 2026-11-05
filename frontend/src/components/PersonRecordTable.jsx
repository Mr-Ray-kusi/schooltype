import React from 'react';

const cellText = (col, row) => {
  if (col.render) return col.render(row);
  const value = row[col.key];
  return value == null || value === '' ? '—' : value;
};

const titleOf = (value) => (typeof value === 'string' || typeof value === 'number' ? String(value) : undefined);

const PersonRecordTable = ({ columns, rows, onSelect, minWidth = '720px', compact = false, nowrap = compact }) => {
  if (!rows?.length) return null;
  const cellPad = compact ? 'px-2 py-1.5 text-xs' : 'px-3 py-2 text-xs sm:text-sm xl:px-4 xl:py-2.5 xl:text-[15px]';
  const cell = `${cellPad}${nowrap ? ' whitespace-nowrap' : ''}`;
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
              {cellText(primary, row)}
            </p>
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-400">
              {rest.map((col) => (
                <div key={col.key} className="min-w-0">
                  <dt className="uppercase tracking-wide text-slate-500">{col.header}</dt>
                  <dd className="mt-0.5 truncate text-slate-200">
                    {cellText(col, row)}
                  </dd>
                </div>
              ))}
            </dl>
          </button>
        ))}
      </div>

      <div className="hidden overflow-x-auto rounded-xl border border-slate-700 md:block">
        <table
          className={`w-full text-left ${compact ? 'text-xs' : 'text-sm'}${nowrap ? ' table-fixed' : ''}`}
          style={nowrap ? undefined : { minWidth }}
        >
          <thead className="bg-slate-800 text-slate-300">
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={`${cell} font-medium ${col.className || ''}`}
                  style={col.width ? { width: col.width } : undefined}
                >
                  <span className="block truncate">{col.header}</span>
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
                {columns.map((col) => {
                  const value = cellText(col, row);
                  const clip = nowrap && col.truncate !== false;
                  return (
                    <td
                      key={col.key}
                      className={`${cell} ${clip ? 'max-w-0 overflow-hidden' : ''} ${col.className || ''}`}
                    >
                      <span className={clip ? 'block truncate' : 'block whitespace-nowrap'} title={titleOf(value)}>
                        {value}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
};

export default PersonRecordTable;
