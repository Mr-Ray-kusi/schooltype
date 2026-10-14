import React, { useState, useEffect } from 'react';
import axios from 'axios';
import PhotoCaptureInput from '../components/PhotoCaptureInput';
import PersonRecordTable from '../components/PersonRecordTable';
import PersonDetailModal from '../components/PersonDetailModal';
import PaginationBar from '../components/PaginationBar';
import { buildPersonIdUrl } from '../utils/studentIdQr';
import { Search, Plus, User, Download } from 'lucide-react';
import toast from 'react-hot-toast';
import { invalidateCache, peekCache, staleGet } from '../utils/requestCache';
import { parseListResponse, fetchAllPages, fetchRecord, LIST_PAGE_SIZE } from '../utils/listApi.js';
import { downloadPersonPack, downloadPeoplePacks, nonStaffPack } from '../utils/personPackExport';

const NonStaff = ({ hideHeader = false }) => {
  const [nonStaff, setNonStaff] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [downloadingAll, setDownloadingAll] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [viewingPerson, setViewingPerson] = useState(null);
  const [editingNonStaff, setEditingNonStaff] = useState(null);
  const [photo, setPhoto] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [formData, setFormData] = useState({
    name: '',
    role: '',
  });

  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(searchTerm), 300);
    return () => clearTimeout(id);
  }, [searchTerm]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch]);

  useEffect(() => {
    fetchNonStaff();
  }, [page, debouncedSearch]);

  const fetchNonStaff = async () => {
    const cacheKey = `non-staff:${page}:${debouncedSearch}`;
    const apply = (data) => {
      const parsed = parseListResponse(data);
      setNonStaff(parsed.items);
      setTotal(parsed.total);
    };
    const cached = peekCache(cacheKey);
    if (cached) {
      apply(cached);
      setLoading(false);
    }
    try {
      const data = await staleGet(
        cacheKey,
        async () => {
          const response = await axios.get('/api/non-staff', {
            params: { page, limit: LIST_PAGE_SIZE, q: debouncedSearch || undefined },
          });
          return response.data;
        },
        45000,
        apply
      );
      apply(data);
    } catch (error) {
      console.error('Error fetching non-staff:', error);
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setFormData({ name: '', role: '' });
    setPhoto(null);
    setPhotoPreview(null);
    setEditingNonStaff(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const payload = { ...formData, photo };

      if (editingNonStaff) {
        await axios.put(`/api/non-staff/${editingNonStaff.id}`, payload);
        toast.success('Non-staff updated');
        setShowModal(false);
        resetForm();
        invalidateCache('non-staff');
        invalidateCache('dashboard');
        fetchNonStaff();
        return;
      }
      const { data } = await axios.post('/api/non-staff', payload);
      toast.success('Non-staff added — attendance QR code generated');
      setShowModal(false);
      resetForm();
      invalidateCache('non-staff');
      invalidateCache('dashboard');
      setNonStaff((prev) => [data, ...prev.filter((row) => row.id !== data.id)].slice(0, LIST_PAGE_SIZE));
      setTotal((current) => current + 1);
      setPage(1);
    } catch (error) {
      if (error.offlineQueued) {
        setShowModal(false);
        resetForm();
        return;
      }
      console.error('Error saving non-staff:', error);
      toast.error(error.response?.data?.error || 'Failed to save non-staff');
    }
  };

  const handleDelete = async (id) => {
    if (window.confirm('Are you sure you want to delete this person?')) {
      try {
        await axios.delete(`/api/non-staff/${id}`);
        invalidateCache('non-staff');
        invalidateCache('dashboard');
        fetchNonStaff();
      } catch (error) {
        console.error('Error deleting non-staff:', error);
      }
    }
  };

  const openPerson = async (person) => {
    setViewingPerson(person);
    const full = await fetchRecord(axios, `/api/non-staff/${person.id}`, person);
    setViewingPerson(full);
  };

  const handleEdit = (person) => {
    setViewingPerson(null);
    setEditingNonStaff(person);
    setFormData({
      name: person.name,
      role: person.role || '',
    });
    setPhoto(null);
    setPhotoPreview(person.photo_url || null);
    setShowModal(true);
  };

  const roles = ['Cleaner', 'Security Guard', 'Bus Driver', 'Cook', 'Maintenance', 'Gardener', 'Assistant'];

  if (loading && nonStaff.length === 0) {
    return (
      <>
        <div className="text-center py-12 text-slate-300">Loading...</div>
      </>
    );
  }

  return (
    <>
<div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold text-white">{hideHeader ? 'Non-staff' : 'Non-Staff Management'}</h1>
            <p className="mt-1 text-sm text-slate-400">{total} people</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={async () => {
                setDownloadingAll(true);
                try {
                  const all = await fetchAllPages(axios, '/api/non-staff', {
                    q: debouncedSearch || undefined,
                    includePhotos: 1,
                  });
                  await downloadPeoplePacks(
                    all.map((person) => nonStaffPack(person, buildPersonIdUrl(person.barcode))),
                    'all-non-staff.zip'
                  );
                } catch {
                  toast.error('Failed to download packs');
                } finally {
                  setDownloadingAll(false);
                }
              }}
              disabled={downloadingAll || total === 0}
              className="inline-flex items-center gap-2 rounded-lg bg-slate-700 px-3 py-2 text-sm text-white hover:bg-slate-600 disabled:opacity-50"
            >
              <Download className="h-4 w-4" />
              {downloadingAll ? 'Preparing…' : 'Download all'}
            </button>
            <button
              onClick={() => {
                resetForm();
                setShowModal(true);
              }}
              className="flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-white hover:bg-purple-700"
            >
              <Plus className="h-5 w-5" />
              Add Non-Staff
            </button>
          </div>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
          <input
            type="text"
            placeholder="Search by name or role..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-slate-500 rounded-lg focus:ring-2 focus:ring-purple-500 text-slate-50"
          />
        </div>

        <PersonDetailModal
          open={Boolean(viewingPerson)}
          name={viewingPerson?.name}
          badge={viewingPerson?.role || 'Support staff'}
          photoUrl={viewingPerson?.photo_url}
          accent="violet"
          fields={[{ group: 'Assignment', label: 'Role', value: viewingPerson?.role }]}
          onClose={() => setViewingPerson(null)}
          onEdit={() => handleEdit(viewingPerson)}
          onDelete={() => {
            setViewingPerson(null);
            handleDelete(viewingPerson.id);
          }}
          onDownload={async () => {
            const full = await fetchRecord(axios, `/api/non-staff/${viewingPerson.id}`, viewingPerson);
            downloadPersonPack(nonStaffPack(full, buildPersonIdUrl(full.barcode)));
          }}
        />

        <div id="list-section">
          <PersonRecordTable
            rows={nonStaff}
            minWidth="480px"
            compact
            onSelect={openPerson}
            columns={[
              { key: 'name', header: 'Name' },
              { key: 'role', header: 'Role' },
            ]}
          />
        </div>
        <PaginationBar page={page} total={total} limit={LIST_PAGE_SIZE} onPageChange={setPage} />

        {nonStaff.length === 0 && (
          <div className="rounded-2xl border border-dashed border-slate-600 bg-slate-800/50 py-16 text-center">
            <User className="mx-auto mb-3 h-12 w-12 text-slate-500" />
            <p className="text-slate-300">No non-staff members found.</p>
          </div>
        )}

        {showModal && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
            <div className="bg-slate-800 border border-slate-600 rounded-xl p-6 max-w-md w-full max-h-[90vh] overflow-y-auto">
              <h2 className="text-xl font-bold text-white mb-4">
                {editingNonStaff ? 'Edit Non-Staff' : 'Add New Non-Staff'}
              </h2>
              <form onSubmit={handleSubmit} className="space-y-4">
                <PhotoCaptureInput
                  preview={photoPreview}
                  onChange={(dataUrl) => {
                    setPhoto(dataUrl);
                    setPhotoPreview(dataUrl);
                  }}
                  onClear={() => {
                    setPhoto(null);
                    setPhotoPreview(null);
                  }}
                  label="Profile Photo"
                />

                <div>
                  <label className="block text-sm font-medium text-slate-200 mb-2">Full Name *</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-4 py-2 border border-slate-500 rounded-lg text-slate-50"
                    required
                    placeholder="e.g., Jane Smith"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-200 mb-2">Role *</label>
                  <select
                    value={formData.role}
                    onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                    className="w-full px-4 py-2 border border-slate-500 rounded-lg text-slate-50"
                    required
                  >
                    <option value="">Select a role</option>
                    {roles.map((role) => (
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
                      setShowModal(false);
                      resetForm();
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

export default NonStaff;
