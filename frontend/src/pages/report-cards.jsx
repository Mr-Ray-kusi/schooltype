import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';
import { ChevronDown, ChevronRight, Download, FileText, Printer, RefreshCw, Trash2 } from 'lucide-react';
import { useAuth } from '../contexts/authcontext';
import { useLivePoll } from '../hooks/useLivePoll';
import { forceGet, invalidateCache, peekCache, staleGet, REPORT_CACHE_MS } from '../utils/requestCache';
import PaginationBar from '../components/PaginationBar';
import { LIST_PAGE_SIZE, fetchAllPages } from '../utils/listApi.js';
import {
  downloadStudentReportCardsPdf,
  downloadSubjectRankingsPdf,
  letterGrade,
  ordinal,
  rankStudentsForReports,
} from '../utils/reportCardPdf';

const formatWhen = (iso) => {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return iso;
  }
};

const studentKey = (row) => row.student_id || `${row.student_name}-${row.class_name}`;

const ReportCards = () => {
  const { school } = useAuth();
  const [scores, setScores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedClass, setSelectedClass] = useState('all');
  const [selectedSubject, setSelectedSubject] = useState('all');
  const [selectedTerm, setSelectedTerm] = useState('all');
  const [selectedStudentKeys, setSelectedStudentKeys] = useState([]);
  const [clearing, setClearing] = useState(false);
  const [expandedEntryKey, setExpandedEntryKey] = useState(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [filterOptions, setFilterOptions] = useState({ classes: [], subjects: [], terms: [] });

  const loadScores = useCallback(async ({ silent = false, force = false } = {}) => {
    const cacheKey = `report-cards:scores:${page}:${selectedClass}:${selectedSubject}:${selectedTerm}`;
    if (!silent && !force) {
      const cached = peekCache(cacheKey);
      if (cached) {
        setScores(cached.scores || []);
        setTotal(Number(cached.total) || 0);
        if (cached.filters) setFilterOptions(cached.filters);
        setLoading(false);
      }
    }
    try {
      const fetcher = async () => {
        const res = await axios.get('/api/report-cards/scores', {
          params: {
            page,
            limit: LIST_PAGE_SIZE,
            class: selectedClass !== 'all' ? selectedClass : undefined,
            subject: selectedSubject !== 'all' ? selectedSubject : undefined,
            term: selectedTerm !== 'all' ? selectedTerm : undefined,
            refresh: silent ? undefined : '1',
          },
        });
        return res.data;
      };
      const data = silent
        ? await staleGet(cacheKey, fetcher, 0)
        : force
          ? await forceGet(cacheKey, fetcher)
          : await staleGet(cacheKey, fetcher, REPORT_CACHE_MS);
      setScores(data.scores || []);
      setTotal(Number(data.total) || 0);
      if (data.filters) setFilterOptions(data.filters);
    } catch (err) {
      if (!silent) {
        toast.error(err.response?.data?.error || 'Failed to load teacher scores');
        setScores([]);
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [page, selectedClass, selectedSubject, selectedTerm]);

  useEffect(() => {
    loadScores({ silent: false });
  }, [loadScores]);

  useEffect(() => {
    setPage(1);
  }, [selectedClass, selectedSubject, selectedTerm]);

  useLivePoll(() => loadScores({ silent: true }), 60000, !loading);

  useEffect(() => {
    setExpandedEntryKey(null);
  }, [selectedClass, selectedSubject, selectedTerm]);

  const classes = useMemo(() => {
    const set = new Set([
      ...filterOptions.classes,
      ...scores.map((row) => row.class_name).filter(Boolean),
    ]);
    return ['all', ...Array.from(set).sort((a, b) => a.localeCompare(b))];
  }, [filterOptions.classes, scores]);

  const subjects = useMemo(() => {
    const set = new Set([
      ...filterOptions.subjects,
      ...scores.map((row) => row.subject).filter(Boolean),
    ]);
    return ['all', ...Array.from(set).sort((a, b) => a.localeCompare(b))];
  }, [filterOptions.subjects, scores]);

  const terms = useMemo(() => {
    const set = new Set([...filterOptions.terms, ...scores.map((row) => row.term).filter(Boolean)]);
    return ['all', ...Array.from(set).sort((a, b) => a.localeCompare(b))];
  }, [filterOptions.terms, scores]);

  const filtered = useMemo(() => {
    return scores.filter((row) => {
      if (selectedClass !== 'all' && row.class_name !== selectedClass) return false;
      if (selectedSubject !== 'all' && row.subject !== selectedSubject) return false;
      if (selectedTerm !== 'all' && row.term !== selectedTerm) return false;
      return true;
    });
  }, [scores, selectedClass, selectedSubject, selectedTerm]);

  const studentsForPrint = useMemo(() => {
    const ranked = rankStudentsForReports(scores, {
      className: selectedClass,
      term: selectedTerm,
    });
    return ranked
      .map((row) => ({
        key: studentKey(row),
        student_id: row.student_id,
        student_name: row.student_name,
        class_name: row.class_name,
        roll_number: row.roll_number,
        term: row.term,
        entryCount: row.subjects?.length || 0,
        totalMarks: row.totalMarks,
        totalMax: row.totalMax,
        overallPercent: row.overallPercent,
        position: row.position,
      }))
      .sort((a, b) => {
        if ((a.position || 0) !== (b.position || 0)) return (a.position || 0) - (b.position || 0);
        return String(a.student_name || '').localeCompare(String(b.student_name || ''));
      });
  }, [scores, selectedClass, selectedTerm]);

  const studentScoreEntries = useMemo(() => {
    const classTermRows = scores.filter((row) => {
      if (selectedClass !== 'all' && row.class_name !== selectedClass) return false;
      if (selectedTerm !== 'all' && row.term !== selectedTerm) return false;
      return true;
    });

    const byStudent = new Map();
    for (const row of classTermRows) {
      const key = `${studentKey(row)}::${row.term || ''}`;
      if (!byStudent.has(key)) {
        byStudent.set(key, {
          key,
          student_id: row.student_id,
          student_name: row.student_name,
          class_name: row.class_name,
          roll_number: row.roll_number,
          term: row.term,
          subjects: [],
        });
      }
      byStudent.get(key).subjects.push(row);
    }

    let entries = Array.from(byStudent.values()).map((entry) => {
      const subjects = [...entry.subjects].sort((a, b) =>
        String(a.subject || '').localeCompare(String(b.subject || ''))
      );
      const latest = subjects.reduce((stamp, row) => {
        const time = new Date(row.updated_at || row.created_at || 0).getTime();
        return Number.isFinite(time) && time > stamp ? time : stamp;
      }, 0);
      const teachers = [...new Set(subjects.map((row) => row.teacher_name).filter(Boolean))];
      return {
        ...entry,
        subjects,
        teacherNames: teachers,
        updated_at: latest ? new Date(latest).toISOString() : null,
      };
    });

    if (selectedSubject !== 'all') {
      entries = entries.filter((entry) =>
        entry.subjects.some((row) => row.subject === selectedSubject)
      );
    }

    return entries.sort((a, b) =>
      String(a.student_name || '').localeCompare(String(b.student_name || ''))
    );
  }, [scores, selectedClass, selectedSubject, selectedTerm]);

  const uniqueStudents = useMemo(
    () => new Set(filtered.map((row) => studentKey(row))).size,
    [filtered]
  );

  const uniqueTeachers = useMemo(
    () => new Set(filtered.map((row) => row.teacher_id).filter(Boolean)).size,
    [filtered]
  );

  const allStudentsSelected =
    studentsForPrint.length > 0 &&
    studentsForPrint.every((student) => selectedStudentKeys.includes(student.key));

  const toggleStudent = (key) => {
    setSelectedStudentKeys((prev) =>
      prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]
    );
  };

  const toggleSelectAllStudents = () => {
    if (allStudentsSelected) {
      setSelectedStudentKeys([]);
      return;
    }
    setSelectedStudentKeys(studentsForPrint.map((student) => student.key));
  };

  const handleClearAllScores = async () => {
    if (!scores.length) {
      toast.error('There are no teacher score entries to clear');
      return;
    }

    const confirmed = window.confirm(
      `Delete all ${scores.length} teacher score ${scores.length === 1 ? 'entry' : 'entries'} for this school?\n\nThis cannot be undone.`
    );
    if (!confirmed) return;

    setClearing(true);
    try {
      const { data } = await axios.delete('/api/report-cards/scores');
      invalidateCache('report-cards');
      setScores([]);
      setSelectedStudentKeys([]);
      toast.success(data?.message || 'Teacher score entries cleared');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to clear teacher score entries');
    } finally {
      setClearing(false);
    }
  };

  const loadFilteredScores = async () =>
    fetchAllPages(axios, '/api/report-cards/scores', {
      class: selectedClass !== 'all' ? selectedClass : undefined,
      subject: selectedSubject !== 'all' ? selectedSubject : undefined,
      term: selectedTerm !== 'all' ? selectedTerm : undefined,
    });

  const handleRankingsPdf = async () => {
    const allScores = await loadFilteredScores();
    if (!allScores.length) {
      toast.error('No scores to export for the current filters');
      return;
    }
    downloadSubjectRankingsPdf({
      scores: allScores,
      schoolName: school?.name || 'School',
      className: selectedClass,
      term: selectedTerm,
      subject: selectedSubject,
    });
    toast.success('Subject rankings PDF downloaded');
  };

  const handleStudentCardsPdf = async (studentIds) => {
    const ids = studentIds || selectedStudentKeys;
    if (!ids.length) {
      toast.error('Select at least one student to print a personal report');
      return;
    }

    const allScores = await loadFilteredScores();
    const scoped = allScores.filter((row) => {
      if (selectedClass !== 'all' && row.class_name !== selectedClass) return false;
      if (selectedTerm !== 'all' && row.term !== selectedTerm) return false;
      return ids.includes(studentKey(row));
    });

    if (!scoped.length) {
      toast.error('No scores found for the selected students');
      return;
    }

    const count = downloadStudentReportCardsPdf({
      scores: allScores,
      schoolName: school?.name || 'School',
      className: selectedClass,
      term: selectedTerm,
      studentIds: ids,
    });
    toast.success(
      count === 1
        ? 'Personal student report downloaded'
        : `${count} reports downloaded, each named after the student`
    );
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">Report Cards</h1>
        </div>
        <div className="flex w-full min-w-0 flex-nowrap items-center gap-2 overflow-x-auto pb-1">
          <button
            type="button"
            disabled={loading}
            onClick={() => {
              setLoading(true);
              invalidateCache('report-cards');
              loadScores({ silent: false, force: true });
            }}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-slate-600 px-3 py-2 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-70 sm:px-4 sm:py-2.5 sm:text-sm"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            type="button"
            onClick={handleRankingsPdf}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-sky-600 px-3 py-2 text-xs font-semibold text-white hover:bg-sky-500 sm:px-4 sm:py-2.5 sm:text-sm"
          >
            <Download className="h-4 w-4" />
            Subject rankings PDF
          </button>
          <button
            type="button"
            onClick={() => handleStudentCardsPdf()}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-500 sm:px-4 sm:py-2.5 sm:text-sm"
          >
            <Printer className="h-4 w-4" />
            Print selected reports
          </button>
        </div>
      </div>

      <section className="rounded-3xl border border-slate-700 bg-slate-800 p-6 shadow-xl">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">Filters</h2>
          </div>
          <div className="grid w-full gap-3 sm:grid-cols-3 lg:max-w-3xl">
            <label className="block text-sm text-slate-300">
              Class
              <select
                value={selectedClass}
                onChange={(e) => setSelectedClass(e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-slate-600 bg-slate-700 px-4 py-3 text-slate-50"
              >
                {classes.map((className) => (
                  <option key={className} value={className}>
                    {className === 'all' ? 'All classes' : className}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm text-slate-300">
              Subject
              <select
                value={selectedSubject}
                onChange={(e) => setSelectedSubject(e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-slate-600 bg-slate-700 px-4 py-3 text-slate-50"
              >
                {subjects.map((subject) => (
                  <option key={subject} value={subject}>
                    {subject === 'all' ? 'All subjects' : subject}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm text-slate-300">
              Term
              <select
                value={selectedTerm}
                onChange={(e) => setSelectedTerm(e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-slate-600 bg-slate-700 px-4 py-3 text-slate-50"
              >
                {terms.map((term) => (
                  <option key={term} value={term}>
                    {term === 'all' ? 'All terms' : term}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          <div className="rounded-3xl bg-slate-900 p-5">
            <p className="text-sm uppercase tracking-wide text-slate-300">Score entries</p>
            <p className="mt-4 text-3xl font-semibold text-white">{filtered.length}</p>
          </div>
          <div className="rounded-3xl bg-slate-900 p-5">
            <p className="text-sm uppercase tracking-wide text-slate-300">Students graded</p>
            <p className="mt-4 text-3xl font-semibold text-white">{uniqueStudents}</p>
          </div>
          <div className="rounded-3xl bg-slate-900 p-5">
            <p className="text-sm uppercase tracking-wide text-slate-300">Teachers submitting</p>
            <p className="mt-4 text-3xl font-semibold text-white">{uniqueTeachers}</p>
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-slate-700 bg-slate-800 p-6 shadow-xl">
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-sky-400" />
            <div>
              <h2 className="text-lg font-semibold text-white">Teacher score entries</h2>
              <p className="text-xs text-slate-400">Click a student to see every subject, score, and remark.</p>
            </div>
          </div>
          <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-end">
            <button
              type="button"
              onClick={handleClearAllScores}
              disabled={clearing || !scores.length}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-red-500/40 px-4 py-2.5 text-sm text-red-300 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" />
              {clearing ? 'Clearing...' : 'Clear all entries'}
            </button>
          </div>
        </div>

        <div className="overflow-x-auto rounded-3xl border border-slate-700 bg-slate-900">
          <table className="min-w-full text-left text-sm text-slate-200">
            <thead>
              <tr className="border-b border-slate-700 text-slate-300">
                <th className="w-10 px-4 py-4" />
                <th className="px-6 py-4">Student</th>
                <th className="px-6 py-4">Class</th>
                <th className="px-6 py-4">Term</th>
                <th className="px-6 py-4">Subjects</th>
                <th className="px-6 py-4">Teachers</th>
                <th className="px-6 py-4">Updated</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-6 py-10 text-center text-slate-400">
                    Loading teacher scores...
                  </td>
                </tr>
              ) : studentScoreEntries.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-10 text-center text-slate-400">
                    No scores yet.
                  </td>
                </tr>
              ) : (
                studentScoreEntries.map((entry, index) => {
                  const open = expandedEntryKey === entry.key;
                  return (
                    <React.Fragment key={entry.key}>
                      <tr
                        className={`cursor-pointer ${index % 2 === 0 ? 'bg-slate-800' : 'bg-slate-900'} ${
                          open ? 'bg-sky-950/40' : 'hover:bg-slate-700/80'
                        }`}
                        onClick={() => setExpandedEntryKey(open ? null : entry.key)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            setExpandedEntryKey(open ? null : entry.key);
                          }
                        }}
                        tabIndex={0}
                        aria-expanded={open}
                      >
                        <td className="px-4 py-4 text-slate-400">
                          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </td>
                        <td className="px-6 py-4 text-white">
                          <div className="font-medium">{entry.student_name}</div>
                          {entry.roll_number ? (
                            <div className="text-xs text-slate-500">{entry.roll_number}</div>
                          ) : null}
                        </td>
                        <td className="px-6 py-4">{entry.class_name || '-'}</td>
                        <td className="px-6 py-4">{entry.term || '-'}</td>
                        <td className="px-6 py-4">{entry.subjects.length}</td>
                        <td className="px-6 py-4">{entry.teacherNames.join(', ') || '-'}</td>
                        <td className="px-6 py-4 text-slate-400">{formatWhen(entry.updated_at)}</td>
                      </tr>
                      {open ? (
                        <tr className="bg-slate-950/80">
                          <td colSpan={7} className="px-6 py-4">
                            <div className="overflow-x-auto rounded-2xl border border-slate-700">
                              <table className="min-w-full text-left text-sm text-slate-200">
                                <thead>
                                  <tr className="border-b border-slate-700 text-slate-400">
                                    <th className="px-4 py-3">Subject</th>
                                    <th className="px-4 py-3">Score</th>
                                    <th className="px-4 py-3">Attitude</th>
                                    <th className="px-4 py-3">Teacher</th>
                                    <th className="px-4 py-3">Remark</th>
                                    <th className="px-4 py-3">Updated</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {entry.subjects.map((row) => (
                                    <tr key={row.id || `${row.subject}-${row.teacher_id}`} className="border-b border-slate-800 last:border-0">
                                      <td className="px-4 py-3 font-medium text-white">{row.subject || '-'}</td>
                                      <td className="px-4 py-3">
                                        <div className="flex flex-wrap items-center gap-2">
                                          <span className="font-semibold text-white">
                                            {row.score == null ? '-' : `${row.score}/${row.max_score ?? 100}`}
                                          </span>
                                          {row.percent != null ? (
                                            <span className="rounded-full bg-emerald-600 px-2 py-1 text-xs text-white">
                                              {letterGrade(row.percent)} - {row.percent}%
                                            </span>
                                          ) : null}
                                        </div>
                                      </td>
                                      <td className="px-4 py-3">{row.attitude || '-'}</td>
                                      <td className="px-4 py-3">{row.teacher_name || '-'}</td>
                                      <td className="px-4 py-3 text-slate-300">{row.remark || '-'}</td>
                                      <td className="px-4 py-3 text-slate-400">{formatWhen(row.updated_at)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
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
        <div className="mt-4">
          <PaginationBar page={page} total={total} limit={LIST_PAGE_SIZE} onPageChange={setPage} />
        </div>
      </section>

      <section className="rounded-3xl border border-slate-700 bg-slate-800 p-6 shadow-xl">
        <div className="mb-4 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">Print personal reports</h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={toggleSelectAllStudents}
              className="rounded-full border border-slate-600 px-4 py-2 text-xs text-slate-200 hover:bg-slate-700"
            >
              {allStudentsSelected ? 'Clear selection' : 'Select all'}
            </button>
            <button
              type="button"
              onClick={() => handleStudentCardsPdf()}
              className="inline-flex items-center gap-2 rounded-full bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
            >
              <Printer className="h-3.5 w-3.5" />
              Print selected ({selectedStudentKeys.length})
            </button>
          </div>
        </div>

        <div className="overflow-x-auto rounded-3xl border border-slate-700 bg-slate-900">
          <table className="min-w-full text-left text-sm text-slate-200">
            <thead>
              <tr className="border-b border-slate-700 text-slate-300">
                <th className="px-6 py-4">
                  <input
                    type="checkbox"
                    checked={allStudentsSelected}
                    onChange={toggleSelectAllStudents}
                    aria-label="Select all students"
                    className="h-4 w-4 rounded border-slate-500 bg-slate-800"
                  />
                </th>
                <th className="px-6 py-4">Student</th>
                <th className="px-6 py-4">Class</th>
                <th className="px-6 py-4">Term</th>
                <th className="px-6 py-4">Total marks</th>
                <th className="px-6 py-4">Position</th>
                <th className="px-6 py-4">Print</th>
              </tr>
            </thead>
            <tbody>
              {studentsForPrint.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-10 text-center text-slate-400">
                    No students yet.
                  </td>
                </tr>
              ) : (
                studentsForPrint.map((student, index) => (
                  <tr key={student.key} className={index % 2 === 0 ? 'bg-slate-800' : 'bg-slate-900'}>
                    <td className="px-6 py-4">
                      <input
                        type="checkbox"
                        checked={selectedStudentKeys.includes(student.key)}
                        onChange={() => toggleStudent(student.key)}
                        aria-label={`Select ${student.student_name}`}
                        className="h-4 w-4 rounded border-slate-500 bg-slate-800"
                      />
                    </td>
                    <td className="px-6 py-4 text-white">
                      <div>{student.student_name}</div>
                      {student.roll_number ? (
                        <div className="text-xs text-slate-500">{student.roll_number}</div>
                      ) : null}
                    </td>
                    <td className="px-6 py-4">{student.class_name || '-'}</td>
                    <td className="px-6 py-4">
                      {selectedTerm === 'all' ? student.term || '-' : selectedTerm}
                    </td>
                    <td className="px-6 py-4">
                      {student.totalMarks ?? 0}
                      {student.totalMax ? `/${student.totalMax}` : ''}
                      {student.overallPercent != null ? ` · ${student.overallPercent}%` : ''}
                    </td>
                    <td className="px-6 py-4 font-semibold text-white">{ordinal(student.position)}</td>
                    <td className="px-6 py-4">
                      <button
                        type="button"
                        onClick={() => handleStudentCardsPdf([student.key])}
                        className="inline-flex items-center gap-1.5 rounded-full border border-slate-600 px-3 py-1.5 text-xs text-slate-100 hover:bg-slate-700"
                      >
                        <Printer className="h-3.5 w-3.5" />
                        Print report
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};

export default ReportCards;
