import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';
import { Download, MessageSquare, Printer, RefreshCw } from 'lucide-react';
import Students from '../pages/students';
import Staff from '../pages/staffs';
import Setup from '../pages/classes';
import Attendance from '../pages/attendance';
import Scanner from '../pages/scanner';
import Alumni from '../pages/alumni';
import { StaffEmbedProvider } from '../contexts/staffEmbed';
import AbsentParentSmsModal from './AbsentParentSmsModal';
import { schoolLocalDate } from '../utils/schoolDate';
import { downloadStudentReportCardsPdf, downloadSubjectRankingsPdf } from '../utils/reportCardPdf';

const NAV = [
  { id: 'students', label: 'Students' },
  { id: 'alumni', label: 'Alumni' },
  { id: 'staff', label: 'Staff' },
  { id: 'setup', label: 'Setup' },
  { id: 'attendance', label: 'Attendance' },
  { id: 'scanner', label: 'Scanner' },
  { id: 'reports', label: 'Report cards' },
];

const AdministratorSchool = ({ schoolName, authHeaders }) => {
  const [tab, setTab] = useState('students');
  const [reportClass, setReportClass] = useState('all');
  const [reportTerm, setReportTerm] = useState('all');
  const [scores, setScores] = useState([]);
  const [reportFilters, setReportFilters] = useState({ classes: [], terms: [] });
  const [reportLock, setReportLock] = useState(null);
  const [teachers, setTeachers] = useState([]);
  const [allowTeacherId, setAllowTeacherId] = useState('');
  const [loadingReports, setLoadingReports] = useState(false);
  const [showAbsentSms, setShowAbsentSms] = useState(false);

  useEffect(() => {
    const lock = tab === 'attendance';
    document.documentElement.classList.toggle('attendance-lock', lock);
    return () => document.documentElement.classList.remove('attendance-lock');
  }, [tab]);

  const loadReports = useCallback(async () => {
    setLoadingReports(true);
    try {
      const { data } = await axios.get('/api/staff-portal/session/admin/report-cards', {
        headers: authHeaders,
        params: {
          class: reportClass !== 'all' ? reportClass : undefined,
          term: reportTerm !== 'all' ? reportTerm : undefined,
        },
      });
      setScores(data.scores || []);
      if (data.filters) setReportFilters(data.filters);
      setReportLock(data.lock || null);
      setTeachers(data.teachers || []);
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to load report cards');
    } finally {
      setLoadingReports(false);
    }
  }, [authHeaders, reportClass, reportTerm]);

  useEffect(() => {
    if (tab === 'reports') loadReports();
  }, [tab, loadReports]);

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
      downloadSubjectRankingsPdf({ scores, schoolName, className: reportClass, term: reportTerm });
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

  const publishReports = async (unpublish = false) => {
    try {
      const { data } = await axios.post(
        '/api/staff-portal/session/admin/report-cards/publish',
        { term: reportTerm, class: reportClass, unpublish },
        { headers: authHeaders }
      );
      toast.success(unpublish ? 'Teachers can edit again' : `Published ${data.classNames?.length || 0} class report(s)`);
      await loadReports();
    } catch (error) {
      toast.error(error.response?.data?.error || 'Could not update publish state');
    }
  };

  const allowTeacherEdit = async () => {
    if (!allowTeacherId) {
      toast.error('Pick a teacher to allow');
      return;
    }
    try {
      await axios.post(
        '/api/staff-portal/session/admin/report-cards/allow-edit',
        { term: reportTerm, class: reportClass, staffId: allowTeacherId, allow: true },
        { headers: authHeaders }
      );
      toast.success('That teacher can edit the published report');
      await loadReports();
    } catch (error) {
      toast.error(error.response?.data?.error || 'Could not allow that teacher');
    }
  };

  return (
    <StaffEmbedProvider value={{ embedded: true, open: setTab }}>
      <div className="flex flex-col gap-6 lg:flex-row">
        <aside className="shrink-0 lg:w-52">
          <div className="sticky top-4 space-y-2 rounded-2xl border border-slate-700 bg-slate-900/70 p-3">
            <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-300">
              Academic
            </p>
            {NAV.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={`flex w-full items-center rounded-xl px-3 py-2 text-left text-sm font-medium ${
                  tab === item.id ? 'bg-sky-500 text-white' : 'text-slate-200 hover:bg-slate-800'
                }`}
              >
                {item.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                setTab('attendance');
                setShowAbsentSms(true);
              }}
              className="mt-2 flex w-full items-center gap-2 rounded-xl border border-slate-600 px-3 py-2 text-left text-sm font-medium text-slate-200 hover:bg-slate-800"
            >
              <MessageSquare className="h-4 w-4" />
              SMS absent parents
            </button>
          </div>
        </aside>

        <div className={`min-w-0 flex-1 ${tab === 'attendance' ? 'min-h-0' : ''}`}>
          {tab === 'students' ? <Students /> : null}
          {tab === 'alumni' ? <Alumni /> : null}
          {tab === 'staff' ? <Staff /> : null}
          {tab === 'setup' ? <Setup /> : null}
          {tab === 'attendance' ? (
            <div className="h-[min(70vh,40rem)] min-h-[28rem]">
              <Attendance />
            </div>
          ) : null}
          {tab === 'scanner' ? <Scanner /> : null}
          {tab === 'reports' ? (
            <section className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div className="rounded-2xl border border-slate-700 bg-slate-900/50 p-4 text-sm text-slate-300">
                  Teachers enter and save marks. You publish the class report. After publish, teachers cannot change
                  marks unless you allow one teacher. You cannot edit marks from here.
                </div>
                <button
                  type="button"
                  onClick={loadReports}
                  className="inline-flex shrink-0 items-center gap-2 rounded-full border border-slate-600 px-3 py-2 text-sm text-slate-200"
                >
                  <RefreshCw className={`h-4 w-4 ${loadingReports ? 'animate-spin' : ''}`} />
                  Refresh
                </button>
              </div>
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
                <button
                  type="button"
                  onClick={() => publishReports(false)}
                  className="inline-flex items-center gap-2 rounded-full bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-500"
                >
                  Publish report
                </button>
                {reportLock?.published ? (
                  <button
                    type="button"
                    onClick={() => publishReports(true)}
                    className="inline-flex items-center gap-2 rounded-full border border-slate-600 px-4 py-2 text-sm text-slate-200"
                  >
                    Unpublish
                  </button>
                ) : null}
              </div>
              {reportLock?.published ? (
                <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
                  <p className="text-sm text-amber-100">
                    This term/class is published
                    {reportLock.allowStaffIds?.length ? ` · ${reportLock.allowStaffIds.length} teacher(s) can edit` : ''}.
                  </p>
                  <select
                    value={allowTeacherId}
                    onChange={(e) => setAllowTeacherId(e.target.value)}
                    className="rounded-xl border border-slate-600 bg-slate-900 px-3 py-2 text-sm"
                  >
                    <option value="">Allow a teacher to edit</option>
                    {teachers.map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={allowTeacherEdit}
                    className="rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-900"
                  >
                    Allow edit
                  </button>
                </div>
              ) : null}
              <div className="overflow-hidden rounded-3xl border border-slate-700 bg-slate-900/50">
                {scores.length === 0 ? (
                  <p className="px-5 py-10 text-center text-sm text-slate-400">
                    No teacher scores yet for this filter. Publish after teachers save marks.
                  </p>
                ) : (
                  <div className="divide-y divide-slate-800">
                    {scores.map((row) => (
                      <div key={row.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                        <div>
                          <p className="font-medium text-white">{row.student_name}</p>
                          <p className="text-xs text-slate-500">
                            {row.class_name} · {row.subject} · {row.term}
                            {row.teacher_name ? ` · ${row.teacher_name}` : ''}
                            {row.published ? ' · published' : ''}
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
        </div>
      </div>
      <AbsentParentSmsModal
        open={showAbsentSms}
        onClose={() => setShowAbsentSms(false)}
        date={schoolLocalDate()}
        requestConfig={{ headers: authHeaders }}
      />
    </StaffEmbedProvider>
  );
};

export default AdministratorSchool;
