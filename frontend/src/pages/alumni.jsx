import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';
import { ChevronDown, ChevronRight, Download, GraduationCap } from 'lucide-react';
import { useAuth } from '../contexts/authcontext';
import { invalidateCache, peekCache, staleGet } from '../utils/requestCache';
import { downloadAlumniStudentPdf } from '../utils/alumniRecordPdf';
import { ordinal } from '../utils/reportCardPdf';

const money = (value) =>
  `GHS ${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const Alumni = () => {
  const { school } = useAuth();
  const [overview, setOverview] = useState(null);
  const [year, setYear] = useState(null);
  const [batch, setBatch] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [openId, setOpenId] = useState(null);

  const loadOverview = useCallback(async () => {
    const cached = peekCache('alumni');
    if (cached) {
      setOverview(cached);
      setYear((current) => current || cached.year);
      setLoading(false);
    }
    try {
      const data = await staleGet('alumni', async () => (await axios.get('/api/alumni')).data, 30000);
      setOverview(data);
      setYear((current) => current || data.year);
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to load alumni');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadBatch = useCallback(async (batchYear) => {
    if (!batchYear) return;
    const cacheKey = `alumni:${batchYear}`;
    const cached = peekCache(cacheKey);
    if (cached) setBatch(cached);
    try {
      const data = await staleGet(
        cacheKey,
        async () => (await axios.get(`/api/alumni/batches/${batchYear}`)).data,
        30000
      );
      setBatch(data);
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to load this year batch');
      setBatch(null);
    }
  }, []);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    if (year) loadBatch(year);
  }, [year, loadBatch]);

  const markComplete = async () => {
    const confirmed = window.confirm(
      `Save ${overview?.completing_classes?.join(', ') || 'the completing class'} as the ${overview?.year} alumni batch? They will leave the current students list.`
    );
    if (!confirmed) return;
    setSaving(true);
    try {
      const { data } = await axios.post('/api/alumni/complete', { year: overview.year });
      toast.success(`${data.marked} student${data.marked === 1 ? '' : 's'} saved to ${data.year}`);
      invalidateCache('alumni');
      invalidateCache('students');
      invalidateCache('dashboard');
      setYear(data.year);
      await loadOverview();
      await loadBatch(data.year);
    } catch (error) {
      toast.error(error.response?.data?.error || 'Could not save this alumni batch');
    } finally {
      setSaving(false);
    }
  };

  const openStudent = (student) => {
    const opening = openId !== student.id;
    setOpenId(opening ? student.id : null);
    if (!opening) return;
    try {
      downloadAlumniStudentPdf(student, school?.name || 'School');
    } catch {
      toast.error('Could not build this student PDF');
    }
  };

  if (loading && !overview) {
    return <div className="py-10 text-center text-sm text-slate-400">Loading alumni…</div>;
  }

  const hierarchy = overview?.hierarchy || [];
  const batches = overview?.batches || [];
  const students = batch?.students || [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Alumni Status</h1>
          <p className="mt-0.5 text-sm text-slate-400">
            Completed records by year batch. Completing class is the last class in the school hierarchy.
          </p>
        </div>
        {overview?.completing_count > 0 ? (
          <button
            type="button"
            onClick={markComplete}
            disabled={saving}
            className="rounded-lg bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
          >
            {saving ? 'Saving…' : `Save ${overview.year} alumni`}
          </button>
        ) : null}
      </div>

      <section className="rounded-xl border border-slate-700 bg-slate-800 p-3">
        <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Class hierarchy</p>
        {hierarchy.length ? (
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-sm">
            {hierarchy.map((item, index) => (
              <React.Fragment key={`${item.name}-${index}`}>
                {index > 0 ? <span className="text-slate-600">→</span> : null}
                <span
                  className={`rounded-full px-2.5 py-1 ${
                    item.completing
                      ? 'bg-sky-500/20 font-semibold text-sky-200'
                      : 'bg-slate-900 text-slate-300'
                  }`}
                >
                  {item.name}
                  {item.completing ? ' · completing' : ''}
                </span>
              </React.Fragment>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-sm text-slate-400">Add classes in Setup so the completing year can be read.</p>
        )}
        <p className="mt-2 text-xs text-slate-400">
          {overview?.year} batch
          {overview?.term_name ? ` · ${overview.term_name}` : ''}
          {overview?.completing_classes?.length
            ? ` · ${overview.completing_classes.join(', ')}`
            : ''}
          {overview?.completing_count ? ` · ${overview.completing_count} still in class` : ''}
        </p>
      </section>

      <div className="flex flex-wrap gap-2">
        {batches.length ? (
          batches.map((item) => (
            <button
              key={item.year}
              type="button"
              onClick={() => setYear(item.year)}
              className={`rounded-lg border px-3 py-1.5 text-sm ${
                Number(year) === Number(item.year)
                  ? 'border-sky-500 bg-sky-500/15 text-white'
                  : 'border-slate-600 text-slate-300 hover:bg-slate-800'
              }`}
            >
              {item.year}
              <span className="ml-2 text-xs text-slate-400">
                {item.count} · {item.status === 'completing' ? 'completing' : 'alumni'}
              </span>
            </button>
          ))
        ) : (
          <p className="text-sm text-slate-400">No year batch yet. Students in the last class appear here.</p>
        )}
      </div>

      {!students.length ? (
        <div className="rounded-xl border border-slate-700 bg-slate-800 py-10 text-center text-sm text-slate-400">
          No student records for this year batch.
        </div>
      ) : (
        <div className="divide-y divide-slate-700 overflow-hidden rounded-xl border border-slate-700 bg-slate-800">
          {students.map((student) => {
            const open = openId === student.id;
            return (
              <div key={student.id}>
                <button
                  type="button"
                  onClick={() => openStudent(student)}
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-slate-700/40"
                >
                  {open ? (
                    <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
                  ) : (
                    <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
                  )}
                  <GraduationCap className="h-4 w-4 shrink-0 text-sky-300" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-white">{student.name}</span>
                    <span className="block truncate text-xs text-slate-400">
                      {student.class || '—'}
                      {student.roll_number ? ` · ${student.roll_number}` : ''}
                      {student.enrolled_year ? ` · enrolled ${student.enrolled_year}` : ''}
                    </span>
                  </span>
                  <span className="shrink-0 text-right text-xs text-slate-400">
                    {student.attendance?.present_days || 0} days
                    <span className="mt-0.5 block text-slate-300">{money(student.fees?.paid_amount)}</span>
                  </span>
                </button>
                {open ? (
                  <div className="space-y-4 bg-slate-900/50 px-4 py-3 text-sm">
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          try {
                            downloadAlumniStudentPdf(student, school?.name || 'School');
                          } catch {
                            toast.error('Could not build this student PDF');
                          }
                        }}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-600 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-800"
                      >
                        <Download className="h-3.5 w-3.5" />
                        Download PDF
                      </button>
                    </div>
                    {student.terms?.length ? (
                      student.terms.map((term) => (
                        <div key={term.key} className="rounded-lg border border-slate-700 p-3">
                          <p className="font-medium text-white">
                            {term.academic_year} · {term.term}
                            {term.class_name ? ` · ${term.class_name}` : ''}
                          </p>
                          <p className="mt-1 text-xs text-slate-400">
                            {term.attendance?.present_days || 0} days present
                            {term.attendance?.late_days ? ` · ${term.attendance.late_days} late` : ''}
                            {' · '}
                            {money(term.fees?.paid_amount)} fees
                            {term.overall_percent != null
                              ? ` · ${term.overall_percent}% ${term.overall_grade || ''}`
                              : ''}
                            {term.overall_position ? ` · ${ordinal(term.overall_position)}` : ''}
                          </p>
                          {term.subjects?.length ? (
                            <div className="mt-2 overflow-x-auto">
                              <table className="w-full min-w-[480px] text-left text-xs">
                                <thead className="text-slate-500">
                                  <tr>
                                    <th className="py-1 pr-2 font-medium">Subject</th>
                                    <th className="py-1 pr-2 font-medium">Score</th>
                                    <th className="py-1 pr-2 font-medium">Grade</th>
                                    <th className="py-1 pr-2 font-medium">Position</th>
                                    <th className="py-1 font-medium">Attitude</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {term.subjects.map((row, index) => (
                                    <tr key={`${row.subject}-${index}`} className="border-t border-slate-800 text-slate-200">
                                      <td className="py-1 pr-2">{row.subject}</td>
                                      <td className="py-1 pr-2">
                                        {row.score == null ? '—' : `${row.score}/${row.max_score || 100}`}
                                      </td>
                                      <td className="py-1 pr-2">{row.grade || '—'}</td>
                                      <td className="py-1 pr-2">{ordinal(row.position)}</td>
                                      <td className="py-1">{row.attitude || '—'}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          ) : (
                            <p className="mt-2 text-xs text-slate-500">No subjects recorded for this term.</p>
                          )}
                        </div>
                      ))
                    ) : (
                      <p className="text-slate-500">No term records from the day of enrollment yet.</p>
                    )}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default Alumni;
