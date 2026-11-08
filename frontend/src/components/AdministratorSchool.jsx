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
import ClassReportBoard from './ClassReportBoard';
import { downloadStudentReportCardsPdf, downloadSubjectRankingsPdf, rankClassRoster } from '../utils/reportCardPdf';
import { useAuth } from '../contexts/authcontext';
import { SUBSCRIPTION_READ_ONLY_MESSAGE } from '../utils/subscriptionAccess';

const ACADEMIC_NAV = [
  { id: 'students', label: 'Students' },
  { id: 'alumni', label: 'Alumni' },
  { id: 'staff', label: 'Staff' },
  { id: 'setup', label: 'Setup' },
  { id: 'attendance', label: 'Attendance' },
  { id: 'scanner', label: 'Scanner' },
  { id: 'reports', label: 'Report cards' },
];

const AdministratorSchool = ({ schoolName, authHeaders, aboutPanel = null }) => {
  const { canWrite, canDownload } = useAuth();
  const [tab, setTab] = useState('students');
  const [reportClass, setReportClass] = useState('');
  const [reportTerm, setReportTerm] = useState('all');
  const [scores, setScores] = useState([]);
  const [roster, setRoster] = useState([]);
  const [classCounts, setClassCounts] = useState({});
  const [reportFilters, setReportFilters] = useState({ classes: [], terms: [] });
  const [reportLock, setReportLock] = useState(null);
  const [teachers, setTeachers] = useState([]);
  const [allowTeacherId, setAllowTeacherId] = useState('');
  const [loadingReports, setLoadingReports] = useState(false);
  const [showAbsentSms, setShowAbsentSms] = useState(false);
  const [publishBlock, setPublishBlock] = useState(null);
  const [checkingPublish, setCheckingPublish] = useState(false);

  useEffect(() => {
    if (tab === 'payments') setTab('students');
  }, [tab]);

  const loadReports = useCallback(async () => {
    setLoadingReports(true);
    try {
      const { data } = await axios.get('/api/staff-portal/session/admin/report-cards', {
        headers: authHeaders,
        params: {
          class: reportClass || undefined,
          term: reportTerm !== 'all' ? reportTerm : undefined,
        },
      });
      setScores(data.scores || []);
      setRoster(data.roster || []);
      setClassCounts(data.classCounts || {});
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

  const ranked = useMemo(
    () =>
      reportClass
        ? rankClassRoster(roster, scores, { className: reportClass, term: reportTerm })
        : [],
    [roster, scores, reportClass, reportTerm]
  );

  const studentKeys = useMemo(
    () => ranked.map((row) => row.student_id || `${row.student_name}-${row.class_name}`),
    [ranked]
  );

  const printReports = (kind) => {
    if (!canDownload) {
      toast.error('Downloads are locked until the term plan is renewed.');
      return;
    }
    if (!reportClass) {
      toast.error('Choose a class first');
      return;
    }
    if (!scores.length) {
      toast.error('Teachers have not saved scores for this class yet');
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
    if (!canWrite) {
      toast.error(SUBSCRIPTION_READ_ONLY_MESSAGE);
      return;
    }
    try {
      const { data } = await axios.post(
        '/api/staff-portal/session/admin/report-cards/publish',
        { term: reportTerm, class: reportClass || 'all', unpublish },
        { headers: authHeaders }
      );
      setPublishBlock(null);
      toast.success(unpublish ? 'Teachers can edit again' : `Published ${data.classNames?.length || 0} class report(s)`);
      await loadReports();
    } catch (error) {
      const payload = error.response?.data;
      if (!unpublish && Array.isArray(payload?.pendingTeachers)) {
        setPublishBlock(payload);
        return;
      }
      toast.error(payload?.error || 'Could not update publish state');
    }
  };

  const requestPublish = async () => {
    if (reportTerm === 'all') {
      toast.error('Pick a term before publishing');
      return;
    }
    setCheckingPublish(true);
    try {
      const { data } = await axios.get('/api/staff-portal/session/admin/report-cards/readiness', {
        headers: authHeaders,
        params: {
          term: reportTerm,
          class: reportClass || undefined,
        },
      });
      if (!data.ready) {
        setPublishBlock(data);
        return;
      }
      await publishReports(false);
    } catch (error) {
      const payload = error.response?.data;
      if (Array.isArray(payload?.pendingTeachers)) {
        setPublishBlock(payload);
        return;
      }
      toast.error(payload?.error || 'Could not check whether scores are complete');
    } finally {
      setCheckingPublish(false);
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
        { term: reportTerm, class: reportClass || 'all', staffId: allowTeacherId, allow: true },
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
      <div className="flex h-full min-h-0 flex-1 flex-col lg:flex-row lg:gap-3">
        <aside className="min-w-0 shrink-0 lg:w-32">
          <div className="flex gap-2 overflow-x-auto pb-1 lg:block lg:max-h-full lg:space-y-1 lg:overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900/70 p-2">
            {aboutPanel ? (
              <>
                <p className="hidden px-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-sky-300 lg:block">
                  You
                </p>
                <button
                  type="button"
                  onClick={() => setTab('about')}
                  className={`flex shrink-0 items-center rounded-lg px-2 py-1.5 text-left text-[13px] font-medium leading-snug lg:w-full ${
                    tab === 'about' ? 'bg-sky-500 text-white' : 'text-slate-200 hover:bg-slate-800'
                  }`}
                >
                  About Me
                </button>
              </>
            ) : null}
            <p className="hidden px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-sky-300 lg:block">
              Academic
            </p>
            {ACADEMIC_NAV.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={`flex shrink-0 items-center rounded-lg px-2 py-1.5 text-left text-[13px] font-medium leading-snug lg:w-full ${
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
              className="flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-600 px-2 py-1.5 text-left text-[13px] font-medium leading-snug text-slate-200 hover:bg-slate-800 lg:mt-1 lg:w-full"
            >
              <MessageSquare className="h-3.5 w-3.5 shrink-0" />
              SMS absents
            </button>
          </div>
        </aside>

        <div
          className={`min-h-0 min-w-0 flex-1 pr-4 sm:pr-5 lg:pr-6 ${
            tab === 'attendance' ? 'flex flex-col overflow-hidden' : 'space-y-4 overflow-y-auto'
          }`}
        >
          {tab === 'about' ? aboutPanel : null}
          {tab === 'students' ? <Students /> : null}
          {tab === 'alumni' ? <Alumni /> : null}
          {tab === 'staff' ? <Staff /> : null}
          {tab === 'setup' ? <Setup /> : null}
          {tab === 'attendance' ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <Attendance />
            </div>
          ) : null}
          {tab === 'scanner' ? <Scanner /> : null}
          {tab === 'reports' ? (
            <section className="space-y-5">
              {reportClass ? null : (
                <div className="flex items-start justify-between gap-3">
                  <p className="max-w-xl text-sm text-slate-300">
                    Teachers save marks. You publish the class report. After publish, teachers cannot change marks unless you allow one.
                  </p>
                  <button
                    type="button"
                    onClick={loadReports}
                    className="inline-flex shrink-0 items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm text-slate-200 hover:bg-slate-800 hover:text-white"
                  >
                    <RefreshCw className={`h-4 w-4 ${loadingReports ? 'animate-spin' : ''}`} />
                    Refresh
                  </button>
                </div>
              )}
              <ClassReportBoard
                classes={reportFilters.classes}
                classCounts={classCounts}
                selectedClass={reportClass}
                onSelectClass={setReportClass}
                selectedTerm={reportTerm}
                onSelectTerm={setReportTerm}
                terms={
                  reportFilters.terms.length
                    ? reportFilters.terms
                    : ['First Term', 'Second Term', 'Third Term']
                }
                ranked={ranked}
                loading={loadingReports}
                toolbar={
                  <>
                    {reportClass ? (
                      <>
                        <button
                          type="button"
                          onClick={loadReports}
                          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm text-slate-200 hover:bg-slate-800 hover:text-white"
                        >
                          <RefreshCw className={`h-4 w-4 ${loadingReports ? 'animate-spin' : ''}`} />
                        </button>
                        <button
                          type="button"
                          onClick={() => printReports('rankings')}
                          disabled={!canDownload}
                          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-slate-300 hover:bg-slate-800 hover:text-white disabled:opacity-50"
                        >
                          <Download className="h-4 w-4" />
                          Rankings
                        </button>
                        <button
                          type="button"
                          onClick={() => printReports('cards')}
                          disabled={!canDownload}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
                        >
                          <Printer className="h-4 w-4" />
                          Print
                        </button>
                      </>
                    ) : null}
                    {reportLock?.published ? (
                      <button
                        type="button"
                        onClick={() => publishReports(true)}
                        className="inline-flex items-center rounded-lg px-3 py-2 text-sm text-slate-200 hover:bg-slate-800 hover:text-white"
                      >
                        Unpublish
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={requestPublish}
                        disabled={checkingPublish}
                        className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-amber-200 hover:bg-amber-500/10 disabled:opacity-60"
                      >
                        {checkingPublish ? 'Checking…' : 'Publish'}
                      </button>
                    )}
                  </>
                }
              />
              {reportClass && reportLock?.published ? (
                <div className="flex flex-wrap items-center gap-2 text-sm text-slate-200">
                  <span>Allow a teacher to edit</span>
                  <select
                    value={allowTeacherId}
                    onChange={(e) => setAllowTeacherId(e.target.value)}
                    className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-200"
                  >
                    <option value="">Choose teacher</option>
                    {teachers.map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={allowTeacherEdit}
                    className="rounded-lg px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800"
                  >
                    Allow
                  </button>
                </div>
              ) : null}
            </section>
          ) : null}
        </div>
      </div>
      {publishBlock ? (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/70 p-4 sm:items-center">
          <div className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-3xl border border-slate-700 bg-slate-950 p-5 shadow-2xl">
            <h3 className="text-lg font-semibold text-white">Cannot publish yet</h3>
            <p className="mt-1 text-sm text-slate-300">
              {publishBlock.reason || 'Teachers still need to enter and save every student score.'}
            </p>
            {publishBlock.pendingTeachers?.length ? (
              <ul className="mt-4 space-y-3">
                {publishBlock.pendingTeachers.map((teacher) => (
                  <li key={teacher.id || teacher.name} className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3">
                    <p className="font-medium text-amber-50">{teacher.name}</p>
                    <ul className="mt-1 space-y-1 text-xs text-amber-100/85">
                      {(teacher.gaps || []).map((gap) => (
                        <li key={`${teacher.id}-${gap.class_name}-${gap.subject}`}>
                          {gap.class_name} · {gap.subject} — {gap.missing} of {gap.total} students missing
                          {gap.missing_names?.length
                            ? ` (${gap.missing_names.join(', ')}${gap.missing > gap.missing_names.length ? '…' : ''})`
                            : ''}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            ) : null}
            {publishBlock.uncoveredClasses?.length ? (
              <p className="mt-3 text-sm text-slate-300">
                No teacher assigned: {publishBlock.uncoveredClasses.join(', ')}
              </p>
            ) : null}
            <button
              type="button"
              onClick={() => setPublishBlock(null)}
              className="mt-5 w-full rounded-full bg-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-900"
            >
              Close
            </button>
          </div>
        </div>
      ) : null}
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
