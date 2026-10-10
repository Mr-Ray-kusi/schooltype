import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { AlertTriangle, Clock, Printer, RefreshCw } from 'lucide-react';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import { cachedGet, invalidateCache, peekCache } from '../utils/requestCache';
import { schoolLocalDate } from '../utils/schoolDate';
import useLiteMode from '../hooks/useLiteMode';
import { useLivePoll } from '../hooks/useLivePoll';

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

const getPunctuality = (record) =>
  record.punctuality ||
  (record.status === 'early' || record.status === 'late' ? record.status : null) ||
  'early';

const Attendance = () => {
  const [attendanceRecords, setAttendanceRecords] = useState([]);
  const [selectedDate, setSelectedDate] = useState(schoolLocalDate());
  const [selectedType, setSelectedType] = useState('all');
  const [selectedClass, setSelectedClass] = useState('all');
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState(null);
  const [lateAfterTime, setLateAfterTime] = useState('08:00');
  const [savingLateTime, setSavingLateTime] = useState(false);
  const { liteMode } = useLiteMode();

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
        const data = await cachedGet(
          cacheKey,
          async () => (await axios.get(`/api/attendance?date=${selectedDate}`)).data,
          silent ? 0 : 4000
        );
        setAttendanceRecords(data);
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
        const data = await cachedGet(
          cacheKey,
          async () => (await axios.get(`/api/attendance/summary?date=${selectedDate}`)).data,
          silent ? 0 : 4000
        );
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

  const classOptions = useMemo(
    () =>
      Array.from(
        new Set(attendanceRecords.map((record) => getPersonLabel(record)).filter((v) => v && v !== 'N/A'))
      ).sort(),
    [attendanceRecords]
  );

  const filteredRecords = useMemo(() => {
    return attendanceRecords.filter((record) => {
      if (selectedType !== 'all' && record.user_type !== selectedType) return false;
      if (selectedClass !== 'all' && getPersonLabel(record) !== selectedClass) return false;
      return true;
    });
  }, [attendanceRecords, selectedType, selectedClass]);

  const lateCount = useMemo(
    () => filteredRecords.filter((record) => getPunctuality(record) === 'late').length,
    [filteredRecords]
  );

  const refresh = () => {
    invalidateCache('attendance');
    setLoading(true);
    fetchAttendance({ silent: false });
    fetchSummary({ silent: false });
  };

  const summaryItems = summary
    ? [
        { label: 'Students', data: summary.students },
        { label: 'Staff', data: summary.staff },
        { label: 'Non-staff', data: summary.nonStaff },
      ]
    : [];

  if (loading && attendanceRecords.length === 0) {
    return <div className="py-10 text-center text-sm text-slate-400">Loading attendance…</div>;
  }

  return (
    <div className="attendance-page space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 print:block">
        <div>
          <h1 className="text-2xl font-bold text-white">Attendance</h1>
          <p className="mt-0.5 text-sm text-slate-400">
            {format(new Date(`${selectedDate}T12:00:00`), 'EEE d MMM yyyy')}
            {' · '}
            {filteredRecords.length} marked
            {lateCount > 0 ? ` · ${lateCount} late` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className={`${fieldClass} w-[10.5rem]`}
          />
          <button
            type="button"
            onClick={refresh}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary-600 px-3 text-sm font-medium text-white hover:bg-primary-500"
          >
            <RefreshCw className="h-3.5 w-3.5" />
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
        </div>
      </div>

      {summaryItems.length > 0 && (
        <div className="grid grid-cols-3 gap-2 print:hidden">
          {summaryItems.map((item) => (
            <div
              key={item.label}
              className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-2.5"
            >
              <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                {item.label}
              </p>
              <p className="mt-0.5 text-lg font-semibold tabular-nums text-white">
                {item.data.present}/{item.data.total}
                <span className="ml-1.5 text-xs font-normal text-slate-400">
                  {item.data.percentage ?? 0}%
                </span>
              </p>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-2 rounded-xl border border-slate-700 bg-slate-800 p-3 print:hidden">
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
          Class / role
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
        <label className="min-w-[7.5rem] text-[11px] font-medium uppercase tracking-wide text-slate-400">
          Late after
          <input
            type="time"
            value={lateAfterTime}
            onChange={(e) => setLateAfterTime(e.target.value)}
            className={`${fieldClass} mt-1 w-[7.5rem]`}
          />
        </label>
        <button
          type="button"
          onClick={saveLateSettings}
          disabled={savingLateTime}
          className="h-9 rounded-lg bg-slate-700 px-3 text-sm font-medium text-white hover:bg-slate-600 disabled:opacity-50"
        >
          {savingLateTime ? 'Saving…' : 'Save'}
        </button>
      </div>

      {filteredRecords.length === 0 ? (
        <div className="rounded-xl border border-slate-700 bg-slate-800 py-10 text-center text-sm text-slate-400">
          No attendance records for this date.
        </div>
      ) : liteMode ? (
        <div className="divide-y divide-slate-700 overflow-hidden rounded-xl border border-slate-700 bg-slate-800">
          {filteredRecords.map((record) => {
            const isLate = getPunctuality(record) === 'late';
            return (
              <div key={record.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-white">{getPersonName(record)}</p>
                  <p className="truncate text-xs text-slate-400">
                    {record.user_type} · {getPersonLabel(record)}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-xs tabular-nums text-slate-300">
                    {format(new Date(record.timestamp), 'hh:mm a')}
                  </p>
                  <p className={`text-xs ${isLate ? 'text-amber-400' : 'text-emerald-400'}`}>
                    {isLate ? 'Late' : 'Early'}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <>
          <div className="hidden overflow-hidden rounded-xl border border-slate-700 bg-slate-800 md:block">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-900/80 text-[11px] uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Type</th>
                  <th className="px-3 py-2 font-medium">Class / role</th>
                  <th className="px-3 py-2 font-medium">Time</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/80">
                {filteredRecords.map((record) => {
                  const isLate = getPunctuality(record) === 'late';
                  return (
                    <tr key={record.id} className="hover:bg-slate-700/40">
                      <td className="px-3 py-2 font-medium text-white">{getPersonName(record)}</td>
                      <td className="px-3 py-2">
                        <span className={`rounded-full px-2 py-0.5 text-[11px] capitalize ${typeBadge(record.user_type)}`}>
                          {record.user_type}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-slate-300">{getPersonLabel(record)}</td>
                      <td className="px-3 py-2 tabular-nums text-slate-300">
                        {format(new Date(record.timestamp), 'hh:mm a')}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-flex items-center gap-1 text-xs font-medium ${
                            isLate ? 'text-amber-400' : 'text-emerald-400'
                          }`}
                        >
                          {isLate ? <AlertTriangle className="h-3.5 w-3.5" /> : <Clock className="h-3.5 w-3.5" />}
                          {isLate ? 'Late' : 'Early'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="divide-y divide-slate-700 overflow-hidden rounded-xl border border-slate-700 bg-slate-800 md:hidden">
            {filteredRecords.map((record) => {
              const isLate = getPunctuality(record) === 'late';
              return (
                <div key={record.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-white">{getPersonName(record)}</p>
                    <p className="truncate text-xs text-slate-400">
                      {record.user_type} · {getPersonLabel(record)}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-xs tabular-nums text-slate-300">
                      {format(new Date(record.timestamp), 'hh:mm a')}
                    </p>
                    <p className={`text-xs font-medium ${isLate ? 'text-amber-400' : 'text-emerald-400'}`}>
                      {isLate ? 'Late' : 'Early'}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
};

export default Attendance;
