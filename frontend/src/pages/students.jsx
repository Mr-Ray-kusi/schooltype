import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import axios from 'axios';
import { buildStudentIdUrl } from '../utils/studentIdQr';
import { invalidateCache, peekCache, staleGet } from '../utils/requestCache';
import { parseListResponse, fetchAllPages, fetchRecord, LIST_PAGE_SIZE } from '../utils/listApi.js';
import { downloadPersonPack, downloadPeoplePacks, studentPack } from '../utils/personPackExport';
import PersonRecordTable from '../components/PersonRecordTable';
import PersonDetailModal from '../components/PersonDetailModal';
import PaginationBar from '../components/PaginationBar';
import { Search, User, Download } from 'lucide-react';
import toast from 'react-hot-toast';

const Students = () => {
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
  const [downloadingAll, setDownloadingAll] = useState(false);

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

  const fetchStudents = async () => {
    const cacheKey = `students:${page}:${debouncedSearch}:${selectedClass}`;
    const apply = (data) => {
      const parsed = parseListResponse(data);
      setStudents(parsed.items);
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
          const response = await axios.get('/api/students', {
            params: {
              page,
              limit: LIST_PAGE_SIZE,
              q: debouncedSearch || undefined,
              class: selectedClass !== 'all' ? selectedClass : undefined,
            },
          });
          return response.data;
        },
        45000,
        apply
      );
      apply(data);
    } catch (error) {
      console.error('Error fetching students:', error);
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

  const handleDelete = async (id) => {
    if (window.confirm('Are you sure you want to delete this student?')) {
      try {
        await axios.delete(`/api/students/${id}`);
        invalidateCache('students');
        invalidateCache('dashboard');
        fetchStudents();
      } catch (error) {
        console.error('Error deleting student:', error);
      }
    }
  };

  const handleEdit = (student) => {
    setViewingStudent(null);
    setEditingStudent(student);
  };

  const openStudent = async (student) => {
    setViewingStudent(student);
    const full = await fetchRecord(axios, `/api/students/${student.id}`, student);
    setViewingStudent(full);
  };

  const handleUpdate = async (e) => {
    e.preventDefault();
    try {
      await axios.put(`/api/students/${editingStudent.id}`, {
        name: editingStudent.name,
        class: editingStudent.class,
        parentName: editingStudent.parent_name,
        parentRelationship: editingStudent.parent_relationship,
        parentEmail: editingStudent.parent_email,
        parentPhone: editingStudent.parent_phone,
        houseAddress: editingStudent.house_address,
        dateOfBirth: editingStudent.date_of_birth,
        rollNumber: editingStudent.roll_number,
        skills: editingStudent.skills,
      });
      invalidateCache('students');
      invalidateCache('dashboard');
      setEditingStudent(null);
      fetchStudents();
    } catch (error) {
      console.error('Error updating student:', error);
    }
  };

  const handleDownloadAll = async () => {
    setDownloadingAll(true);
    try {
      const all = await fetchAllPages(axios, '/api/students', {
        q: debouncedSearch || undefined,
        class: selectedClass !== 'all' ? selectedClass : undefined,
        includePhotos: 1,
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
<div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold text-white">Students</h1>
            <p className="mt-1 text-slate-300">{total} student{total !== 1 ? 's' : ''} enrolled</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search students..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="min-w-[200px] rounded-lg border border-slate-500 py-2 pl-10 pr-4 focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <select
              value={selectedClass}
              onChange={(e) => setSelectedClass(e.target.value)}
              className="rounded-lg border border-slate-500 px-4 py-2 focus:ring-2 focus:ring-primary-500"
            >
              <option value="all">All Classes</option>
              {classOptions.map((cls) => (
                <option key={cls} value={cls}>{cls}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleDownloadAll}
              disabled={downloadingAll || total === 0}
              className="inline-flex items-center gap-2 rounded-lg bg-slate-700 px-3 py-2 text-sm text-white hover:bg-slate-600 disabled:opacity-50"
            >
              <Download className="h-4 w-4" />
              {downloadingAll ? 'Preparing…' : 'Download all'}
            </button>
          </div>
        </div>

        <PersonDetailModal
          open={Boolean(viewingStudent)}
          name={viewingStudent?.name}
          badge={viewingStudent?.class || 'No class'}
          photoUrl={viewingStudent?.photo_url}
          accent="sky"
          fields={[
            { group: 'School', label: 'Roll number', value: viewingStudent?.roll_number },
            {
              group: 'School',
              label: 'Date of birth',
              value: viewingStudent?.date_of_birth
                ? String(viewingStudent.date_of_birth).slice(0, 10)
                : '',
            },
            { group: 'School', label: 'Skills', value: viewingStudent?.skills },
            { group: 'Family', label: 'Parent / guardian', value: viewingStudent?.parent_name },
            { group: 'Family', label: 'Relationship', value: viewingStudent?.parent_relationship },
            { group: 'Family', label: 'Parent phone', value: viewingStudent?.parent_phone },
            { group: 'Family', label: 'Parent email', value: viewingStudent?.parent_email },
            { group: 'Family', label: 'House address', value: viewingStudent?.house_address },
          ]}
          onClose={() => setViewingStudent(null)}
          onEdit={() => handleEdit(viewingStudent)}
          onDelete={() => {
            setViewingStudent(null);
            handleDelete(viewingStudent.id);
          }}
          onDownload={async () => {
            const full = await fetchRecord(axios, `/api/students/${viewingStudent.id}`, viewingStudent);
            downloadPersonPack(studentPack(full, buildStudentIdUrl(full.barcode)));
          }}
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
                <input
                  type="text"
                  value={editingStudent.roll_number || ''}
                  onChange={(e) => setEditingStudent({ ...editingStudent, roll_number: e.target.value })}
                  className="w-full px-4 py-2 border border-slate-500 rounded-lg"
                  placeholder="Roll Number"
                />
                <input
                  type="text"
                  value={editingStudent.skills || ''}
                  onChange={(e) => setEditingStudent({ ...editingStudent, skills: e.target.value })}
                  className="w-full px-4 py-2 border border-slate-500 rounded-lg"
                  placeholder="Skills (e.g. Football, Athletics)"
                />
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
              { key: 'name', header: 'Student' },
              { key: 'class', header: 'Class' },
              { key: 'roll_number', header: 'Roll' },
              { key: 'parent_name', header: 'Parent' },
              { key: 'parent_phone', header: 'Phone' },
            ]}
          />
        </div>

        <PaginationBar page={page} total={total} limit={LIST_PAGE_SIZE} onPageChange={setPage} />

        {students.length === 0 && (
          <div className="rounded-2xl border border-dashed border-slate-600 bg-slate-800/50 py-16 text-center">
            <User className="mx-auto mb-3 h-12 w-12 text-slate-500" />
            <p className="text-slate-300">No students found.</p>
            <p className="mt-1 text-sm text-slate-400">Add your first student from the Add Student page.</p>
          </div>
        )}
      </div>
</>
  );
};

export default Students;
