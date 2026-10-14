import React from 'react';

const PersonRecordTable = ({ columns, rows, onSelect, minWidth = '720px', compact = false }) => {
  if (!rows?.length) return null;
  const cell = compact ? 'px-3 py-2' : 'px-4 py-3';

  return (
    <div className="overflow-x-auto rounded-3xl border border-slate-700">
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
  );
};

export default PersonRecordTable;
