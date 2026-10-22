import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import {
  AlertTriangle,
  BookOpen,
  CalendarCheck,
  Clock,
  Copy,
  Download,
  GraduationCap,
  Printer,
  RefreshCw,
  Search,
  UserPlus,
  Users,
} from 'lucide-react';
import PaginationBar from './PaginationBar';
import { LIST_PAGE_SIZE } from '../utils/listApi.js';
import { schoolLocalDate } from '../utils/schoolDate';
import { downloadStudentReportCardsPdf, downloadSubjectRankingsPdf } from '../utils/reportCardPdf';

const NAV = [
  { id: 'people', label: 'People' },
  { id: 'attendance', label: 'Attendance' },
  { id: 'reports', label: 'Report cards' },
];

const ATTENDANCE_PAGE_SIZE = 5;
const TERM_DAY_PAGE_SIZE = 4;
const STAFF_ROLES = ['Administrator', 'Teacher', 'Accountant'];

const fieldClass =
  'h-9 min-h-9 w-full rounded-lg border border-slate-600 bg-slate-900 px-2.5 text-sm text-white outline-none focus:ring-2 focus:ring-primary-500';

const typeBadge = (type) => {
  switch (type) {
    case 'student':
      return 'bg-sky-500/15 text-sky-200';
    case 'staff':
      return 'bg-emerald-500/15 text-emerald-200';
    case 'non-staff':
      return 'bg-slate-600/40 text-slate-200';
    default:
      return 'bg-slate-600/40 text-slate-200';
  }
};

const getPersonName = (record) => record.user?.name || record.user_name || record.name || 'Unknown';
const getPersonLabel = (record) => {
  if (record.user_type === 'student') return record.user?.class || record.user_label || record.label || 'N/A';
  return record.user?.role || record.user_label || record.label || 'N/A';
};
const getPunctuality = (record) =>
  record.punctuality || (record.status === 'early' || record.status === 'late' ? record.status : null) || 'early';
const personKey = (record) => `${record.user_type || 'student'}:${record.user_id || record.id}`;

const recordMatchesSearch = (record, query) => {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  const name = getPersonName(record).toLowerCase();
  if (name.includes(q)) return true;
  return [record.user_id, record.user?.id, record.user?.roll_number, record.roll_number].some((value) =>
    String(value || '').trim().toLowerCase().includes(q)
  );
};

const generateAccessCode = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  return Array.from({ length: 16 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
};

const TermRecords = ({ data, loading, personName, personLabel, onClose }) => {
  const [dayPage, setDayPage] = useState(1);
  const records = data?.records || data?.items || [];
  const dayPages = Math.max(1, Math.ceil(records.length / TERM_DAY_PAGE_SIZE));
  const safeDayPage = Math.min(dayPage, dayPages);
  const pagedDays = records.slice((safeDayPage - 1) * TERM_DAY_PAGE_SIZE, safeDayPage * TERM_DAY_PAGE_SIZE);

  if (loading && !data) {
    return <p className="px-3 py-2 text-xs text-slate-400">Loading this term…</p>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-900 px-3 py-3">
      <div className="flex shrink-0 items-center justify-between gap-2">
        <p className="truncate text-xs text-slate-400">
          {personName}
          {personLabel ? ` · ${personLabel}` : ''}
          {data?.term?.name ? ` · ${data.term.name}` : ''}
          {data?.summary
            ? ` · ${data.summary.days} days · ${data.summary.early} early · ${data.summary.late} late`
            : ''}
        </p>
        <button type="button" onClick={onClose} className="text-xs text-slate-300 hover:text-white">
          Close
        </button>
      </div>
      <div className="mt-2 min-h-0 flex-1 divide-y divide-slate-800 overflow-hidden">
        {pagedDays.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400">No earlier records.</p>
        ) : (
          pagedDays.map((row) => (
            <div key={`${row.date}-${row.timestamp}`} className="flex justify-between py-2 text-sm">
              <span>{row.date}</span>
              <span className={row.status === 'late' ? 'text-amber-300' : 'text-emerald-300'}>
                {row.status === 'late' ? 'Late' : 'Early'}
              </span>
            </div>
          ))
        )}
      </div>
      {records.length > TERM_DAY_PAGE_SIZE ? (
        <div className="mt-2 shrink-0">
          <PaginationBar page={safeDayPage} total={records.length} limit={TERM_DAY_PAGE_SIZE} onPageChange={setDayPage} />
        </div>
      ) : null}
    </div>
  );
};

