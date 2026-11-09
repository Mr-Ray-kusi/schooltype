import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Download, RefreshCw, Search, Trash2, X } from 'lucide-react';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import { cachedGet, invalidateCache, peekCache, staleGet } from '../utils/requestCache';
import { eachSchoolDay, schoolLocalDate } from '../utils/schoolDate';
import { useLivePoll } from '../hooks/useLivePoll';
import { useAuth } from '../contexts/authcontext';
import { downloadAllStudentAttendanceZip, downloadTermAttendancePdf } from '../utils/attendanceTermPdf';
import PaginationBar from '../components/PaginationBar';
import PersonRecordTable from '../components/PersonRecordTable';
import ConfirmTypedDeleteModal from '../components/ConfirmTypedDeleteModal';
import { LIST_PAGE_SIZE } from '../utils/listApi';

const fieldClass =
  'h-9 min-h-9 w-full rounded-lg border border-slate-600 bg-slate-900 px-2.5 text-sm text-white outline-none focus:ring-2 focus:ring-primary-500';

const typeLabel = (type) => {
  const value = String(type || '').toLowerCase();
  if (value === 'student') return 'Student';
  if (value === 'staff') return 'Staff';
  if (value === 'non-staff' || value === 'nonstaff' || value === 'non_staff') return 'Non-staff';
  return 'Person';
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

const getPunctuality = (record) => {
  const known = record.punctuality || record.status;
  if (known === 'absent' || known === 'early' || known === 'late' || known === 'unmarked') return known;
  return 'unmarked';
};

const statusTone = (status) => {
  if (status === 'absent') return 'text-rose-400';
  if (status === 'late') return 'text-amber-400';
  if (status === 'unmarked') return 'text-slate-400';
  return 'text-emerald-400';
};

const statusLabel = (status) => {
  if (status === 'absent') return 'Absent';
  if (status === 'late') return 'Late';
  if (status === 'unmarked') return 'Not marked';
  return 'Early';
};

const formatMarkTime = (timestamp) => {
  if (!timestamp) return '—';
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return '—';
  return format(parsed, 'hh:mm a');
};

const personKey = (record) => `${record.user_type || 'student'}:${record.user_id || record.id}`;

const fallbackTermAttendance = (record, selectedDate) => {
  const to = /^\d{4}-\d{2}-\d{2}$/.test(String(selectedDate || '')) ? selectedDate : schoolLocalDate();
  const from = `${String(to).slice(0, 7)}-01`;
  const userType = record.user_type || 'student';
  const days = eachSchoolDay(from, to);
  const walk = days.length ? days : /^\d{4}-\d{2}-\d{2}$/.test(to) ? [to] : [];
  const records = walk.map((day) => {
    const isSelected = day === to;
    const status = isSelected ? getPunctuality(record) : 'absent';
    return {
      id: `unmarked:${userType}:${record.user_id}:${day}`,
      user_id: record.user_id,
      user_type: userType,
      date: day,
      timestamp: isSelected ? record.timestamp || null : null,
      status,
      punctuality: status,
    };
  });
  const late = records.filter((row) => row.status === 'late').length;
  const absent = records.filter((row) => row.status === 'absent').length;
  return {
    user_id: record.user_id,
    user_type: userType,
    term: { name: null, starts_on: from, ends_on: to, source: 'local' },
    records,
    summary: {
      days: records.length,
      early: Math.max(0, records.length - late - absent),
      late,
      absent,
    },
  };
};

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
  seed,
  selectedDate,
}) => {
  const { canDownload } = useAuth();
  const fallback = seed ? fallbackTermAttendance(seed, selectedDate) : null;
  const pack = Array.isArray(data?.records) && data.records.length ? data : fallback;
  const records = pack?.records || [];

  if (loading && !records.length) {
    return <p className="px-3 py-2 text-xs text-slate-400">Loading this term…</p>;
  }

  const summaryLine = pack?.summary
    ? `${pack.summary.days} days · ${pack.summary.early} early · ${pack.summary.late} late${
        pack.summary.absent ? ` · ${pack.summary.absent} absent` : ''
      }`
    : '';

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-900">
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-800 px-5 py-4">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Attendance</p>
          <h2 className="mt-1 truncate text-xl font-bold text-white">{personName}</h2>
          <p className="mt-1 truncate text-sm text-slate-400">
            {[typeLabel(userType), personLabel, pack?.term?.name, summaryLine].filter(Boolean).join(' · ')}
          </p>
        </div>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        ) : null}
      </div>
      <div className="flex shrink-0 gap-2 px-5 py-3">
          <button
            type="button"
            disabled={!canDownload}
            onClick={(event) => {
              event.stopPropagation();
              if (!canDownload) {
                toast.error('Downloads are locked until the term plan is renewed.');
                return;
              }
              try {
                downloadTermAttendancePdf({
                  schoolName,
                  personName,
                  personLabel,
                  userType,
                  term: pack?.term,
                  records,
                  summary: pack?.summary,
                });
              } catch {
                toast.error('Could not download this attendance record');
              }
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-600 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800"
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
              className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/40 px-3 py-1.5 text-sm text-rose-200 hover:bg-rose-500/10 disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {deleting ? 'Deleting…' : 'Delete'}
            </button>
          ) : null}
      </div>
      {records.length === 0 ? (
        <p className="px-5 pb-5 text-sm text-slate-500">No records for this term yet.</p>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 z-10 bg-slate-800 text-slate-300">
              <tr>
                <th className="px-3 py-2 font-medium">Date</th>
                <th className="px-3 py-2 font-medium">Time</th>
                <th className="px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {records.map((row) => {
                const status = getPunctuality(row);
                return (
                  <tr key={row.id || row.date} className="border-t border-slate-800 bg-slate-900 text-slate-100">
                    <td className="px-3 py-2 text-slate-200">
                      {row.date ? format(new Date(`${row.date}T12:00:00`), 'EEE d MMM') : '—'}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-slate-300">
                      {status === 'absent' ? '—' : row.timestamp ? format(new Date(row.timestamp), 'hh:mm a') : '—'}
                    </td>
                    <td className={`px-3 py-2 ${statusTone(status)}`}>{statusLabel(status)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

const Attendance = () => {
  const { school, canDownload } = useAuth();
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
  const [pendingDelete, setPendingDelete] = useState(null);
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
        const data = await cachedGet(cacheKey, fetcher, 8000);
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
        const data = await cachedGet(cacheKey, fetcher, silent ? 20000 : 8000);
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

  const pageCount = Math.max(1, Math.ceil(filteredRecords.length / LIST_PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pagedRecords = useMemo(
    () => filteredRecords.slice((safePage - 1) * LIST_PAGE_SIZE, safePage * LIST_PAGE_SIZE),
    [filteredRecords, safePage]
  );
  const openRecord = useMemo(
    () => (openKey ? filteredRecords.find((record) => personKey(record) === openKey) || null : null),
    [openKey, filteredRecords]
  );
  const tableRows = useMemo(
    () =>
      pagedRecords.map((record) => ({
        ...record,
        id: record.user_id || record.id,
        kind: record.user_type || 'student',
        name: getPersonName(record),
        typeLabel: typeLabel(record.user_type),
        detail: getPersonLabel(record),
        timeLabel: formatMarkTime(record.timestamp),
      })),
    [pagedRecords]
  );

  useEffect(() => {
    if (!openRecord || pendingDelete) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') setOpenKey(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openRecord, pendingDelete]);

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
      setPendingDelete(null);
      refresh();
    } catch (error) {
      toast.error(error.response?.data?.error || 'Could not delete these records');
    } finally {
      setDeletingKey(null);
    }
  };

  const downloadAllStudentPdfs = async () => {
    if (!canDownload) {
      toast.error('Downloads are locked until the term plan is renewed.');
      return;
    }
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
      seed: record,
      selectedDate,
      onDelete: isStudent ? () => setPendingDelete(record) : undefined,
      deleting: deletingKey === key,
      onClose: () => setOpenKey(null),
    };
  };

  const openPerson = async (record) => {
    if (!record?.user_id) return;
    const key = personKey(record);
    setOpenKey(key);
    if (Array.isArray(termCache[key]?.records) && termCache[key].records.length) return;
    setTermLoading(true);
    try {
      const { data } = await axios.get(`/api/attendance/person/${encodeURIComponent(record.user_id)}`, {
        params: { userType: record.user_type || 'student' },
        timeout: 30000,
      });
      setTermCache((prev) => ({
        ...prev,
        [key]: Array.isArray(data?.records) && data.records.length ? data : fallbackTermAttendance(record, selectedDate),
      }));
    } catch {
      setTermCache((prev) => ({ ...prev, [key]: fallbackTermAttendance(record, selectedDate) }));
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

  if (loading && attendanceRecords.length === 0 && !peekCache(`attendance:${selectedDate}`)) {
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
            {filteredRecords.length} people
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
            disabled={Boolean(bulkBusy) || !canDownload}
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
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-end gap-2 rounded-xl border border-slate-700 bg-slate-800 p-2 print:hidden">
        <label className="min-w-[8.5rem] flex-1 text-[11px] font-medium uppercase tracking-wide text-slate-400">
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
        <label className="min-w-[8.5rem] flex-1 text-[11px] font-medium uppercase tracking-wide text-slate-400">
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
        <label className="min-w-[8.5rem] flex-1 text-[11px] font-medium uppercase tracking-wide text-slate-400">
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
        <label className="w-full shrink-0 text-[11px] font-medium uppercase tracking-wide text-slate-400 sm:w-[7.5rem]">
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

      <div className="min-h-0 flex-1 overflow-y-auto">
        {filteredRecords.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-600 bg-slate-800/50 py-16 text-center">
            <p className="text-slate-300">
              {searchQuery.trim()
                ? 'No one matches that name or ID for this date.'
                : 'No students, staff, or non-staff for this date.'}
            </p>
          </div>
        ) : (
          <PersonRecordTable
            rows={tableRows}
            minWidth="520px"
            compact
            onSelect={openPerson}
            columns={[
              { key: 'name', header: 'Name' },
              { key: 'typeLabel', header: 'Type' },
              { key: 'detail', header: 'Class / Role' },
              { key: 'timeLabel', header: 'Time' },
              {
                key: 'status',
                header: 'Status',
                render: (row) => {
                  const status = getPunctuality(row);
                  return <span className={statusTone(status)}>{statusLabel(status)}</span>;
                },
              },
            ]}
          />
        )}
      </div>

      {filteredRecords.length > 0 ? (
        <div className="shrink-0 print:hidden">
          <PaginationBar
            page={safePage}
            total={filteredRecords.length}
            limit={LIST_PAGE_SIZE}
            onPageChange={setPage}
          />
        </div>
      ) : null}

      {openRecord ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/70 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-sm sm:items-center sm:p-4"
          onClick={() => setOpenKey(null)}
        >
          <div
            className="flex h-[min(80dvh,36rem)] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl border border-slate-700 bg-slate-900 shadow-2xl sm:rounded-3xl"
            role="dialog"
            aria-modal="true"
            aria-label={`Attendance for ${getPersonName(openRecord)}`}
            onClick={(event) => event.stopPropagation()}
          >
            <TermRecords {...termRecordProps(openRecord)} />
          </div>
        </div>
      ) : null}

      <ConfirmTypedDeleteModal
        open={Boolean(pendingDelete)}
        title={`Delete attendance for ${pendingDelete ? getPersonName(pendingDelete) : 'this person'}?`}
        description={
          pendingDelete
            ? `This permanently deletes every attendance record for ${getPersonName(pendingDelete)}. Type their name to confirm.`
            : null
        }
        confirmText={pendingDelete ? getPersonName(pendingDelete) : ''}
        actionLabel="Delete attendance records"
        busy={Boolean(deletingKey)}
        onClose={() => {
          if (!deletingKey) setPendingDelete(null);
        }}
        onConfirm={() => deletePersonRecords(pendingDelete)}
      />
    </div>
  );
};

export default Attendance;
