import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import axios from 'axios';
import { buildStudentIdUrl } from '../utils/studentIdQr';
import { forceGet, invalidateCache, notifySchoolDataChanged, onSchoolDataChanged, peekCache, staleGet } from '../utils/requestCache';
import { parseListResponse, fetchAllPages, fetchRecord, LIST_PAGE_SIZE } from '../utils/listApi.js';
import { downloadPersonPack, downloadPeoplePacks, studentPack } from '../utils/personPackExport';
import PersonRecordTable from '../components/PersonRecordTable';
import PersonDetailModal from '../components/PersonDetailModal';
import ConfirmPersonDeleteModal from '../components/ConfirmPersonDeleteModal';
import CopyMarkButton from '../components/CopyMarkButton';
import PaginationBar from '../components/PaginationBar';
import { Search, User, Download, UserPlus, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../contexts/authcontext';
import { useStaffEmbed } from '../contexts/staffEmbed';
import AddStudent from './addstudends';
import { buildTermAttendancePdfBytes } from '../utils/attendanceTermPdf';
import { emptyExtraFee, extraFeesPayload, formatExtraFees, formatExtraFeesAmount, parseExtraFees } from '../utils/extraFees';

const Students = () => {
  const { school, canWrite, canDownload } = useAuth();
  const embed = useStaffEmbed();
  const [showAdd, setShowAdd] = useState(false);
  const [students, setStudents] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedClass, setSelectedClass] = useState('all');
  const [classOptions, setClassOptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingStudent, setEditingStudent] = useState(null);
  const [viewingStudent, setViewingStudent] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [downloadingAll, setDownloadingAll] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [portalPassword, setPortalPassword] = useState('');
  const [portalPasswordState, setPortalPasswordState] = useState('idle');

  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(searchTerm), 300);
    return () => clearTimeout(id);
  }, [searchTerm]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, selectedClass]);

  useEffect(() => {
    fetchStudents();
  }, [page, debouncedSearch, selectedClass]);

  useEffect(() => {
    return onSchoolDataChanged((prefixes) => {
      if (
        prefixes.includes('visible') ||
        prefixes.some((prefix) => !prefix || prefix === 'students' || prefix.startsWith('students'))
      ) {
        fetchStudents({ force: true });
      }
    });
  }, [page, debouncedSearch, selectedClass]);

  const passwordStudentId = viewingStudent?.id || editingStudent?.id;

  useEffect(() => {
    if (!passwordStudentId) {
      setPortalPassword('');
      setPortalPasswordState('idle');
      return undefined;
    }
    let cancelled = false;
    setPortalPassword('');
    setPortalPasswordState('loading');
    const loadPassword = async () => {
      try {
        const { data } = await axios.get(`/api/students/${passwordStudentId}/portal-password`);
        let password = data?.password || '';
        if (!password) {
          const issued = await axios.post(`/api/students/${passwordStudentId}/portal-password`);
          password = issued.data?.password || '';
        }
        if (cancelled) return;
        setPortalPassword(password);
        setPortalPasswordState(password ? 'ready' : 'missing');
      } catch {
        if (cancelled) return;
        setPortalPassword('');
        setPortalPasswordState('missing');
      }
    };
    loadPassword();
    return () => {
      cancelled = true;
    };
  }, [passwordStudentId]);

  const replacePortalPassword = async () => {
    if (!editingStudent?.id) return;
    try {
      const { data } = await axios.post(`/api/students/${editingStudent.id}/portal-password`);
      if (!data?.password) throw new Error('The server did not return a password');
      setPortalPassword(data.password);
      setPortalPasswordState('ready');
      toast.success('New portal password issued');
    } catch (error) {
      toast.error(error.response?.data?.error || error.message || 'Could not issue a password');
    }
  };

  const sendPortalPassword = async () => {
    if (!editingStudent?.id) return;
    try {
      await axios.post(`/api/students/${editingStudent.id}/portal-password/sms`);
      toast.success('Portal sign-in details sent to the parent phone');
    } catch (error) {
      toast.error(error.response?.data?.error || 'Could not send the password');
    }
  };

  const fetchStudents = async ({ force = false } = {}) => {
    const cacheKey = `students:${page}:${debouncedSearch}:${selectedClass}`;
    const apply = (data) => {
      const parsed = parseListResponse(data);
      setStudents(parsed.items);
      setTotal(parsed.total);
    };
    const cached = force ? null : peekCache(cacheKey);
    if (cached) {
      apply(cached);
      setLoading(false);
    }
    try {
      const fetcher = async () => {
        const response = await axios.get('/api/students', {
          params: {
            page,
            limit: LIST_PAGE_SIZE,
            q: debouncedSearch || undefined,
            class: selectedClass !== 'all' ? selectedClass : undefined,
          },
        });
        return response.data;
      };
      const data = force
        ? await forceGet(cacheKey, fetcher)
        : await staleGet(cacheKey, fetcher, 45000, apply);
      apply(data);
    } catch (error) {
      console.error('Error fetching students:', error);
      toast.error(error.response?.data?.error || 'Could not load students');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    axios
      .get('/api/classes')
      .then(({ data }) => setClassOptions(Array.isArray(data) ? data.map((c) => c.name).filter(Boolean) : []))
      .catch(() => setClassOptions([]));
  }, []);

  const downloadStudentDetails = async (student) => {
    if (!canDownload) {
      toast.error('Downloads are locked until the term plan is renewed.');
      return;
    }
    const full = await fetchRecord(axios, `/api/students/${student.id}`, student);
    const pack = studentPack(full, buildStudentIdUrl(full.barcode));
    try {
      const { data } = await axios.get(`/api/attendance/person/${student.id}`, {
        params: { userType: 'student' },
      });
      const built = buildTermAttendancePdfBytes({
        schoolName: school?.name || 'School',
        personName: full.name,
        personLabel: full.class,
        userType: 'student',
        term: data?.term,
        records: data?.records || [],
        summary: data?.summary || {},
      });
      pack.extraFiles = [{ name: built.fileName, data: built.bytes }];
    } catch {
      /* attendance may be empty */
    }
    await downloadPersonPack(pack);
  };

  const handleDelete = async (student) => {
    try {
      await axios.delete(`/api/students/${student.id}`);
      toast.success('Student and related records removed');
      notifySchoolDataChanged(['students', 'dashboard', 'attendance']);
      setPendingDelete(null);
      setViewingStudent(null);
      fetchStudents();
    } catch (error) {
      toast.error(error.response?.data?.error || 'Could not delete this student');
    }
  };

  const handleEdit = (student) => {
    setViewingStudent(null);
    setEditingStudent({
      ...student,
      extraFees: parseExtraFees(student.extra_fees || student.extraFees),
    });
  };

  const openStudent = async (student) => {
    setViewingStudent(student);
    const full = await fetchRecord(axios, `/api/students/${student.id}`, student);
    setViewingStudent(full);
  };

  const handleUpdate = async (e) => {
    e.preventDefault();
    try {
      const { data } = await axios.put(`/api/students/${editingStudent.id}`, {
        name: editingStudent.name,
        class: editingStudent.class,
        parentName: editingStudent.parent_name,
        parentRelationship: editingStudent.parent_relationship,
        parentEmail: editingStudent.parent_email,
        parentPhone: editingStudent.parent_phone,
        houseAddress: editingStudent.house_address,
        dateOfBirth: editingStudent.date_of_birth,
        gender: editingStudent.gender,
        extraFees: extraFeesPayload(editingStudent.extraFees),
        rollNumber: editingStudent.roll_number,
      });
      notifySchoolDataChanged(['students', 'dashboard']);
      setEditingStudent(null);
      if (data) setViewingStudent(data);
      toast.success('Student updated');
      fetchStudents({ force: true });
    } catch (error) {
      console.error('Error updating student:', error);
      toast.error(error.response?.data?.error || 'Could not save gender or extra charges');
    }
  };

  const handleDownloadAll = async () => {
    setDownloadingAll(true);
    try {
      const all = await fetchAllPages(axios, '/api/students', {
        q: debouncedSearch || undefined,
        class: selectedClass !== 'all' ? selectedClass : undefined,
      });
      if (!all.length) {
        toast.error('No students to download');
        return;
      }
      await downloadPeoplePacks(
        all.map((student) => studentPack(student, buildStudentIdUrl(student.barcode))),
        'all-students.zip'
      );
      toast.success(`Downloaded ${all.length} student folders`);
    } catch (error) {
      toast.error(error.message || 'Failed to download students');
    } finally {
      setDownloadingAll(false);
    }
  };

  const location = useLocation();

  useEffect(() => {
    if (location.hash === '#list') {
      document.getElementById('list-section')?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [location]);

  if (loading && students.length === 0) {
    return (
      <>
        <div className="text-center py-12 text-slate-300">Loading students...</div>
      </>
    );
  }

  return (
    <>
<div className="space-y-4">
        <div>
          <h1 className="page-title">Students</h1>
          <p className="mt-1 text-slate-300">{total} student{total !== 1 ? 's' : ''} enrolled</p>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search students..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full min-w-0 rounded-lg border border-slate-500 py-2 pl-10 pr-3 text-sm focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <button
            type="button"
            disabled={refreshing}
            onClick={async () => {
              setRefreshing(true);
              invalidateCache('students');
              try {
                await fetchStudents({ force: true });
              } finally {
                setRefreshing(false);
              }
            }}
            className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-500 px-3 py-2 text-sm text-slate-100 hover:bg-slate-800 disabled:opacity-70"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          {canWrite ? (
            embed.embedded ? (
              <button
                type="button"
                onClick={() => setShowAdd(true)}
                className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg bg-primary-600 px-3 py-2 text-sm font-medium text-white hover:bg-primary-700"
              >
                <UserPlus className="h-4 w-4" />
                Add student
              </button>
            ) : (
              <Link
                to="/add-student"
                className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg bg-primary-600 px-3 py-2 text-sm font-medium text-white hover:bg-primary-700"
              >
                <UserPlus className="h-4 w-4" />
                Add student
              </Link>
            )
          ) : null}
          <select
            value={selectedClass}
            onChange={(e) => setSelectedClass(e.target.value)}
            className="max-w-[9.5rem] shrink-0 rounded-lg border border-slate-500 px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500"
          >
            <option value="all">All Classes</option>
            {classOptions.map((cls) => (
              <option key={cls} value={cls}>{cls}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleDownloadAll}
            disabled={downloadingAll || total === 0 || !canDownload}
            className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg bg-slate-700 px-3 py-2 text-sm text-white hover:bg-slate-600 disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            {downloadingAll ? 'Preparing…' : 'Download all'}
          </button>
        </div>

        <PersonDetailModal
          open={Boolean(viewingStudent)}
          name={viewingStudent?.name}
          badge={viewingStudent?.class || 'No class'}
          accent="sky"
          fields={[
            { group: 'School', label: 'Student ID', value: viewingStudent?.roll_number, copy: Boolean(viewingStudent?.roll_number) },
            {
              group: 'School',
              label: 'Portal password',
              value:
                portalPasswordState === 'loading'
                  ? 'Loading…'
                  : portalPassword || 'Not issued yet',
              copy: portalPasswordState === 'ready' && Boolean(portalPassword),
              mono: true,
              wide: true,
            },
            { group: 'School', label: 'Gender', value: viewingStudent?.gender },
            {
              group: 'School',
              label: 'Date of birth',
              value: viewingStudent?.date_of_birth
                ? String(viewingStudent.date_of_birth).slice(0, 10)
                : '',
            },
            { group: 'Family', label: 'Parent / guardian', value: viewingStudent?.parent_name },
            { group: 'Family', label: 'Relationship', value: viewingStudent?.parent_relationship },
            { group: 'Family', label: 'Parent phone', value: viewingStudent?.parent_phone },
            { group: 'Family', label: 'Parent email', value: viewingStudent?.parent_email },
            { group: 'Family', label: 'House address', value: viewingStudent?.house_address },
            {
              group: 'Fees',
              label: 'Extra charges',
              value: formatExtraFees(viewingStudent?.extra_fees || viewingStudent?.extraFees),
            },
          ]}
          onClose={() => setViewingStudent(null)}
          onEdit={() => handleEdit(viewingStudent)}
          onDelete={() => setPendingDelete(viewingStudent)}
          onDownload={async () => {
            await downloadStudentDetails(viewingStudent);
          }}
        />

        <ConfirmPersonDeleteModal
          open={Boolean(pendingDelete)}
          name={pendingDelete?.name}
          kind="student"
          onClose={() => setPendingDelete(null)}
          onDownload={() => downloadStudentDetails(pendingDelete)}
          onRemove={() => handleDelete(pendingDelete)}
        />

        {editingStudent && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
            <div className="bg-slate-800 border border-slate-600 rounded-xl p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto">
              <h2 className="text-xl font-bold text-white mb-4">Edit Student</h2>
              <form onSubmit={handleUpdate} className="space-y-4">
                <input
                  type="text"
                  value={editingStudent.name}
                  onChange={(e) => setEditingStudent({ ...editingStudent, name: e.target.value })}
                  className="w-full px-4 py-2 border border-slate-500 rounded-lg"
                  placeholder="Name"
                  required
                />
                <input
                  type="text"
                  value={editingStudent.class || ''}
                  onChange={(e) => setEditingStudent({ ...editingStudent, class: e.target.value })}
                  className="w-full px-4 py-2 border border-slate-500 rounded-lg"
                  placeholder="Class"
                  list="setup-classes"
                />
                <datalist id="setup-classes">
                  {classOptions.map((cls) => (
                    <option key={cls} value={cls} />
                  ))}
                </datalist>
                <select
                  value={editingStudent.gender || ''}
                  onChange={(e) => setEditingStudent({ ...editingStudent, gender: e.target.value })}
                  className="w-full px-4 py-2 border border-slate-500 rounded-lg"
                  required
                >
                  <option value="">Gender</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                </select>
                <input
                  type="date"
                  value={editingStudent.date_of_birth ? String(editingStudent.date_of_birth).slice(0, 10) : ''}
                  onChange={(e) => setEditingStudent({ ...editingStudent, date_of_birth: e.target.value })}
                  className="w-full px-4 py-2 border border-slate-500 rounded-lg"
                />
                <input
                  type="text"
                  value={editingStudent.parent_name || ''}
                  onChange={(e) => setEditingStudent({ ...editingStudent, parent_name: e.target.value })}
                  className="w-full px-4 py-2 border border-slate-500 rounded-lg"
                  placeholder="Parent / guardian name"
                />
                <select
                  value={editingStudent.parent_relationship || 'Parent'}
                  onChange={(e) =>
                    setEditingStudent({ ...editingStudent, parent_relationship: e.target.value })
                  }
                  className="w-full px-4 py-2 border border-slate-500 rounded-lg"
                >
                  <option value="Parent">Parent</option>
                  <option value="Mother">Mother</option>
                  <option value="Father">Father</option>
                  <option value="Guardian">Guardian</option>
                  <option value="Other">Other</option>
                </select>
                <input
                  type="tel"
                  value={editingStudent.parent_phone || ''}
                  onChange={(e) => setEditingStudent({ ...editingStudent, parent_phone: e.target.value })}
                  className="w-full px-4 py-2 border border-slate-500 rounded-lg"
                  placeholder="Parent phone"
                  required
                />
                <input
                  type="email"
                  value={editingStudent.parent_email || ''}
                  onChange={(e) => setEditingStudent({ ...editingStudent, parent_email: e.target.value })}
                  className="w-full px-4 py-2 border border-slate-500 rounded-lg"
                  placeholder="Parent Email"
                />
                <textarea
                  value={editingStudent.house_address || ''}
                  onChange={(e) => setEditingStudent({ ...editingStudent, house_address: e.target.value })}
                  className="w-full px-4 py-2 border border-slate-500 rounded-lg"
                  placeholder="House address"
                  rows={2}
                />
                <div className="rounded-lg border border-slate-600 p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-slate-200">Extra charges</p>
                    <button
                      type="button"
                      onClick={() =>
                        setEditingStudent({
                          ...editingStudent,
                          extraFees: [...(editingStudent.extraFees || []), emptyExtraFee()],
                        })
                      }
                      className="text-xs text-sky-300 hover:text-sky-200"
                    >
                      Add
                    </button>
                  </div>
                  {(editingStudent.extraFees || []).map((row, index) => (
                    <div key={`edit-extra-${index}`} className="mb-2 grid grid-cols-[1fr_auto] gap-2">
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={row.amount}
                        onChange={(e) => {
                          const extraFees = editingStudent.extraFees.map((item, i) =>
                            i === index ? { ...item, amount: e.target.value } : item
                          );
                          setEditingStudent({ ...editingStudent, extraFees });
                        }}
                        className="w-full px-2 py-2 border border-slate-500 rounded-lg"
                        placeholder="GHS"
                        aria-label="Extra charge amount"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setEditingStudent({
                            ...editingStudent,
                            extraFees: editingStudent.extraFees.filter((_, i) => i !== index),
                          })
                        }
                        className="text-xs text-rose-300"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                  {!(editingStudent.extraFees || []).length ? (
                    <p className="text-xs text-slate-500">No extra charge beyond the class fee.</p>
                  ) : null}
                </div>
                <input
                  type="text"
                  value={editingStudent.roll_number || 'Assigned on save'}
                  readOnly
                  className="w-full px-4 py-2 border border-slate-500 rounded-lg text-slate-300"
                  aria-label="Student ID"
                />
                <div className="rounded-lg border border-slate-600 p-3">
                  <p className="text-sm font-medium text-slate-200">Portal password</p>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <p className="font-mono text-lg tracking-[0.3em] text-white">
                      {portalPasswordState === 'loading' ? 'Loading…' : portalPassword || 'Not issued yet'}
                    </p>
                    {portalPasswordState === 'ready' && portalPassword ? (
                      <CopyMarkButton value={portalPassword} label="portal password" />
                    ) : null}
                  </div>
                  <div className="mt-3 flex gap-2">
                    <button type="button" onClick={replacePortalPassword} className="rounded-lg bg-slate-700 px-3 py-2 text-xs text-white">
                      New password
                    </button>
                    <button type="button" onClick={sendPortalPassword} className="rounded-lg bg-slate-700 px-3 py-2 text-xs text-white">
                      Text parent
                    </button>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button type="submit" className="flex-1 bg-primary-600 text-white py-2 rounded-lg hover:bg-primary-700">
                    Update
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingStudent(null)}
                    className="flex-1 bg-slate-600 text-slate-100 py-2 rounded-lg hover:bg-slate-500"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        <div id="list-section">
          <PersonRecordTable
            rows={students}
            compact
            onSelect={openStudent}
            columns={[
              { key: 'name', header: 'Student', width: '18%' },
              { key: 'class', header: 'Class', width: '10%' },
              { key: 'gender', header: 'Gender', width: '8%' },
              { key: 'roll_number', header: 'Student ID', width: '22%', truncate: false },
              { key: 'parent_name', header: 'Parent', width: '16%' },
              { key: 'parent_phone', header: 'Phone', width: '11%' },
              {
                key: 'extra_fees',
                header: 'Extra charges',
                width: '15%',
                className: 'text-right tabular-nums',
                render: (row) => formatExtraFeesAmount(row.extra_fees || row.extraFees) || '—',
              },
            ]}
          />
        </div>

        <PaginationBar page={page} total={total} limit={LIST_PAGE_SIZE} onPageChange={setPage} />

        {students.length === 0 && (
          <div className="rounded-2xl border border-dashed border-slate-600 bg-slate-800/50 py-16 text-center">
            <User className="mx-auto mb-3 h-12 w-12 text-slate-500" />
            <p className="text-slate-300">No students found.</p>
            <p className="mt-1 text-sm text-slate-400">Use Add student to enroll the first record.</p>
          </div>
        )}
      </div>
      {showAdd ? (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/90 p-4">
          <AddStudent
            onClose={() => {
              setShowAdd(false);
              fetchStudents({ force: true });
            }}
          />
        </div>
      ) : null}
</>
  );
};

export default Students;
