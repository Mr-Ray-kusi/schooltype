import React, { useState } from 'react';
import { ChevronDown, ChevronRight, GraduationCap } from 'lucide-react';
import { letterGrade, ordinal } from '../utils/reportCardPdf';
import { sortClasses } from '../utils/classHierarchy';

const formatWhen = (iso) => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return iso;
  }
};

const orderedClassNames = (classes) =>
  sortClasses(
    (classes || [])
      .map((name) => ({ name: String(name || '').trim() }))
      .filter((row) => row.name)
  ).map((row) => row.name);

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

  if (!selectedClass) {
    return (
      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">Classes</h2>
            <p className="mt-1 text-sm text-slate-400">Choose a class to see every student ranked by total marks.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm text-slate-300">
              <span className="sr-only">Term</span>
              <select
                value={selectedTerm}
                onChange={(event) => onSelectTerm?.(event.target.value)}
                className="rounded-xl border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100"
              >
                <option value="all">All terms</option>
                {terms.map((term) => (
                  <option key={term} value={term}>
                    {term}
                  </option>
                ))}
              </select>
            </label>
            {toolbar}
          </div>
        </div>
        {loading && !classNames.length ? (
          <p className="rounded-3xl border border-slate-700 bg-slate-900/50 px-5 py-10 text-center text-sm text-slate-400">
            Loading classes…
          </p>
        ) : classNames.length === 0 ? (
          <p className="rounded-3xl border border-slate-700 bg-slate-900/50 px-5 py-10 text-center text-sm text-slate-400">
            No classes yet. Add classes in Setup, then students will appear here.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {classNames.map((name) => {
              const count = classCounts[name];
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => onSelectClass?.(name)}
                  className="rounded-3xl border border-slate-700 bg-slate-900/70 p-5 text-left hover:border-sky-500/60 hover:bg-slate-900"
                >
                  <span className="inline-flex h-9 w-9 items-center justify-center rounded-2xl bg-sky-500/15 text-sky-300">
                    <GraduationCap className="h-4 w-4" />
                  </span>
                  <p className="mt-3 text-lg font-semibold text-white">{name}</p>
                  <p className="mt-1 text-sm text-slate-400">
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
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <button
            type="button"
            onClick={() => onSelectClass?.('')}
            className="text-sm font-semibold text-sky-300 hover:text-sky-200"
          >
            ← All classes
          </button>
          <h2 className="mt-1 text-xl font-semibold text-white">{selectedClass}</h2>
          <p className="text-sm text-slate-400">Ranked by total marks and position in class.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm text-slate-300">
            <span className="sr-only">Term</span>
            <select
              value={selectedTerm}
              onChange={(event) => onSelectTerm?.(event.target.value)}
              className="rounded-xl border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100"
            >
              <option value="all">All terms</option>
              {terms.map((term) => (
                <option key={term} value={term}>
                  {term}
                </option>
              ))}
            </select>
          </label>
          {toolbar}
        </div>
      </div>

      <div className="overflow-x-auto rounded-3xl border border-slate-700 bg-slate-900">
        <table className="min-w-full text-left text-sm text-slate-200">
          <thead>
            <tr className="border-b border-slate-700 text-slate-300">
              <th className="w-10 px-4 py-4" />
              {selectable ? (
                <th className="px-4 py-4">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={onToggleAll}
                    aria-label="Select all students"
                    className="h-4 w-4 rounded border-slate-500 bg-slate-800"
                  />
                </th>
              ) : null}
              <th className="px-4 py-4">Position</th>
              <th className="px-6 py-4">Student</th>
              <th className="px-6 py-4">Student ID</th>
              <th className="px-6 py-4">Total marks</th>
              <th className="px-6 py-4">Average</th>
              {renderRowActions ? <th className="px-6 py-4">Print</th> : null}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="px-6 py-10 text-center text-slate-400">
                  Loading class ranking…
                </td>
              </tr>
            ) : ranked.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-6 py-10 text-center text-slate-400">
                  No students in this class yet.
                </td>
              </tr>
            ) : (
              ranked.map((row, index) => {
                const key = studentKey(row);
                const open = expandedKey === key;
                return (
                  <React.Fragment key={key}>
                    <tr
                      className={`cursor-pointer ${index % 2 === 0 ? 'bg-slate-800' : 'bg-slate-900'} ${
                        open ? 'bg-sky-950/40' : 'hover:bg-slate-700/80'
                      }`}
                      onClick={() => setExpandedKey(open ? null : key)}
                    >
                      <td className="px-4 py-4 text-slate-400">
                        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </td>
                      {selectable ? (
                        <td className="px-4 py-4" onClick={(event) => event.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selectedKeys.includes(key)}
                            onChange={() => onToggleStudent?.(key)}
                            aria-label={`Select ${row.student_name}`}
                            className="h-4 w-4 rounded border-slate-500 bg-slate-800"
                          />
                        </td>
                      ) : null}
                      <td className="px-4 py-4 font-semibold text-white">{ordinal(row.position)}</td>
                      <td className="px-6 py-4 text-white">{row.student_name}</td>
                      <td className="px-6 py-4 text-slate-300">{row.roll_number || '—'}</td>
                      <td className="px-6 py-4">
                        {row.totalMarks ?? 0}
                        {row.totalMax ? `/${row.totalMax}` : ''}
                      </td>
                      <td className="px-6 py-4">
                        {row.overallPercent != null ? (
                          <span className="rounded-full bg-emerald-600 px-2 py-1 text-xs text-white">
                            {letterGrade(row.overallPercent)} · {row.overallPercent}%
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      {renderRowActions ? (
                        <td className="px-6 py-4" onClick={(event) => event.stopPropagation()}>
                          {renderRowActions(row)}
                        </td>
                      ) : null}
                    </tr>
                    {open ? (
                      <tr className="bg-slate-950/80">
                        <td colSpan={8} className="px-6 py-4">
                          {row.subjects?.length ? (
                            <div className="overflow-x-auto rounded-2xl border border-slate-700">
                              <table className="min-w-full text-left text-sm text-slate-200">
                                <thead>
                                  <tr className="border-b border-slate-700 text-slate-400">
                                    <th className="px-4 py-3">Subject</th>
                                    <th className="px-4 py-3">Score</th>
                                    <th className="px-4 py-3">Position</th>
                                    <th className="px-4 py-3">Teacher</th>
                                    <th className="px-4 py-3">Remark</th>
                                    <th className="px-4 py-3">Updated</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {row.subjects.map((subject) => (
                                    <tr
                                      key={subject.id || `${subject.subject}-${subject.teacher_id}`}
                                      className="border-b border-slate-800 last:border-0"
                                    >
                                      <td className="px-4 py-3 font-medium text-white">{subject.subject || '—'}</td>
                                      <td className="px-4 py-3">
                                        {subject.score == null ? '—' : `${subject.score}/${subject.max_score ?? 100}`}
                                        {subject.percent != null ? ` · ${subject.percent}%` : ''}
                                      </td>
                                      <td className="px-4 py-3">{subject.position ? ordinal(subject.position) : '—'}</td>
                                      <td className="px-4 py-3">{subject.teacher_name || '—'}</td>
                                      <td className="px-4 py-3 text-slate-300">{subject.remark || '—'}</td>
                                      <td className="px-4 py-3 text-slate-400">{formatWhen(subject.updated_at)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          ) : (
                            <p className="text-sm text-slate-400">No subject scores have been saved for this student yet.</p>
                          )}
                        </td>
                      </tr>
                    ) : null}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
