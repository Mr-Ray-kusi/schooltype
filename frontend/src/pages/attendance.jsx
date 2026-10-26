import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { AlertTriangle, ChevronDown, Clock, Download, Printer, RefreshCw, Search, Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import { cachedGet, forceGet, invalidateCache, peekCache, staleGet } from '../utils/requestCache';
import { schoolLocalDate } from '../utils/schoolDate';
import { useLivePoll } from '../hooks/useLivePoll';
import { useAuth } from '../contexts/authcontext';
import { useStaffEmbed } from '../contexts/staffEmbed';
import { downloadAllStudentAttendanceZip, downloadTermAttendancePdf } from '../utils/attendanceTermPdf';
import PaginationBar from '../components/PaginationBar';

const ATTENDANCE_PAGE_SIZE = 5;
const TERM_DAY_PAGE_SIZE = 8;

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

const getPersonLabel = (record) => {
  if (record.user_type === 'student') {
    return record.user?.class || record.user_label || 'N/A';
  }
  return record.user?.role || record.user_label || 'N/A';
};

const getPersonName = (record) => record.user?.name || record.user_name || 'Unknown';

const recordMatchesSearch = (record, query) => {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  const name = getPersonName(record).toLowerCase();
  if (name.includes(q)) return true;
  const ids = [
    record.user_id,
    record.user?.id,
    record.user?.roll_number,
    record.user?.barcode,
    record.barcode,
  ];
  return ids.some((value) => String(value || '').trim().toLowerCase().includes(q));
};

const getPunctuality = (record) =>
  record.punctuality ||
  (record.status === 'absent' || record.status === 'early' || record.status === 'late'
    ? record.status
    : null) ||
  'early';

const statusTone = (status) => {
  if (status === 'absent') return 'text-rose-400';
  if (status === 'late') return 'text-amber-400';
  return 'text-emerald-400';
};

const statusLabel = (status) => {
  if (status === 'absent') return 'Absent';
  if (status === 'late') return 'Late';
  return 'Early';
};

const personKey = (record) => `${record.user_type || 'student'}:${record.user_id || record.id}`;

const TermRecords = ({
  data,
  loading,
  schoolName,
  personName,
  personLabel,
  userType,
  onDelete,
  deleting,
  onClose,
}) => {
  const [dayPage, setDayPage] = useState(1);
  const records = data?.records || [];
  const dayPages = Math.max(1, Math.ceil(records.length / TERM_DAY_PAGE_SIZE));
  const safeDayPage = Math.min(dayPage, dayPages);
  const pagedDays = records.slice(
    (safeDayPage - 1) * TERM_DAY_PAGE_SIZE,
    safeDayPage * TERM_DAY_PAGE_SIZE
  );

  if (loading && !data) {
    return <p className="px-3 py-2 text-xs text-slate-400">Loading this term…</p>;
  }

  return (
    <div className="flex min-h-0 flex-col bg-slate-900 px-3 py-3">
      <div className="flex shrink-0 items-center justify-between gap-2">
        <p className="truncate text-xs text-slate-400">
          {personName}
          {personLabel ? ` · ${personLabel}` : ''}
          {data?.term?.name ? ` · ${data.term.name}` : ''}
          {data?.summary
            ? ` · ${data.summary.days} days · ${data.summary.early} early · ${data.summary.late} late${
                data.summary.absent ? ` · ${data.summary.absent} absent` : ''
              }`
            : ''}
        </p>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              try {
                downloadTermAttendancePdf({
                  schoolName,
                  personName,
                  personLabel,
                  userType,
                  term: data?.term,
                  records,
                  summary: data?.summary,
                });
              } catch {
                toast.error('Could not download this attendance record');
              }
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-600 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-800"
          >
            <Download className="h-3.5 w-3.5" />
            Download
          </button>
          {onDelete ? (
            <button
              type="button"
              disabled={deleting}
              onClick={(event) => {
                event.stopPropagation();
                onDelete();
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/40 px-2.5 py-1 text-xs text-rose-200 hover:bg-rose-500/10 disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {deleting ? 'Deleting…' : 'Delete'}
            </button>
          ) : null}
          {onClose ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onClose();
              }}
              className="rounded-lg border border-slate-600 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-800"
            >
              Close
            </button>
          ) : null}
        </div>
      </div>
      {records.length === 0 ? (
        <p className="mt-3 text-xs text-slate-500">No records for this term yet.</p>
      ) : (
        <>
          <table className="mt-3 w-full text-left text-xs">
            <thead className="text-slate-400">
              <tr>
                <th className="px-2 py-1 font-medium">Date</th>
                <th className="px-2 py-1 font-medium">Time</th>
                <th className="px-2 py-1 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {pagedDays.map((row) => {
                const status = getPunctuality(row);
                return (
                  <tr key={row.id || row.date} className="border-t border-slate-800">
                    <td className="px-2 py-1 text-slate-200">
                      {row.date ? format(new Date(`${row.date}T12:00:00`), 'EEE d MMM') : '—'}
                    </td>
                    <td className="px-2 py-1 tabular-nums text-slate-300">
                      {status === 'absent' ? '—' : row.timestamp ? format(new Date(row.timestamp), 'hh:mm a') : '—'}
                    </td>
                    <td className={`px-2 py-1 ${statusTone(status)}`}>
                      {statusLabel(status)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {records.length > TERM_DAY_PAGE_SIZE ? (
            <div className="mt-auto shrink-0 pt-2">
              <PaginationBar
                page={safeDayPage}
                total={records.length}
                limit={TERM_DAY_PAGE_SIZE}
                onPageChange={setDayPage}
              />
            </div>
          ) : null}
        </>
      )}
    </div>
  );
};

const Attendance = () => {
  const { school } = useAuth();
  const { embedded } = useStaffEmbed();
  const [attendanceRecords, setAttendanceRecords] = useState([]);
  const [openKey, setOpenKey] = useState(null);
  const [termCache, setTermCache] = useState({});
  const [termLoading, setTermLoading] = useState(false);
  const [selectedDate, setSelectedDate] = useState(schoolLocalDate());
  const [selectedType, setSelectedType] = useState('all');
  const [selectedClass, setSelectedClass] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState(null);
  const [lateAfterTime, setLateAfterTime] = useState('08:00');
  const [savingLateTime, setSavingLateTime] = useState(false);
  const [setupClasses, setSetupClasses] = useState([]);
  const [deletingKey, setDeletingKey] = useState(null);
  const [bulkBusy, setBulkBusy] = useState('');
  const [page, setPage] = useState(1);
  const [refreshing, setRefreshing] = useState(false);

  const fetchLateSettings = async () => {
    try {
      const response = await axios.get('/api/attendance/settings');
      setLateAfterTime(response.data.lateAfterTime || '08:00');
    } catch (error) {
      console.error('Error fetching attendance settings:', error);
    }
  };

  const fetchAttendance = useCallback(
    async ({ silent = false } = {}) => {
      const cacheKey = `attendance:${selectedDate}`;
      if (!silent) {
        const cached = peekCache(cacheKey);
        if (cached) {
          setAttendanceRecords(cached);
          setLoading(false);
        }
      }
      try {
        const fetcher = async () => (await axios.get(`/api/attendance?date=${selectedDate}`)).data;
        const data = silent ? await cachedGet(cacheKey, fetcher, 4000) : await forceGet(cacheKey, fetcher);
        setAttendanceRecords(Array.isArray(data) ? data : []);
      } catch (error) {
        if (!silent) console.error('Error fetching attendance:', error);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [selectedDate]
  );

  const fetchSummary = useCallback(
    async ({ silent = false } = {}) => {
      const cacheKey = `attendance-summary:${selectedDate}`;
      if (!silent) {
        const cached = peekCache(cacheKey) || peekCache(`dashboard:${selectedDate}`)?.attendance;
        if (cached) setSummary(cached);
      }
      try {
        const fetcher = async () => (await axios.get(`/api/attendance/summary?date=${selectedDate}`)).data;
        const data = silent ? await cachedGet(cacheKey, fetcher, 4000) : await forceGet(cacheKey, fetcher);
        setSummary(data);
      } catch (error) {
        if (!silent) console.error('Error fetching summary:', error);
      }
    },
    [selectedDate]
  );

  useEffect(() => {
    fetchAttendance({ silent: false });
    fetchSummary({ silent: false });
    fetchLateSettings();
  }, [fetchAttendance, fetchSummary]);

  useEffect(() => {
    setSelectedClass('all');
  }, [selectedType]);

  useEffect(() => {
    const cached = peekCache('classes');
    if (Array.isArray(cached)) setSetupClasses(cached);
    staleGet(
      'classes',
      async () => (await axios.get('/api/classes')).data || [],
      45000,
      (rows) => setSetupClasses(Array.isArray(rows) ? rows : [])
    ).catch(() => {});
  }, []);

  useLivePoll(
    () => {
      fetchAttendance({ silent: true });
      fetchSummary({ silent: true });
    },
    20000,
    !loading
  );

  const saveLateSettings = async () => {
    setSavingLateTime(true);
    try {
      const response = await axios.put('/api/attendance/settings', { lateAfterTime });
      setLateAfterTime(response.data.lateAfterTime || lateAfterTime);
      toast.success('Late cutoff saved');
      invalidateCache('attendance');
      fetchAttendance({ silent: false });
      fetchSummary({ silent: false });
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to save late time');
    } finally {
      setSavingLateTime(false);
    }
  };

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
    const fromSetup = (setupClasses || []).map((row) => row.name).filter(Boolean);
    const fromMarked = attendanceRecords
      .filter((record) => record.user_type === 'student')
      .map((record) => getPersonLabel(record))
      .filter((value) => value && value !== 'N/A');
    return Array.from(new Set([...fromSetup, ...fromMarked])).sort((a, b) => a.localeCompare(b));
  }, [attendanceRecords, setupClasses, selectedType]);

  const filteredRecords = useMemo(() => {
    return attendanceRecords.filter((record) => {
      const type = record.user_type === 'nonstaff' || record.user_type === 'non_staff' ? 'non-staff' : record.user_type;
      if (selectedType !== 'all' && type !== selectedType) return false;
      if (selectedClass !== 'all') {
        if (type === 'student' || selectedType === 'staff' || selectedType === 'non-staff') {
          if (getPersonLabel(record) !== selectedClass) return false;
        }
      }
      if (!recordMatchesSearch(record, searchQuery)) return false;
      return true;
    });
  }, [attendanceRecords, selectedType, selectedClass, searchQuery]);

  const lateCount = useMemo(
    () => filteredRecords.filter((record) => getPunctuality(record) === 'late').length,
    [filteredRecords]
  );
  const absentCount = useMemo(
    () => filteredRecords.filter((record) => getPunctuality(record) === 'absent').length,
    [filteredRecords]
  );

  useEffect(() => {
    setPage(1);
  }, [selectedType, selectedClass, searchQuery, selectedDate]);

  const pageCount = Math.max(1, Math.ceil(filteredRecords.length / ATTENDANCE_PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pagedRecords = useMemo(
    () => filteredRecords.slice((safePage - 1) * ATTENDANCE_PAGE_SIZE, safePage * ATTENDANCE_PAGE_SIZE),
    [filteredRecords, safePage]
  );

  const refresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    setLoading(true);
    invalidateCache('attendance');
    setTermCache({});
    setOpenKey(null);
    try {
      await Promise.all([fetchAttendance({ silent: false }), fetchSummary({ silent: false })]);
    } finally {
      setRefreshing(false);
    }
  };

  const deletePersonRecords = async (record) => {
    if (!record?.user_id) return;
    const name = getPersonName(record);
    if (
      !window.confirm(
        `Delete every attendance record for ${name}? This cannot be undone.`
      )
    ) {
      return;
    }
    const key = personKey(record);
    setDeletingKey(key);
    try {
      const { data } = await axios.delete(`/api/attendance/person/${record.user_id}`, {
        params: { userType: record.user_type || 'student' },
      });
      toast.success(`Deleted ${data?.deleted ?? 0} attendance record(s) for ${name}.`);
      setTermCache((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      setOpenKey(null);
      refresh();
    } catch (error) {
      toast.error(error.response?.data?.error || 'Could not delete these records');
    } finally {
      setDeletingKey(null);
    }
  };

  const deleteAllStudentRecords = async () => {
    if (
      !window.confirm(
        'Delete every student’s attendance records? Staff and non-staff records stay. This cannot be undone.'
      )
    ) {
      return;
    }
    setBulkBusy('delete');
    try {
      const { data } = await axios.delete('/api/attendance/students');
      toast.success(`Deleted ${data?.deleted ?? 0} student attendance record(s).`);
      setTermCache({});
      setOpenKey(null);
      refresh();
    } catch (error) {
      toast.error(error.response?.data?.error || 'Could not delete student attendance');
    } finally {
      setBulkBusy('');
    }
  };

  const downloadAllStudentPdfs = async () => {
    const exportType =
      selectedType === 'staff' || selectedType === 'non-staff' || selectedType === 'all'
        ? selectedType
        : 'student';
    const classFilter = selectedClass !== 'all' ? selectedClass : '';
    const search = String(searchQuery || '').trim();
    setBulkBusy('download');
    try {
      const { data } = await axios.get('/api/attendance/export/students', {
        timeout: 60000,
        params: {
          type: exportType,
          class: classFilter || undefined,
          q: search || undefined,
          all: 1,
        },
      });
      const needle = search.toLowerCase();
      const people = (data?.people || data?.students || []).filter((person) => {
        if (classFilter && String(person.class || person.label || '').trim().toLowerCase() !== classFilter.toLowerCase()) {
          return false;
        }
        if (needle) {
          const hay = [person.name, person.id, person.roll_number, person.class, person.label]
            .map((value) => String(value || '').trim().toLowerCase())
            .join(' ');
          if (!hay.includes(needle)) return false;
        }
        return true;
      });
      if (!people.length) {
        toast.error(
          classFilter || search
            ? 'No people match this class, role, or search.'
            : 'No attendance records to export.'
        );
        return;
      }
      await downloadAllStudentAttendanceZip({
        schoolName: data.school_name || school?.name || 'School',
        term: data.term,
        people,
        userType: exportType,
      });
      toast.success(`Prepared ${people.length} PDF(s) for this selection.`);
    } catch (error) {
      toast.error(
        error.response?.data?.error || error.message || 'Could not download attendance PDFs'
      );
    } finally {
      setBulkBusy('');
    }
  };

  const termRecordProps = (record) => {
    const key = personKey(record);
    const isStudent = (record.user_type || 'student') === 'student';
    return {
      data: termCache[key],
      loading: termLoading,
      schoolName: school?.name || 'School',
      personName: getPersonName(record),
      personLabel: getPersonLabel(record),
      userType: record.user_type,
      onDelete: isStudent ? () => deletePersonRecords(record) : undefined,
      deleting: deletingKey === key,
      onClose: () => setOpenKey(null),
    };
  };

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
      const { data } = await axios.get(`/api/attendance/person/${record.user_id}`, {
        params: { userType: record.user_type || 'student' },
      });
      setTermCache((prev) => ({ ...prev, [key]: data }));
    } catch (error) {
      toast.error(error.response?.data?.error || 'Could not load this term attendance');
    } finally {
      setTermLoading(false);
    }
  };

  const summaryItems = summary
    ? [
        { label: 'Students', data: summary.students },
        { label: 'Staff', data: summary.staff },
        { label: 'Non-staff', data: summary.nonStaff },
      ]
    : [];

  if (loading && attendanceRecords.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-400">
        Loading attendance…
      </div>
    );
  }

  return (
    <div className="attendance-page flex h-full min-h-0 flex-col gap-2 overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-lg font-bold text-white">Attendance</h1>
          <p className="truncate text-xs text-slate-400">
            {format(new Date(`${selectedDate}T12:00:00`), 'EEE d MMM yyyy')}
            {' · '}
            {filteredRecords.length} marked
            {lateCount > 0 ? ` · ${lateCount} late` : ''}
            {absentCount > 0 ? ` · ${absentCount} absent` : ''}
            {summaryItems.length
              ? ` · ${summaryItems
                  .map((item) => `${item.label} ${item.data.present}/${item.data.total}`)
                  .join(' · ')}`
              : ''}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 print:hidden">
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className={`${fieldClass} w-[10.5rem]`}
          />
          <button
            type="button"
            onClick={refresh}
            disabled={refreshing}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary-600 px-3 text-sm font-medium text-white hover:bg-primary-500 disabled:opacity-70"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-slate-700 px-3 text-sm font-medium text-white hover:bg-slate-600"
          >
            <Printer className="h-3.5 w-3.5" />
            Print
          </button>
          <button
            type="button"
            disabled={Boolean(bulkBusy)}
            onClick={downloadAllStudentPdfs}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-600 px-3 text-sm font-medium text-slate-100 hover:bg-slate-800 disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" />
            {bulkBusy === 'download'
              ? 'Preparing PDFs…'
              : selectedType === 'staff'
                ? 'Staff PDFs'
                : selectedType === 'non-staff'
                  ? 'Non-staff PDFs'
                  : selectedType === 'all'
                    ? 'PDFs'
                    : 'Student PDFs'}
          </button>
          {embedded ? null : (
            <button
              type="button"
              disabled={Boolean(bulkBusy)}
              onClick={deleteAllStudentRecords}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-rose-500/40 px-3 text-sm font-medium text-rose-200 hover:bg-rose-500/10 disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {bulkBusy === 'delete' ? 'Deleting…' : 'Delete all students'}
            </button>
          )}
        </div>
      </div>

      <div className="flex shrink-0 flex-nowrap items-end gap-2 rounded-xl border border-slate-700 bg-slate-800 p-2 print:hidden">
        <label className="min-w-0 flex-1 text-[11px] font-medium uppercase tracking-wide text-slate-400">
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
        <label className="min-w-0 flex-1 text-[11px] font-medium uppercase tracking-wide text-slate-400">
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
        <label className="min-w-0 flex-1 text-[11px] font-medium uppercase tracking-wide text-slate-400">
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
        <label className="w-[7.5rem] shrink-0 text-[11px] font-medium uppercase tracking-wide text-slate-400">
          Late after
          <input
            type="time"
            value={lateAfterTime}
            onChange={(e) => setLateAfterTime(e.target.value)}
            className={`${fieldClass} mt-1`}
          />
        </label>
        <button
          type="button"
          onClick={saveLateSettings}
          disabled={savingLateTime}
          className="h-9 shrink-0 rounded-lg bg-slate-700 px-3 text-sm font-medium text-white hover:bg-slate-600 disabled:opacity-50"
        >
          {savingLateTime ? 'Saving…' : 'Save'}
        </button>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl border border-slate-700 bg-slate-800">
        {filteredRecords.length === 0 ? (
          <div className="flex h-full items-center justify-center px-4 text-center text-sm text-slate-400">
            {searchQuery.trim()
              ? 'No one matches that name or ID for this date.'
              : 'No attendance records for this date.'}
          </div>
        ) : (
          <div className="h-full divide-y divide-slate-700 overflow-y-auto">
            {pagedRecords.map((record) => {
              const status = getPunctuality(record);
              const key = personKey(record);
              const isOpen = openKey === key;
              return (
                <div key={record.id || key} className={isOpen ? 'bg-slate-900/70' : ''}>
                  <button
                    type="button"
                    onClick={() => togglePerson(record)}
                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-slate-700/40"
                    aria-expanded={isOpen}
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
                    <div className="flex shrink-0 items-center gap-3">
                      <div className="text-right">
                        <p className="text-xs tabular-nums text-slate-300">
                          {format(new Date(record.timestamp), 'hh:mm a')}
                        </p>
                        <p className={`inline-flex items-center gap-1 text-xs ${statusTone(status)}`}>
                          {status === 'late' || status === 'absent' ? (
                            <AlertTriangle className="h-3.5 w-3.5" />
                          ) : (
                            <Clock className="h-3.5 w-3.5" />
                          )}
                          {statusLabel(status)}
                        </p>
                      </div>
                      <ChevronDown
                        className={`h-4 w-4 text-slate-400 transition ${isOpen ? 'rotate-180' : ''}`}
                      />
                    </div>
                  </button>
                  {isOpen ? <TermRecords {...termRecordProps(record)} /> : null}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {filteredRecords.length > 0 ? (
        <div className="shrink-0 print:hidden">
          <PaginationBar
            page={safePage}
            total={filteredRecords.length}
            limit={ATTENDANCE_PAGE_SIZE}
            onPageChange={setPage}
          />
        </div>
      ) : null}
    </div>
  );
};

export default Attendance;