const AdministratorSchool = ({ schoolName, authHeaders }) => {
  const [tab, setTab] = useState('people');
  const [overview, setOverview] = useState(null);
  const [students, setStudents] = useState([]);
  const [studentTotal, setStudentTotal] = useState(0);
  const [studentPage, setStudentPage] = useState(1);
  const [studentQuery, setStudentQuery] = useState('');
  const [classes, setClasses] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [date, setDate] = useState(schoolLocalDate());
  const [attendance, setAttendance] = useState(null);
  const [selectedType, setSelectedType] = useState('all');
  const [selectedClass, setSelectedClass] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('time');
  const [attPage, setAttPage] = useState(1);
  const [openKey, setOpenKey] = useState(null);
  const [termCache, setTermCache] = useState({});
  const [termLoading, setTermLoading] = useState(false);
  const [reportClass, setReportClass] = useState('all');
  const [reportTerm, setReportTerm] = useState('all');
  const [scores, setScores] = useState([]);
  const [reportFilters, setReportFilters] = useState({ classes: [], terms: [] });
  const [reportLock, setReportLock] = useState(null);
  const [teachers, setTeachers] = useState([]);
  const [allowTeacherId, setAllowTeacherId] = useState('');
  const [loading, setLoading] = useState(true);
  const [addKind, setAddKind] = useState(null);
  const [savingPerson, setSavingPerson] = useState(false);
  const [createdCode, setCreatedCode] = useState('');
  const [studentForm, setStudentForm] = useState({
    name: '',
    class: '',
    parentName: '',
    parentRelationship: 'Parent',
    parentPhone: '',
    parentEmail: '',
    houseAddress: '',
    dateOfBirth: '',
  });
  const [staffForm, setStaffForm] = useState({
    name: '',
    role: 'Teacher',
    secretCode: generateAccessCode(),
    subjects: [],
    classNames: [],
  });
  const [nonStaffForm, setNonStaffForm] = useState({ name: '', role: '' });

  const loadPeople = useCallback(async () => {
    const [overviewRes, studentsRes, classesRes, subjectsRes] = await Promise.all([
      axios.get('/api/staff-portal/session/admin/overview', { headers: authHeaders }),
      axios.get('/api/staff-portal/session/admin/students', {
        headers: authHeaders,
        params: { page: studentPage, limit: LIST_PAGE_SIZE, q: studentQuery || undefined },
      }),
      axios.get('/api/staff-portal/session/admin/classes', { headers: authHeaders }),
      axios.get('/api/staff-portal/session/admin/subjects', { headers: authHeaders }),
    ]);
    setOverview(overviewRes.data);
    setStudents(studentsRes.data.items || []);
    setStudentTotal(studentsRes.data.total || 0);
    setClasses(classesRes.data.items || []);
    setSubjects(subjectsRes.data.items || []);
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
    setReportLock(data.lock || null);
    setTeachers(data.teachers || []);
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
    refresh();
  }, [refresh]);

  useEffect(() => {
    setSelectedClass('all');
  }, [selectedType]);

  useEffect(() => {
    setAttPage(1);
  }, [selectedType, selectedClass, searchQuery, date, sortBy]);

  const attendanceRecords = attendance?.records || [];
  const classOptions = useMemo(() => {
    if (selectedType === 'staff' || selectedType === 'non-staff') {
      return Array.from(
        new Set(
          attendanceRecords
            .filter((record) => record.user_type === selectedType)
            .map((record) => getPersonLabel(record))
            .filter((value) => value && value !== 'N/A')
        )
      ).sort((a, b) => a.localeCompare(b));
    }
    const fromSetup = (classes || []).map((row) => row.name).filter(Boolean);
    const fromMarked = attendanceRecords
      .filter((record) => record.user_type === 'student')
      .map((record) => getPersonLabel(record))
      .filter((value) => value && value !== 'N/A');
    return Array.from(new Set([...fromSetup, ...fromMarked])).sort((a, b) => a.localeCompare(b));
  }, [attendanceRecords, classes, selectedType]);

  const filteredRecords = useMemo(() => {
    const rows = attendanceRecords.filter((record) => {
      const type = record.user_type === 'nonstaff' || record.user_type === 'non_staff' ? 'non-staff' : record.user_type;
      if (selectedType !== 'all' && type !== selectedType) return false;
      if (selectedClass !== 'all') {
        if (getPersonLabel(record) !== selectedClass) return false;
      }
      return recordMatchesSearch(record, searchQuery);
    });
    const sorted = [...rows];
    if (sortBy === 'name') sorted.sort((a, b) => getPersonName(a).localeCompare(getPersonName(b)));
    if (sortBy === 'late') {
      sorted.sort((a, b) => Number(getPunctuality(b) === 'late') - Number(getPunctuality(a) === 'late'));
    }
    if (sortBy === 'type') sorted.sort((a, b) => String(a.user_type).localeCompare(String(b.user_type)));
    if (sortBy === 'time') {
      sorted.sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
    }
    return sorted;
  }, [attendanceRecords, selectedType, selectedClass, searchQuery, sortBy]);

  const lateCount = useMemo(
    () => filteredRecords.filter((record) => getPunctuality(record) === 'late').length,
    [filteredRecords]
  );
  const pageCount = Math.max(1, Math.ceil(filteredRecords.length / ATTENDANCE_PAGE_SIZE));
  const safeAttPage = Math.min(attPage, pageCount);
  const pagedRecords = filteredRecords.slice(
    (safeAttPage - 1) * ATTENDANCE_PAGE_SIZE,
    safeAttPage * ATTENDANCE_PAGE_SIZE
  );
  const openRecord = openKey
    ? pagedRecords.find((record) => personKey(record) === openKey) ||
      filteredRecords.find((record) => personKey(record) === openKey)
    : null;

  const togglePerson = async (record) => {
    if (!record?.user_id) return;
    const key = personKey(record);
    if (openKey === key) {
      setOpenKey(null);
      return;
    }
    setOpenKey(key);
    if (termCache[key]) return;
    setTermLoading(true);
    try {
      const { data } = await axios.get(
        `/api/staff-portal/session/admin/attendance/${encodeURIComponent(record.user_id)}`,
        { headers: authHeaders, params: { userType: record.user_type || 'student' } }
      );
      setTermCache((prev) => ({ ...prev, [key]: data }));
    } catch (error) {
      toast.error(error.response?.data?.error || 'Could not load this term attendance');
    } finally {
      setTermLoading(false);
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

  const submitPerson = async (event) => {
    event.preventDefault();
    setSavingPerson(true);
    setCreatedCode('');
    try {
      if (addKind === 'student') {
        const { data } = await axios.post('/api/staff-portal/session/admin/students', studentForm, {
          headers: authHeaders,
        });
        toast.success(data?.roll_number ? `Student added. ID ${data.roll_number}` : 'Student added');
      } else if (addKind === 'staff') {
        const { data } = await axios.post(
          '/api/staff-portal/session/admin/staff',
          {
            ...staffForm,
            subjects: staffForm.subjects,
            classNames: staffForm.classNames,
          },
          { headers: authHeaders }
        );
        const code = data.secretCode || data.secret_code || staffForm.secretCode;
        setCreatedCode(code);
        toast.success('Staff added');
      } else {
        await axios.post('/api/staff-portal/session/admin/non-staff', nonStaffForm, { headers: authHeaders });
        toast.success('Non-staff added');
      }
      if (addKind !== 'staff') setAddKind(null);
      setStudentForm({
        name: '',
        class: '',
        parentName: '',
        parentRelationship: 'Parent',
        parentPhone: '',
        parentEmail: '',
        houseAddress: '',
        dateOfBirth: '',
      });
      setStaffForm({
        name: '',
        role: 'Teacher',
        secretCode: generateAccessCode(),
        subjects: [],
        classNames: [],
      });
      setNonStaffForm({ name: '', role: '' });
      await loadPeople();
    } catch (error) {
      toast.error(error.response?.data?.error || 'Could not add this person');
    } finally {
      setSavingPerson(false);
    }
  };

  const toggleListValue = (list, value) =>
    list.includes(value) ? list.filter((item) => item !== value) : [...list, value];

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <aside className="shrink-0 lg:w-52">
        <div className="sticky top-4 space-y-2 rounded-2xl border border-slate-700 bg-slate-900/70 p-3">
          <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-300">
            Administrator
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
            onClick={refresh}
            className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </aside>

      <div className="min-w-0 flex-1 space-y-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-300">Head of school</p>
          <h2 className="mt-1 text-2xl font-bold text-white">Whole-school view</h2>
          <p className="mt-1 text-sm text-slate-400">
            Add people, review attendance, and publish report cards after teachers save marks. Fees stay with the
            accountant and the school account.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-4">
          {[
            { label: 'Students', value: overview?.students ?? '—', icon: Users },
            { label: 'Staff', value: overview?.staff ?? '—', icon: GraduationCap },
            { label: 'Classes', value: overview?.classes ?? '—', icon: BookOpen },
            { label: 'Marked today', value: overview?.attendance?.marked ?? '—', icon: CalendarCheck },
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

        {tab === 'people' ? (
          <div className="space-y-6">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setCreatedCode('');
                  setAddKind('student');
                }}
                className="inline-flex items-center gap-2 rounded-full bg-sky-500 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-400"
              >
                <UserPlus className="h-4 w-4" /> Add student
              </button>
              <button
                type="button"
                onClick={() => {
                  setCreatedCode('');
                  setStaffForm((prev) => ({ ...prev, secretCode: generateAccessCode() }));
                  setAddKind('staff');
                }}
                className="inline-flex items-center gap-2 rounded-full border border-slate-600 px-4 py-2 text-sm text-slate-100 hover:bg-slate-800"
              >
                <UserPlus className="h-4 w-4" /> Add staff
              </button>
              <button
                type="button"
                onClick={() => {
                  setCreatedCode('');
                  setAddKind('non-staff');
                }}
                className="inline-flex items-center gap-2 rounded-full border border-slate-600 px-4 py-2 text-sm text-slate-100 hover:bg-slate-800"
              >
                <UserPlus className="h-4 w-4" /> Add non-staff
              </button>
            </div>

            {addKind ? (
              <form
                onSubmit={submitPerson}
                className="space-y-3 rounded-3xl border border-slate-700 bg-slate-900/60 p-5"
              >
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold capitalize">Add {addKind}</h3>
                  <button type="button" onClick={() => setAddKind(null)} className="text-sm text-slate-400">
                    Close
                  </button>
                </div>
                {addKind === 'student' ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <input
                      required
                      value={studentForm.name}
                      onChange={(e) => setStudentForm({ ...studentForm, name: e.target.value })}
                      placeholder="Student name"
                      className="rounded-xl border border-slate-600 bg-slate-950 px-3 py-2 text-sm"
                    />
                    <select
                      required
                      value={studentForm.class}
                      onChange={(e) => setStudentForm({ ...studentForm, class: e.target.value })}
                      className="rounded-xl border border-slate-600 bg-slate-950 px-3 py-2 text-sm"
                    >
                      <option value="">Class</option>
                      {classes.map((row) => (
                        <option key={row.id} value={row.name}>
                          {row.name}
                        </option>
                      ))}
                    </select>
                    <input
                      required
                      value={studentForm.parentName}
                      onChange={(e) => setStudentForm({ ...studentForm, parentName: e.target.value })}
                      placeholder="Parent / guardian name"
                      className="rounded-xl border border-slate-600 bg-slate-950 px-3 py-2 text-sm"
                    />
                    <input
                      required
                      value={studentForm.parentPhone}
                      onChange={(e) => setStudentForm({ ...studentForm, parentPhone: e.target.value })}
                      placeholder="Parent phone"
                      className="rounded-xl border border-slate-600 bg-slate-950 px-3 py-2 text-sm"
                    />
                    <input
                      value={studentForm.parentEmail}
                      onChange={(e) => setStudentForm({ ...studentForm, parentEmail: e.target.value })}
                      placeholder="Parent email (optional)"
                      className="rounded-xl border border-slate-600 bg-slate-950 px-3 py-2 text-sm"
                    />
                    <input
                      value={studentForm.houseAddress}
                      onChange={(e) => setStudentForm({ ...studentForm, houseAddress: e.target.value })}
                      placeholder="House address"
                      className="rounded-xl border border-slate-600 bg-slate-950 px-3 py-2 text-sm"
                    />
                  </div>
                ) : null}
                {addKind === 'staff' ? (
                  <div className="space-y-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <input
                        required
                        value={staffForm.name}
                        onChange={(e) => setStaffForm({ ...staffForm, name: e.target.value })}
                        placeholder="Staff name"
                        className="rounded-xl border border-slate-600 bg-slate-950 px-3 py-2 text-sm"
                      />
                      <select
                        value={staffForm.role}
                        onChange={(e) => setStaffForm({ ...staffForm, role: e.target.value })}
                        className="rounded-xl border border-slate-600 bg-slate-950 px-3 py-2 text-sm"
                      >
                        {STAFF_ROLES.map((role) => (
                          <option key={role} value={role}>
                            {role}
                          </option>
                        ))}
                      </select>
                    </div>
                    <label className="block text-xs text-slate-400">
                      Access code
                      <div className="mt-1 flex gap-2">
                        <input
                          value={staffForm.secretCode}
                          onChange={(e) => setStaffForm({ ...staffForm, secretCode: e.target.value })}
                          className="flex-1 rounded-xl border border-slate-600 bg-slate-950 px-3 py-2 text-sm"
                        />
                        <button
                          type="button"
                          onClick={() => setStaffForm({ ...staffForm, secretCode: generateAccessCode() })}
                          className="rounded-xl border border-slate-600 px-3 text-sm"
                        >
                          New
                        </button>
                      </div>
                    </label>
                    {staffForm.role === 'Teacher' ? (
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                          <p className="mb-2 text-xs uppercase text-slate-500">Subjects</p>
                          <div className="max-h-32 space-y-1 overflow-auto text-sm">
                            {subjects.map((row) => (
                              <label key={row.id} className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={staffForm.subjects.includes(row.name)}
                                  onChange={() =>
                                    setStaffForm({
                                      ...staffForm,
                                      subjects: toggleListValue(staffForm.subjects, row.name),
                                    })
                                  }
                                />
                                {row.name}
                              </label>
                            ))}
                          </div>
                        </div>
                        <div>
                          <p className="mb-2 text-xs uppercase text-slate-500">Classes</p>
                          <div className="max-h-32 space-y-1 overflow-auto text-sm">
                            {classes.map((row) => (
                              <label key={row.id} className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={staffForm.classNames.includes(row.name)}
                                  onChange={() =>
                                    setStaffForm({
                                      ...staffForm,
                                      classNames: toggleListValue(staffForm.classNames, row.name),
                                    })
                                  }
                                />
                                {row.name}
                              </label>
                            ))}
                          </div>
                        </div>
                      </div>
                    ) : null}
                    {createdCode ? (
                      <p className="flex items-center gap-2 text-sm text-emerald-200">
                        Access code: <span className="font-mono">{createdCode}</span>
                        <button
                          type="button"
                          onClick={async () => {
                            await navigator.clipboard.writeText(createdCode);
                            toast.success('Access code copied');
                          }}
                        >
                          <Copy className="h-4 w-4" />
                        </button>
                      </p>
                    ) : null}
                  </div>
                ) : null}
                {addKind === 'non-staff' ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <input
                      required
                      value={nonStaffForm.name}
                      onChange={(e) => setNonStaffForm({ ...nonStaffForm, name: e.target.value })}
                      placeholder="Name"
                      className="rounded-xl border border-slate-600 bg-slate-950 px-3 py-2 text-sm"
                    />
                    <input
                      value={nonStaffForm.role}
                      onChange={(e) => setNonStaffForm({ ...nonStaffForm, role: e.target.value })}
                      placeholder="Role (cleaner, security…)"
                      className="rounded-xl border border-slate-600 bg-slate-950 px-3 py-2 text-sm"
                    />
                  </div>
                ) : null}
                <button
                  type="submit"
                  disabled={savingPerson}
                  className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {savingPerson ? 'Saving…' : 'Save'}
                </button>
              </form>
            ) : null}

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
          </div>
        ) : null}

        {tab === 'attendance' ? (
          <div className="attendance-page flex min-h-[28rem] flex-col gap-2">
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <h3 className="text-lg font-bold text-white">Attendance</h3>
                <p className="truncate text-xs text-slate-400">
                  {format(new Date(`${date}T12:00:00`), 'EEE d MMM yyyy')}
                  {' · '}
                  {filteredRecords.length} marked
                  {lateCount > 0 ? ` · ${lateCount} late` : ''}
                  {attendance?.summary
                    ? ` · Students ${attendance.summary.students || 0} · Staff ${attendance.summary.staff || 0} · Non-staff ${attendance.summary.nonStaff || 0}`
                    : ''}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className={`${fieldClass} w-[10.5rem]`}
                />
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-slate-700 px-3 text-sm font-medium text-white hover:bg-slate-600"
                >
                  <Printer className="h-3.5 w-3.5" />
                  Print
                </button>
              </div>
            </div>

            <div className="flex shrink-0 flex-nowrap items-end gap-2 overflow-x-auto rounded-xl border border-slate-700 bg-slate-800 p-2">
              <label className="min-w-[7rem] flex-1 text-[11px] font-medium uppercase tracking-wide text-slate-400">
                Type
                <select
                  value={selectedType}
                  onChange={(e) => setSelectedType(e.target.value)}
                  className={`${fieldClass} mt-1`}
                >
                  <option value="all">All</option>
                  <option value="student">Students</option>
                  <option value="staff">Staff</option>
                  <option value="non-staff">Non-staff</option>
                </select>
              </label>
              <label className="min-w-[7rem] flex-1 text-[11px] font-medium uppercase tracking-wide text-slate-400">
                {selectedType === 'staff' || selectedType === 'non-staff' ? 'Role' : 'Class / Roll'}
                <select
                  value={selectedClass}
                  onChange={(e) => setSelectedClass(e.target.value)}
                  className={`${fieldClass} mt-1`}
                >
                  <option value="all">All</option>
                  {classOptions.map((label) => (
                    <option key={label} value={label}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="min-w-[8rem] flex-1 text-[11px] font-medium uppercase tracking-wide text-slate-400">
                Search
                <div className="relative mt-1">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
                  <input
                    type="search"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Name or ID"
                    className={`${fieldClass} pl-8`}
                  />
                </div>
              </label>
              <label className="min-w-[7rem] w-[8.5rem] shrink-0 text-[11px] font-medium uppercase tracking-wide text-slate-400">
                Sort
                <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className={`${fieldClass} mt-1`}>
                  <option value="time">Time</option>
                  <option value="name">Name</option>
                  <option value="late">Late first</option>
                  <option value="type">Type</option>
                </select>
              </label>
            </div>

            <div className="relative min-h-[16rem] flex-1 overflow-hidden rounded-xl border border-slate-700 bg-slate-800">
              {filteredRecords.length === 0 ? (
                <div className="flex h-full items-center justify-center px-4 text-center text-sm text-slate-400">
                  {searchQuery.trim()
                    ? 'No one matches that name or ID for this date.'
                    : 'No attendance records for this date.'}
                </div>
              ) : (
                <div className="divide-y divide-slate-700">
                  {pagedRecords.map((record) => {
                    const isLate = getPunctuality(record) === 'late';
                    const key = personKey(record);
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => togglePerson(record)}
                        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-slate-700/40"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-white">{getPersonName(record)}</p>
                          <p className="truncate text-xs text-slate-400">
                            {record.user_type} · {getPersonLabel(record)}
                            <span className={`ml-2 capitalize ${typeBadge(record.user_type)} rounded-full px-1.5 py-0.5`}>
                              {record.user_type}
                            </span>
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-xs tabular-nums text-slate-300">
                            {record.timestamp ? format(new Date(record.timestamp), 'hh:mm a') : '—'}
                          </p>
                          <p className={`inline-flex items-center gap-1 text-xs ${isLate ? 'text-amber-400' : 'text-emerald-400'}`}>
                            {isLate ? <AlertTriangle className="h-3.5 w-3.5" /> : <Clock className="h-3.5 w-3.5" />}
                            {isLate ? 'Late' : 'Early'}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
              {openRecord ? (
                <div className="absolute inset-0 z-10 overflow-hidden rounded-xl border border-slate-700">
                  <TermRecords
                    data={termCache[personKey(openRecord)]}
                    loading={termLoading}
                    personName={getPersonName(openRecord)}
                    personLabel={getPersonLabel(openRecord)}
                    onClose={() => setOpenKey(null)}
                  />
                </div>
              ) : null}
            </div>
            {filteredRecords.length > 0 && !openRecord ? (
              <PaginationBar
                page={safeAttPage}
                total={filteredRecords.length}
                limit={ATTENDANCE_PAGE_SIZE}
                onPageChange={setAttPage}
              />
            ) : null}
          </div>
        ) : null}

        {tab === 'reports' ? (
          <section className="space-y-4">
            <div className="rounded-2xl border border-slate-700 bg-slate-900/50 p-4 text-sm text-slate-300">
              Teachers enter and save marks. You publish the class report. After publish, teachers cannot change
              marks unless you allow one teacher. You cannot edit marks from here.
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
  );
};

export default AdministratorSchool;
