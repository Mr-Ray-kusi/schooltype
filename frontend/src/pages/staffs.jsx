import React, { useState, useEffect } from 'react';
import axios from 'axios';
import PersonRecordTable from '../components/PersonRecordTable';
import PersonDetailModal from '../components/PersonDetailModal';
import ConfirmPersonDeleteModal from '../components/ConfirmPersonDeleteModal';
import PaginationBar from '../components/PaginationBar';
import { buildPersonIdUrl } from '../utils/studentIdQr';
import { useAuth } from '../contexts/authcontext';
import {
  Search,
  Plus,
  User,
  Link2,
  Copy,
  RefreshCw,
  Download,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { forceGet, invalidateCache, peekCache, staleGet } from '../utils/requestCache';
import { fetchRecord, parseListResponse, LIST_PAGE_SIZE } from '../utils/listApi.js';
import { downloadPersonPack, downloadPeoplePacks, staffPack, nonStaffPack } from '../utils/personPackExport';
import { buildTermAttendancePdfBytes } from '../utils/attendanceTermPdf';
import { generateStrongPassword } from '../utils/strongPassword';
import MultiSelectDropdown from '../components/MultiSelectDropdown';

const NON_STAFF_ROLES = ['Cleaner', 'Security Guard', 'Bus Driver', 'Cook', 'Maintenance', 'Gardener', 'Assistant'];
const STAFF_ROLES = ['Administrator', 'Teacher', 'Accountant'];

const parseCsvList = (value) => {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }
  return String(value || '')
    .split(/[,;\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
};

const asStaffRow = (item) => ({
  ...item,
  kind: 'staff',
  secretCode: item.secretCode || item.secret_code || null,
  subjects: item.subjects || '',
  classNames: item.classNames || item.class_names || '',
});

const asNonStaffRow = (item) => ({
  ...item,
  kind: 'non-staff',
});

const Staff = () => {
  const { includesPlanFeature, school } = useAuth();
  const canStaff = includesPlanFeature('staff');
  const canNonStaff = includesPlanFeature('non-staff');
  const [people, setPeople] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [downloadingAll, setDownloadingAll] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showStaffModal, setShowStaffModal] = useState(false);
  const [showNonStaffModal, setShowNonStaffModal] = useState(false);
  const [viewingPerson, setViewingPerson] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [editingStaff, setEditingStaff] = useState(null);
  const [editingNonStaff, setEditingNonStaff] = useState(null);
  const [portalToken, setPortalToken] = useState(null);
  const [portalPath, setPortalPath] = useState('');
  const [portalLoading, setPortalLoading] = useState(true);
  const [staffForm, setStaffForm] = useState({
    name: '',
    role: '',
    secretCode: '',
    subjects: [],
    classNames: [],
  });
  const [nonStaffForm, setNonStaffForm] = useState({
    name: '',
    role: '',
  });
  const [peopleFilter, setPeopleFilter] = useState(canStaff ? 'staff' : 'non-staff');
  const [setupSubjects, setSetupSubjects] = useState([]);
  const [setupClasses, setSetupClasses] = useState([]);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(searchTerm), 300);
    return () => clearTimeout(id);
  }, [searchTerm]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, peopleFilter]);

  useEffect(() => {
    fetchPortalLink();
    fetchSetupOptions();
  }, []);

  useEffect(() => {
    fetchPeople();
  }, [page, debouncedSearch, canStaff, canNonStaff, peopleFilter]);

  const portalUrl = portalPath
    ? `${window.location.origin}${portalPath}`
    : portalToken
      ? `${window.location.origin}/staff-portal/${portalToken}`
      : '';

  const fetchPortalLink = async () => {
    if (!canStaff) {
      setPortalLoading(false);
      return;
    }
    try {
      const response = await axios.get('/api/staff-portal/link');
      setPortalToken(response.data.token);
      setPortalPath(response.data.portalPath || '');
    } catch (error) {
      console.error('Failed to load staff portal link:', error);
    } finally {
      setPortalLoading(false);
    }
  };

  const fetchSetupOptions = async () => {
    try {
      const [subjectRes, classRes] = await Promise.all([
        axios.get('/api/subjects'),
        axios.get('/api/classes'),
      ]);
      setSetupSubjects(
        (Array.isArray(subjectRes.data) ? subjectRes.data : [])
          .map((item) => item.name)
          .filter(Boolean)
      );
      setSetupClasses(
        (Array.isArray(classRes.data) ? classRes.data : [])
          .map((item) => item.name)
          .filter(Boolean)
      );
    } catch (error) {
      console.error('Failed to load setup subjects/classes:', error);
    }
  };

  const fetchPeople = async ({ force = false } = {}) => {
    const cacheKey = `staff-combined:${peopleFilter}:${page}:${debouncedSearch}`;
    const apply = (payload) => {
      const parsed = Array.isArray(payload)
        ? { items: payload, total: payload.length }
        : parseListResponse(payload);
      setPeople(parsed.items);
      setTotal(parsed.total);
    };
    const cached = force ? null : peekCache(cacheKey);
    if (cached) {
      apply(cached);
      setLoading(false);
    }
    try {
      const fetcher = async () => {
          const wantStaff = canStaff && peopleFilter !== 'non-staff';
          const wantNonStaff = canNonStaff && peopleFilter !== 'staff';
          const params = { page, limit: LIST_PAGE_SIZE, q: debouncedSearch || undefined };
          const [staffRes, nonStaffRes] = await Promise.all([
            wantStaff ? axios.get('/api/staff', { params }) : Promise.resolve(null),
            wantNonStaff ? axios.get('/api/non-staff', { params }) : Promise.resolve(null),
          ]);
          const staffParsed = staffRes ? parseListResponse(staffRes.data) : { items: [], total: 0 };
          const nonParsed = nonStaffRes ? parseListResponse(nonStaffRes.data) : { items: [], total: 0 };
          if (wantStaff && wantNonStaff) {
            return {
              items: [
                ...staffParsed.items.map(asStaffRow),
                ...nonParsed.items.map(asNonStaffRow),
              ].slice(0, LIST_PAGE_SIZE),
              total: staffParsed.total + nonParsed.total,
              page,
              limit: LIST_PAGE_SIZE,
            };
          }
          if (wantNonStaff) {
            return {
              items: nonParsed.items.map(asNonStaffRow),
              total: nonParsed.total,
              page,
              limit: LIST_PAGE_SIZE,
            };
          }
          return {
            items: staffParsed.items.map(asStaffRow),
            total: staffParsed.total,
            page,
            limit: LIST_PAGE_SIZE,
          };
      };
      const data = force
        ? await forceGet(cacheKey, fetcher)
        : await staleGet(cacheKey, fetcher, 45000, apply);
      apply(data);
    } catch (error) {
      console.error('Error fetching staff:', error);
    } finally {
      setLoading(false);
    }
  };

  const generateSecretCode = () => generateStrongPassword(16);

  const resetStaffForm = () => {
    setStaffForm({
      name: '',
      role: '',
      secretCode: generateStrongPassword(16),
      subjects: [],
      classNames: [],
    });
    setEditingStaff(null);
  };

  const resetNonStaffForm = () => {
    setNonStaffForm({ name: '', role: '' });
    setEditingNonStaff(null);
  };

  const handleStaffSubmit = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        ...staffForm,
        subjects: staffForm.subjects.join(', '),
        classNames: staffForm.classNames.join(', '),
        secretCode: staffForm.secretCode || generateSecretCode(),
      };

      if (editingStaff) {
        await axios.put(`/api/staff/${editingStaff.id}`, payload);
        toast.success('Staff updated');
        setShowStaffModal(false);
        resetStaffForm();
        invalidateCache('staff');
        invalidateCache('dashboard');
        fetchPeople();
        return;
      }
      const { data } = await axios.post('/api/staff', payload);
      toast.success('Staff added — attendance QR code generated');
      setShowStaffModal(false);
      resetStaffForm();
      invalidateCache('staff');
      invalidateCache('dashboard');
      setPeople((prev) => [asStaffRow(data), ...prev.filter((row) => row.id !== data.id)].slice(0, LIST_PAGE_SIZE));
      setTotal((current) => current + 1);
      setPage(1);
    } catch (error) {
      if (error.offlineQueued) {
        setShowStaffModal(false);
        resetStaffForm();
        return;
      }
      console.error('Error saving staff:', error);
      toast.error(error.response?.data?.error || 'Failed to save staff');
    }
  };

  const handleNonStaffSubmit = async (e) => {
    e.preventDefault();
    try {
      const payload = { ...nonStaffForm };
      if (editingNonStaff) {
        await axios.put(`/api/non-staff/${editingNonStaff.id}`, payload);
        toast.success('Non-staff updated');
        setShowNonStaffModal(false);
        resetNonStaffForm();
        invalidateCache('non-staff');
        invalidateCache('staff');
        invalidateCache('dashboard');
        fetchPeople();
        return;
      }
      const { data } = await axios.post('/api/non-staff', payload);
      toast.success('Non-staff added — attendance QR code generated');
      setShowNonStaffModal(false);
      resetNonStaffForm();
      invalidateCache('non-staff');
      invalidateCache('staff');
      invalidateCache('dashboard');
      setPeople((prev) => [asNonStaffRow(data), ...prev.filter((row) => row.id !== data.id)].slice(0, LIST_PAGE_SIZE));
      setTotal((current) => current + 1);
      setPage(1);
      } catch (error) {
      if (error.offlineQueued) {
        setShowNonStaffModal(false);
        resetNonStaffForm();
        return;
      }
      console.error('Error saving non-staff:', error);
      toast.error(error.response?.data?.error || 'Failed to save non-staff');
    }
  };

  const downloadPersonDetails = async (person) => {
    const isStaff = person.kind === 'staff';
    const url = isStaff ? `/api/staff/${person.id}` : `/api/non-staff/${person.id}`;
    const full = await fetchRecord(axios, url, person);
    const pack = isStaff
      ? staffPack(asStaffRow(full), buildPersonIdUrl(full.barcode))
      : nonStaffPack(full, buildPersonIdUrl(full.barcode));
    try {
      const { data } = await axios.get(`/api/attendance/person/${person.id}`, {
        params: { userType: isStaff ? 'staff' : 'non-staff' },
      });
      const built = buildTermAttendancePdfBytes({
        schoolName: school?.name || 'School',
        personName: full.name || person.name,
        personLabel: full.role || person.role,
        userType: isStaff ? 'staff' : 'non-staff',
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

  const handleDelete = async (person) => {
    const isStaff = person.kind === 'staff';
    try {
      if (isStaff) {
        await axios.delete(`/api/staff/${person.id}`);
        invalidateCache('staff');
      } else {
        await axios.delete(`/api/non-staff/${person.id}`);
        invalidateCache('non-staff');
        invalidateCache('staff');
      }
      invalidateCache('dashboard');
      invalidateCache('attendance');
      toast.success(
        isStaff ? 'Staff member and related records removed' : 'Non-staff member and related records removed'
      );
      setPendingDelete(null);
      setViewingPerson(null);
      fetchPeople();
    } catch (error) {
      toast.error(error.response?.data?.error || 'Could not delete this person');
    }
  };

  const openPerson = async (person) => {
    setViewingPerson(person);
    const url = person.kind === 'staff' ? `/api/staff/${person.id}` : `/api/non-staff/${person.id}`;
    const full = await fetchRecord(axios, url, person);
    setViewingPerson(
      person.kind === 'staff' ? asStaffRow({ ...person, ...full }) : asNonStaffRow({ ...person, ...full })
    );
  };

  const handleEdit = (person) => {
    setViewingPerson(null);
    if (person.kind === 'staff') {
      fetchSetupOptions();
      setEditingStaff(person);
      setStaffForm({
        name: person.name,
        role: person.role || '',
        secretCode: person.secretCode || person.secret_code || generateSecretCode(),
        subjects: parseCsvList(person.subjects),
        classNames: parseCsvList(person.classNames || person.class_names),
      });
      setShowStaffModal(true);
      return;
    }
    setEditingNonStaff(person);
    setNonStaffForm({
      name: person.name,
      role: person.role || '',
    });
    setShowNonStaffModal(true);
  };

  const copyPortalLink = async () => {
    if (!portalUrl) return;
    try {
      await navigator.clipboard.writeText(portalUrl);
      toast.success('Staff portal link copied');
    } catch {
      toast.error('Could not copy link');
    }
  };

  const regeneratePortalLink = async () => {
    const confirmed = window.confirm(
      'Create a new staff portal link? The current link will stop working until you share the new one.'
    );
    if (!confirmed) return;
    try {
      const response = await axios.post('/api/staff-portal/regenerate');
      setPortalToken(response.data.token);
      setPortalPath(response.data.portalPath || '');
      toast.success('New staff portal link generated');
    } catch {
      toast.error('Failed to regenerate link');
    }
  };

  const filteredPeople = people;
  const viewingStaff = viewingPerson?.kind === 'staff' ? viewingPerson : null;
  const staffRoleOptions =
    staffForm.role && !STAFF_ROLES.includes(staffForm.role)
      ? [staffForm.role, ...STAFF_ROLES]
      : STAFF_ROLES;
  const showPeopleFilter = canStaff && canNonStaff;

  if (loading && people.length === 0) {
    return (
      <>
<div className="text-center py-12 text-slate-300">Loading staff...</div>
</>
    );
  }

  return (
    <>
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold text-white">Staff</h1>
            <p className="mt-1 text-sm text-slate-400">{total} people</p>
            {showPeopleFilter && (
              <div className="mt-3 inline-flex rounded-full border border-slate-600 bg-slate-900 p-1">
                {[
                  { id: 'all', label: 'All' },
                  { id: 'staff', label: 'Staff' },
                  { id: 'non-staff', label: 'Non-staff' },
                ].map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setPeopleFilter(option.id)}
                    className={`rounded-full px-4 py-1.5 text-sm font-medium ${
                      peopleFilter === option.id
                        ? 'bg-primary-600 text-white'
                        : 'text-slate-300 hover:text-white'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="flex w-full min-w-0 flex-nowrap items-center gap-1.5 md:w-auto md:flex-wrap md:gap-2">
            <button
              type="button"
              disabled={refreshing}
              onClick={async () => {
                setRefreshing(true);
                invalidateCache('staff');
                invalidateCache('non-staff');
                try {
                  await fetchPeople({ force: true });
                } finally {
                  setRefreshing(false);
                }
              }}
              className="inline-flex min-w-0 shrink items-center justify-center gap-1 rounded-lg border border-slate-500 px-2 py-2 text-[11px] text-slate-100 hover:bg-slate-800 disabled:opacity-70 md:px-3 md:text-sm"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <button
              type="button"
              onClick={async () => {
                setDownloadingAll(true);
                try {
                  const packs = filteredPeople.map((person) =>
                    person.kind === 'staff'
                      ? staffPack(person, buildPersonIdUrl(person.barcode))
                      : nonStaffPack(person, buildPersonIdUrl(person.barcode))
                  );
                  await downloadPeoplePacks(packs, 'all-staff.zip');
                } catch {
                  toast.error('Failed to download staff packs');
                } finally {
                  setDownloadingAll(false);
                }
              }}
              disabled={downloadingAll || total === 0}
              className="inline-flex min-w-0 shrink items-center justify-center gap-1 whitespace-nowrap rounded-lg bg-slate-700 px-2 py-2 text-[11px] text-white hover:bg-slate-600 disabled:opacity-50 md:gap-2 md:px-3 md:text-sm"
            >
              <Download className="h-3.5 w-3.5 shrink-0 md:h-4 md:w-4" />
              {downloadingAll ? 'Preparing…' : 'Download all'}
            </button>
            {canStaff && (
              <button
                onClick={() => {
                  resetStaffForm();
                  fetchSetupOptions();
                  setShowStaffModal(true);
                }}
                className="inline-flex min-w-0 shrink items-center justify-center gap-1 whitespace-nowrap rounded-lg bg-primary-600 px-2 py-2 text-[11px] font-medium text-white transition-colors hover:bg-primary-700 md:gap-2 md:px-4 md:text-sm"
              >
                <Plus className="hidden h-5 w-5 md:block" />
                <span className="md:hidden">+staff</span>
                <span className="hidden md:inline">Add Staff</span>
              </button>
            )}
            {canNonStaff && (
          <button
            onClick={() => {
                  resetNonStaffForm();
                  setShowNonStaffModal(true);
            }}
                className="inline-flex min-w-0 shrink items-center justify-center gap-1 whitespace-nowrap rounded-lg bg-purple-600 px-2 py-2 text-[11px] font-medium text-white hover:bg-purple-700 md:gap-2 md:px-4 md:text-sm"
          >
                <Plus className="hidden h-5 w-5 md:block" />
                <span className="md:hidden">+ non-staff</span>
                <span className="hidden md:inline">Add Non-staff</span>
          </button>
            )}
          </div>
        </div>

        {canStaff && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-600 bg-slate-800/80 px-3 py-2">
            <Link2 className="h-4 w-4 shrink-0 text-sky-400" />
            <p className="min-w-0 flex-1 truncate text-xs text-sky-200">
              {portalLoading ? 'Loading portal link…' : portalUrl || 'Could not load portal link'}
            </p>
              <button
                type="button"
                onClick={copyPortalLink}
                disabled={!portalUrl}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-500 px-2 py-1 text-xs text-slate-100 hover:bg-slate-700 disabled:opacity-50"
              >
                <Copy className="h-3.5 w-3.5" />
                Copy
              </button>
              <button
                type="button"
                onClick={regeneratePortalLink}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-500 px-2 py-1 text-xs text-slate-100 hover:bg-slate-700"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${portalLoading ? 'animate-spin' : ''}`} />
              New
              </button>
          </div>
        )}

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
          <input
            type="text"
            placeholder="Search by name or role..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-slate-500 rounded-lg focus:ring-2 focus:ring-primary-500 text-slate-50"
          />
        </div>

        <PersonDetailModal
          open={Boolean(viewingPerson)}
          name={viewingPerson?.name}
          badge={viewingPerson?.role || (viewingStaff ? 'Staff' : 'Non-staff')}
          accent={viewingStaff ? 'emerald' : 'violet'}
          fields={
            viewingStaff
              ? [
                  { group: 'Assignment', label: 'Type', value: 'Staff' },
                  { group: 'Assignment', label: 'Role', value: viewingStaff.role },
                  { group: 'Assignment', label: 'Subjects', value: viewingStaff.subjects },
                  {
                    group: 'Assignment',
                    label: 'Classes',
                    value: viewingStaff.classNames || viewingStaff.class_names,
                  },
                  {
                    group: 'Access',
                    label: 'Access code',
                    value: viewingStaff.secretCode || viewingStaff.secret_code,
                    copy: true,
                  },
                ]
              : [
                  { group: 'Assignment', label: 'Type', value: 'Non-staff' },
                  { group: 'Assignment', label: 'Role', value: viewingPerson?.role },
                ]
          }
          onClose={() => setViewingPerson(null)}
          onEdit={() => handleEdit(viewingPerson)}
          onDelete={() => setPendingDelete(viewingPerson)}
          onDownload={async () => {
            if (!viewingPerson) return;
            await downloadPersonDetails(viewingPerson);
          }}
        />

        <ConfirmPersonDeleteModal
          open={Boolean(pendingDelete)}
          name={pendingDelete?.name}
          kind={pendingDelete?.kind === 'staff' ? 'staff' : 'non-staff'}
          onClose={() => setPendingDelete(null)}
          onDownload={() => downloadPersonDetails(pendingDelete)}
          onRemove={() => handleDelete(pendingDelete)}
        />

        <div id="list-section">
          <PersonRecordTable
            rows={people}
            minWidth="520px"
            compact
            onSelect={openPerson}
            columns={[
              { key: 'name', header: 'Name' },
              {
                key: 'kind',
                header: 'Type',
                render: (row) => (row.kind === 'staff' ? 'Staff' : 'Non-staff'),
              },
              { key: 'role', header: 'Role' },
            ]}
          />
        </div>

        <PaginationBar page={page} total={total} limit={LIST_PAGE_SIZE} onPageChange={setPage} />

        {filteredPeople.length === 0 && (
          <div className="rounded-2xl border border-dashed border-slate-600 bg-slate-800/50 py-16 text-center">
            <User className="mx-auto mb-3 h-12 w-12 text-slate-500" />
            <p className="text-slate-300">
              {peopleFilter === 'non-staff' ? 'No non-staff found.' : 'No staff found.'}
            </p>
          </div>
        )}

        {showStaffModal && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
            <div className="bg-slate-800 border border-slate-600 rounded-xl p-6 max-w-md w-full max-h-[90vh] overflow-y-auto">
              <h2 className="text-xl font-bold text-white mb-4">
                {editingStaff ? 'Edit Staff' : 'Add New Staff'}
              </h2>
              <form onSubmit={handleStaffSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-200 mb-2">Full Name *</label>
                  <input
                    type="text"
                    value={staffForm.name}
                    onChange={(e) => setStaffForm({ ...staffForm, name: e.target.value })}
                    className="w-full px-4 py-2 border border-slate-500 rounded-lg text-slate-50"
                    required
                    placeholder="e.g., John Doe"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-200 mb-2">Role *</label>
                  <select
                    value={staffForm.role}
                    onChange={(e) => setStaffForm({ ...staffForm, role: e.target.value })}
                    className="w-full px-4 py-2 border border-slate-500 rounded-lg text-slate-50"
                    required
                  >
                    <option value="">Select a role</option>
                    {staffRoleOptions.map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-200">Access Code</label>
                  <div className="flex gap-2">
                  <input
                    type="text"
                      value={staffForm.secretCode}
                      readOnly
                      className="w-full rounded-lg border border-slate-500 bg-slate-700 px-4 py-2 font-mono text-slate-50"
                    />
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(staffForm.secretCode || '');
                          toast.success('Access code copied');
                        } catch {
                          toast.error('Could not copy access code');
                        }
                      }}
                      className="shrink-0 rounded-lg border border-slate-500 px-3 py-2 text-slate-200 hover:bg-slate-700"
                      aria-label="Copy access code"
                      title="Copy access code"
                    >
                      <Copy className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setStaffForm({ ...staffForm, secretCode: generateStrongPassword(16) })}
                      className="shrink-0 rounded-lg border border-slate-500 px-3 py-2 text-xs text-slate-200 hover:bg-slate-700"
                    >
                      New
                    </button>
                  </div>
                  <p className="mt-2 text-xs text-slate-400">
                    Automatically generated strong password. Share this with the staff member for portal login.
                  </p>
                </div>

                {staffForm.role === 'Teacher' && (
                  <>
                    <MultiSelectDropdown
                      label="Subjects taught"
                      options={setupSubjects}
                      selected={staffForm.subjects}
                      onChange={(subjects) => setStaffForm({ ...staffForm, subjects })}
                      placeholder="Add a subject"
                      emptyHint="Add subjects in Setup first."
                    />
                    <MultiSelectDropdown
                      label="Classes assigned"
                      options={setupClasses}
                      selected={staffForm.classNames}
                      onChange={(classNames) => setStaffForm({ ...staffForm, classNames })}
                      placeholder="Add a class"
                      emptyHint="Add classes in Setup first."
                    />
                  </>
                )}

                {!editingStaff && (
                  <p className="text-xs text-slate-400 bg-slate-900/50 border border-slate-600 rounded-lg p-3">
                    A unique attendance QR code is generated automatically when you save.
                  </p>
                )}

                <div className="flex gap-2 pt-2">
                  <button
                    type="submit"
                    className="flex-1 bg-primary-600 text-white py-2 rounded-lg hover:bg-primary-700"
                  >
                    {editingStaff ? 'Update' : 'Add'} Staff
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowStaffModal(false);
                      resetStaffForm();
                    }}
                    className="flex-1 bg-slate-600 text-slate-100 py-2 rounded-lg hover:bg-slate-500"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {showNonStaffModal && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
            <div className="bg-slate-800 border border-slate-600 rounded-xl p-6 max-w-md w-full max-h-[90vh] overflow-y-auto">
              <h2 className="text-xl font-bold text-white mb-4">
                {editingNonStaff ? 'Edit Non-staff' : 'Add Non-staff'}
              </h2>
              <form onSubmit={handleNonStaffSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-200 mb-2">Full Name *</label>
                  <input
                    type="text"
                    value={nonStaffForm.name}
                    onChange={(e) => setNonStaffForm({ ...nonStaffForm, name: e.target.value })}
                    className="w-full px-4 py-2 border border-slate-500 rounded-lg text-slate-50"
                    required
                    placeholder="e.g., Jane Smith"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-200 mb-2">Role *</label>
                  <select
                    value={nonStaffForm.role}
                    onChange={(e) => setNonStaffForm({ ...nonStaffForm, role: e.target.value })}
                    className="w-full px-4 py-2 border border-slate-500 rounded-lg text-slate-50"
                    required
                  >
                    <option value="">Select a role</option>
                    {NON_STAFF_ROLES.map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </select>
                </div>

                {!editingNonStaff && (
                  <p className="text-xs text-slate-400 bg-slate-900/50 border border-slate-600 rounded-lg p-3">
                    A unique attendance QR code is generated automatically when you save.
                  </p>
                )}

                <div className="flex gap-2 pt-2">
                  <button
                    type="submit"
                    className="flex-1 bg-purple-600 text-white py-2 rounded-lg hover:bg-purple-700"
                  >
                    {editingNonStaff ? 'Update' : 'Add'} Person
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowNonStaffModal(false);
                      resetNonStaffForm();
                    }}
                    className="flex-1 bg-slate-600 text-slate-100 py-2 rounded-lg hover:bg-slate-500"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
</>
  );
};

export default Staff;
