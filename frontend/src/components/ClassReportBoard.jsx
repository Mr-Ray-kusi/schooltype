import React, { useEffect, useState } from 'react';
import { GraduationCap } from 'lucide-react';
import { letterGrade, ordinal } from '../utils/reportCardPdf';
import { sortClasses } from '../utils/classHierarchy';

const orderedClassNames = (classes) => {
  const seen = new Set();
  const unique = [];
  for (const value of classes || []) {
    const name = String(value || '').trim();
    const key = name.toLowerCase().replace(/\s+/g, ' ');
    if (!name || seen.has(key)) continue;
    seen.add(key);
    unique.push({ name });
  }
  return sortClasses(unique).map((row) => row.name);
};

const termSelectClass =
  'rounded-lg border border-slate-700/80 bg-slate-900/80 px-3 py-2 text-sm text-slate-100 outline-none focus:border-slate-500';

export default function ClassReportBoard({
  classes = [],
  classCounts = {},
  selectedClass = '',
  onSelectClass,
  selectedTerm = 'all',
  onSelectTerm,
  terms = [],
  ranked = [],
  loading = false,
  toolbar = null,
  selectable = false,
  selectedKeys = [],
  onToggleStudent,
  onToggleAll,
  renderRowActions,
  studentKey = (row) => row.student_id || `${row.student_name}-${row.class_name}`,
}) {
  const [expandedKey, setExpandedKey] = useState(null);
  const classNames = orderedClassNames(classes);
  const allSelected = ranked.length > 0 && ranked.every((row) => selectedKeys.includes(studentKey(row)));

  useEffect(() => {
    setExpandedKey(null);
  }, [selectedClass, selectedTerm]);

  const termField = (
    <label className="text-sm text-slate-200">
      <span className="sr-only">Term</span>
      <select
        value={selectedTerm}
        onChange={(event) => onSelectTerm?.(event.target.value)}
        className={termSelectClass}
      >
        <option value="all">All terms</option>
        {terms.map((term) => (
          <option key={term} value={term}>
            {term}
          </option>
        ))}
      </select>
    </label>
  );

  if (!selectedClass) {
    return (
      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-white">Classes</h2>
            <p className="mt-0.5 text-sm text-slate-200">Choose a class to see every student ranked by total marks.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {termField}
            {toolbar}
          </div>
        </div>
        {loading && !classNames.length ? (
          <p className="rounded-2xl border border-slate-800 bg-slate-900/40 px-5 py-10 text-center text-sm text-slate-200">
            Loading classes…
          </p>
        ) : classNames.length === 0 ? (
          <p className="rounded-2xl border border-slate-800 bg-slate-900/40 px-5 py-10 text-center text-sm text-slate-200">
            No classes yet. Add classes in Setup, then students will appear here.
          </p>
        ) : (
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {classNames.map((name) => {
              const count = classCounts[name];
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => onSelectClass?.(name)}
                  className="rounded-xl border border-slate-800 bg-slate-900/50 p-3.5 text-left transition hover:border-slate-600 hover:bg-slate-900 xl:p-5"
                >
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-slate-800 text-slate-100 xl:h-9 xl:w-9">
                    <GraduationCap className="h-3.5 w-3.5" />
                  </span>
                  <p className="mt-2.5 text-sm font-bold text-white xl:text-base">{name}</p>
                  <p className="mt-0.5 text-xs font-medium text-slate-300 xl:text-sm">
                    {typeof count === 'number' ? `${count} student${count === 1 ? '' : 's'}` : 'Open class ranking'}
                  </p>
                </button>
              );
            })}
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="space-y-5">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <button
            type="button"
            onClick={() => onSelectClass?.('')}
            className="inline-flex items-center rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-sky-500"
          >
            Classes
          </button>
          <h2 className="mt-1.5 truncate text-xl font-extrabold tracking-tight text-white xl:text-3xl">{selectedClass}</h2>
          <p className="mt-1 text-sm text-slate-300">
            {loading ? 'Loading…' : `${ranked.length} student${ranked.length === 1 ? '' : 's'} ranked by total marks`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {termField}
          {toolbar}
        </div>
      </header>

      <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/30">
        {selectable && ranked.length ? (
          <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2.5 text-xs text-slate-300">
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={onToggleAll}
                aria-label="Select all students"
                className="h-3.5 w-3.5 rounded border-slate-600 bg-slate-900"
              />
              Select all
            </label>
            <span>{selectedKeys.length} selected</span>
          </div>
        ) : null}

        {loading ? (
          <p className="px-5 py-12 text-center text-sm text-slate-300">Loading class ranking…</p>
        ) : ranked.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-slate-300">No students in this class yet.</p>
        ) : (
          <ol>
            {ranked.map((row, index) => {
              const key = studentKey(row);
              const open = expandedKey === key;
              const total =
                row.totalMax > 0 ? `${row.totalMarks ?? 0}/${row.totalMax}` : String(row.totalMarks ?? 0);
              return (
                <li key={key} className={index > 0 ? 'border-t border-slate-800/80' : ''}>
                  <div
                    className={`flex cursor-pointer items-center gap-3 px-3 py-2.5 sm:gap-4 sm:px-4 ${
                      open ? 'bg-slate-900/80' : 'hover:bg-slate-900/50'
                    }`}
                    onClick={() => setExpandedKey(open ? null : key)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setExpandedKey(open ? null : key);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                    aria-expanded={open}
                  >
                    {selectable ? (
                      <span onClick={(event) => event.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selectedKeys.includes(key)}
                          onChange={() => onToggleStudent?.(key)}
                          aria-label={`Select ${row.student_name}`}
                          className="h-3.5 w-3.5 rounded border-slate-600 bg-slate-900"
                        />
                      </span>
                    ) : null}
                    <span
                      className={`w-8 shrink-0 text-sm tabular-nums ${
                        row.position <= 3 ? 'font-semibold text-white' : 'text-slate-300'
                      }`}
                    >
                      {row.position}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-white">{row.student_name}</span>
                      <span className="block truncate text-xs text-slate-300">{row.roll_number || 'No student ID'}</span>
                    </span>
                    <span className="hidden shrink-0 tabular-nums text-sm text-slate-100 sm:inline">{total}</span>
                    <span className="w-14 shrink-0 text-right text-sm tabular-nums text-slate-200">
                      {row.overallPercent != null ? `${row.overallPercent}%` : '—'}
                    </span>
                    {renderRowActions ? (
                      <span className="shrink-0" onClick={(event) => event.stopPropagation()}>
                        {renderRowActions(row)}
                      </span>
                    ) : null}
                  </div>
                  {open ? (
                    <div className="border-t border-slate-800/60 bg-slate-950/40 px-4 py-3 sm:px-16">
                      {row.subjects?.length ? (
                        <ul className="space-y-2">
                          {row.subjects.map((subject) => (
                            <li
                              key={subject.id || `${subject.subject}-${subject.teacher_id}`}
                              className="flex items-baseline justify-between gap-4 text-sm"
                            >
                              <span className="min-w-0 truncate text-slate-100">{subject.subject || '—'}</span>
                              <span className="shrink-0 tabular-nums text-slate-200">
                                {subject.score == null ? '—' : `${subject.score}/${subject.max_score ?? 100}`}
                                {subject.position ? ` · ${ordinal(subject.position)}` : ''}
                                {subject.percent != null ? ` · ${letterGrade(subject.percent)}` : ''}
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-sm text-slate-300">No subject scores saved yet.</p>
                      )}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </section>
  );
}
