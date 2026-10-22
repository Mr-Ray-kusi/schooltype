import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';
import {
  BookOpen,
  CalendarCheck,
  Download,
  GraduationCap,
  Printer,
  RefreshCw,
  Users,
} from 'lucide-react';
import AccountantFees from './AccountantFees';
import PaginationBar from './PaginationBar';
import { LIST_PAGE_SIZE } from '../utils/listApi.js';
import { schoolLocalDate } from '../utils/schoolDate';
import { downloadStudentReportCardsPdf, downloadSubjectRankingsPdf } from '../utils/reportCardPdf';

const TABS = [
  { id: 'people', label: 'People' },
  { id: 'attendance', label: 'Attendance' },
  { id: 'reports', label: 'Report cards' },
  { id: 'fees', label: 'Fees' },
];

const AdministratorSchool = ({ schoolName, authHeaders }) => {
  const [tab, setTab] = useState('people');
  const [overview, setOverview] = useState(null);
  const [students, setStudents] = useState([]);
  const [studentTotal, setStudentTotal] = useState(0);
  const [studentPage, setStudentPage] = useState(1);
  const [studentQuery, setStudentQuery] = useState('');
  const [staff, setStaff] = useState([]);
  const [classes, setClasses] = useState([]);
  const [date, setDate] = useState(schoolLocalDate());
  const [attendance, setAttendance] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyFor, setHistoryFor] = useState(null);
  const [reportClass, setReportClass] = useState('all');
  const [reportTerm, setReportTerm] = useState('all');
  const [scores, setScores] = useState([]);
  const [reportFilters, setReportFilters] = useState({ classes: [], terms: [] });
  const [loading, setLoading] = useState(true);

  const loadPeople = useCallback(async () => {
    const [overviewRes, studentsRes, staffRes, classesRes] = await Promise.all([
      axios.get('/api/staff-portal/session/admin/overview', { headers: authHeaders }),
      axios.get('/api/staff-portal/session/admin/students', {
        headers: authHeaders,
        params: { page: studentPage, limit: LIST_PAGE_SIZE, q: studentQuery || undefined },
      }),
      axios.get('/api/staff-portal/session/admin/staff', { headers: authHeaders }),
      axios.get('/api/staff-portal/session/admin/classes', { headers: authHeaders }),
    ]);
    setOverview(overviewRes.data);
    setStudents(studentsRes.data.items || []);
    setStudentTotal(studentsRes.data.total || 0);
    setStaff(staffRes.data.items || []);
    setClasses(classesRes.data.items || []);
  }, [authHeaders, studentPage, studentQuery]);

  const loadAttendance = useCallback(async () => {
    const { data } = await axios.get('/api/staff-portal/session/admin/attendance', {
      headers: authHeaders,
      params: { date },
    });
    setAttendance(data);
  }, [authHeaders, date]);

  const loadReports = useCallback(async () => {
    const { data } = await axios.get('/api/staff-portal/session/admin/report-cards', {
      headers: authHeaders,
      params: {
        class: reportClass !== 'all' ? reportClass : undefined,
        term: reportTerm !== 'all' ? reportTerm : undefined,
      },
    });
    setScores(data.scores || []);
    if (data.filters) setReportFilters(data.filters);
  }, [authHeaders, reportClass, reportTerm]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      if (tab === 'people') await loadPeople();
      if (tab === 'attendance') {
        await loadAttendance();
        await axios
          .get('/api/staff-portal/session/admin/overview', { headers: authHeaders })
          .then(({ data }) => setOverview(data))
          .catch(() => {});
      }
      if (tab === 'reports') await loadReports();
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to load school view');
    } finally {
      setLoading(false);
    }
  }, [tab, loadPeople, loadAttendance, loadReports, authHeaders]);

  useEffect(() => {
    if (tab === 'fees') {
      setLoading(false);
      return;
    }
    refresh();
  }, [tab, refresh]);

  const openHistory = async (row) => {
    try {
      const { data } = await axios.get(
        `/api/staff-portal/session/admin/attendance/${encodeURIComponent(row.user_id)}`,
        { headers: authHeaders, params: { userType: row.user_type } }
      );
      setHistory(data.items || []);
      setHistoryFor(row);
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to load past attendance');
    }
  };

  const studentKeys = useMemo(
    () => [...new Set(scores.map((row) => row.student_id || `${row.student_name}-${row.class_name}`))],
    [scores]
  );

  const printReports = (kind) => {
    if (!scores.length) {
      toast.error('Teachers have not saved scores for this filter yet');
      return;
    }
    if (kind === 'rankings') {
      downloadSubjectRankingsPdf({
        scores,
        schoolName,
        className: reportClass,
        term: reportTerm,
      });
      toast.success('Subject rankings downloaded');
      return;
    }
    downloadStudentReportCardsPdf({
      scores,
      schoolName,
      className: reportClass,
      term: reportTerm,
      studentIds: studentKeys,
    });
    toast.success('Class report cards downloaded');
  };

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-300">Head of school</p>
        <h2 className="mt-1 text-2xl font-bold text-white">Whole-school view</h2>
        <p className="mt-1 text-sm text-slate-400">
          See people, attendance, report cards, and fee balances. Teachers enter scores. The accountant records
          payments. The school account keeps the plan, wallet, and messaging.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        {[
          { label: 'Students', value: overview?.students ?? '—', icon: Users },
          { label: 'Staff', value: overview?.staff ?? '—', icon: GraduationCap },
          { label: 'Classes', value: overview?.classes ?? '—', icon: BookOpen },
          {
            label: 'Marked today',
            value: overview?.attendance?.marked ?? '—',
            icon: CalendarCheck,
          },
        ].map((card) => {
          const Icon = card.icon;
          return (
            <div key={card.label} className="rounded-2xl border border-slate-700 bg-slate-900/60 p-4">
              <p className="flex items-center gap-2 text-xs uppercase tracking-wide text-slate-500">
                <Icon className="h-3.5 w-3.5" /> {card.label}
              </p>
              <p className="mt-2 text-2xl font-bold text-white">{card.value}</p>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-2">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={`rounded-full px-4 py-2 text-sm font-medium ${
              tab === item.id ? 'bg-sky-500 text-white' : 'border border-slate-600 text-slate-200 hover:bg-slate-800'
            }`}
          >
            {item.label}
          </button>
        ))}
        {tab !== 'fees' ? (
          <button
            type="button"
            onClick={refresh}
            className="ml-auto inline-flex items-center gap-2 rounded-full border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        ) : null}
      </div>

      {tab === 'people' ? (
        <div className="space-y-6">
          <section className="rounded-3xl border border-slate-700 bg-slate-900/50 p-5">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h3 className="font-semibold">Students</h3>
              <input
                value={studentQuery}
                onChange={(e) => {
                  setStudentPage(1);
                  setStudentQuery(e.target.value);
                }}
                placeholder="Search name or student ID"
                className="w-full rounded-xl border border-slate-600 bg-slate-950 px-3 py-2 text-sm sm:max-w-xs"
              />
            </div>
            <div className="divide-y divide-slate-800">
              {students.length === 0 ? (
                <p className="py-6 text-center text-sm text-slate-400">No students on this page.</p>
              ) : (
                students.map((row) => (
                  <div key={row.id} className="flex items-center justify-between gap-3 py-3">
                    <div>
                      <p className="font-medium text-white">{row.name}</p>
                      <p className="text-xs text-slate-500">
                        {row.class || 'No class'}
                        {row.roll_number ? ` · ${row.roll_number}` : ''}
                      </p>
                    </div>
                    <p className="text-xs text-slate-400">{row.parent_phone || '—'}</p>
                  </div>
                ))
              )}
            </div>
            <div className="mt-3">
              <PaginationBar
                page={studentPage}
                total={studentTotal}
                limit={LIST_PAGE_SIZE}
                onPageChange={setStudentPage}
              />
            </div>
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-3xl border border-slate-700 bg-slate-900/50 p-5">
              <h3 className="font-semibold">Classes</h3>
              <div className="mt-3 space-y-2 text-sm text-slate-200">
                {classes.length ? classes.map((row) => <p key={row.id}>{row.name}</p>) : <p className="text-slate-400">No classes yet.</p>}
              </div>
            </div>
            <div className="rounded-3xl border border-slate-700 bg-slate-900/50 p-5">
              <h3 className="font-semibold">Staff</h3>
              <div className="mt-3 space-y-3">
                {staff.map((row) => (
                  <div key={row.id}>
                    <p className="font-medium text-white">{row.name}</p>
                    <p className="text-xs text-slate-500">
                      {row.role}
                      {row.subjects ? ` · ${row.subjects}` : ''}
                      {row.class_names ? ` · ${row.class_names}` : ''}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {tab === 'attendance' ? (
        <section className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm text-slate-300">
              Date
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="mt-1 block rounded-xl border border-slate-600 bg-slate-950 px-3 py-2 text-white"
              />
            </label>
            <p className="text-sm text-slate-400">
              {attendance?.summary?.early || 0} on time · {attendance?.summary?.late || 0} late ·{' '}
              {attendance?.summary?.marked || 0} marked
            </p>
          </div>
          <div className="overflow-hidden rounded-3xl border border-slate-700 bg-slate-900/50">
            {(attendance?.records || []).length === 0 ? (
              <p className="px-5 py-10 text-center text-sm text-slate-400">No attendance recorded for this date.</p>
            ) : (
              <div className="divide-y divide-slate-800">
                {(attendance?.records || []).map((row) => (
                  <button
                    key={`${row.user_id}-${row.timestamp}`}
                    type="button"
                    onClick={() => openHistory(row)}
                    className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left hover:bg-slate-800/60"
                  >
                    <div>
                      <p className="font-medium text-white">{row.name}</p>
                      <p className="text-xs text-slate-500">
                        {row.user_type}
                        {row.label ? ` · ${row.label}` : ''}
                      </p>
                    </div>
                    <p className={`text-sm ${row.status === 'late' ? 'text-amber-300' : 'text-emerald-300'}`}>
                      {row.status === 'late' ? 'Late' : 'Early'}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>
          {historyFor ? (
            <div className="rounded-3xl border border-slate-700 bg-slate-950 p-5">
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-semibold">Past attendance · {historyFor.name}</h3>
                <button type="button" onClick={() => setHistoryFor(null)} className="text-sm text-slate-400">
                  Close
                </button>
              </div>
              <div className="mt-3 divide-y divide-slate-800 text-sm">
                {history.length === 0 ? (
                  <p className="py-4 text-slate-400">No earlier records.</p>
                ) : (
                  history.map((row) => (
                    <div key={`${row.date}-${row.timestamp}`} className="flex justify-between py-2">
                      <span>{row.date}</span>
                      <span className={row.status === 'late' ? 'text-amber-300' : 'text-emerald-300'}>
                        {row.status === 'late' ? 'Late' : 'Early'}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {tab === 'reports' ? (
        <section className="space-y-4">
          <div className="flex flex-wrap gap-3">
            <select
              value={reportClass}
              onChange={(e) => setReportClass(e.target.value)}
              className="rounded-xl border border-slate-600 bg-slate-900 px-3 py-2 text-sm"
            >
              <option value="all">All classes</option>
              {reportFilters.classes.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <select
              value={reportTerm}
              onChange={(e) => setReportTerm(e.target.value)}
              className="rounded-xl border border-slate-600 bg-slate-900 px-3 py-2 text-sm"
            >
              <option value="all">All terms</option>
              {reportFilters.terms.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => printReports('cards')}
              className="inline-flex items-center gap-2 rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
            >
              <Printer className="h-4 w-4" />
              Print class reports
            </button>
            <button
              type="button"
              onClick={() => printReports('rankings')}
              className="inline-flex items-center gap-2 rounded-full bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500"
            >
              <Download className="h-4 w-4" />
              Rankings PDF
            </button>
          </div>
          <div className="overflow-hidden rounded-3xl border border-slate-700 bg-slate-900/50">
            {scores.length === 0 ? (
              <p className="px-5 py-10 text-center text-sm text-slate-400">
                No teacher scores yet for this filter. Reports appear after teachers save marks.
              </p>
            ) : (
              <div className="divide-y divide-slate-800">
                {scores.map((row) => (
                  <div key={row.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                    <div>
                      <p className="font-medium text-white">{row.student_name}</p>
                      <p className="text-xs text-slate-500">
                        {row.class_name} · {row.subject} · {row.term}
                      </p>
                    </div>
                    <p className="text-sm text-slate-200">
                      {row.score == null ? '—' : `${row.score}/${row.max_score}`}
                      {row.percent != null ? ` · ${row.percent}%` : ''}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      ) : null}

      {tab === 'fees' ? <AccountantFees schoolName={schoolName} authHeaders={authHeaders} readOnly /> : null}
    </div>
  );
};

export default AdministratorSchool;
