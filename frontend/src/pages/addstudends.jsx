import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useNavigate, Link } from 'react-router-dom';
import {
  UserPlus,
  GraduationCap,
  Mail,
  Phone,
  MapPin,
  Calendar,
  ArrowLeft,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { invalidateCache } from '../utils/requestCache';

const fieldClass =
  'w-full rounded-xl border border-slate-600/80 bg-slate-950/60 px-4 py-3 text-sm text-white placeholder:text-slate-500 outline-none transition focus:border-sky-500/60 focus:ring-2 focus:ring-sky-500/30';

const AddStudent = ({ onClose } = {}) => {
  const navigate = useNavigate();
  const finish = () => {
    if (onClose) onClose();
    else navigate('/students');
  };
  const [loading, setLoading] = useState(false);
  const [schoolClasses, setSchoolClasses] = useState([]);
  const [formData, setFormData] = useState({
    name: '',
    class: '',
    parentName: '',
    parentRelationship: 'Parent',
    parentEmail: '',
    parentPhone: '',
    houseAddress: '',
    dateOfBirth: '',
    gender: '',
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.parentName.trim()) {
      toast.error('Parent / guardian name is required');
      return;
    }
    if (!formData.parentPhone.trim()) {
      toast.error('Parent phone number is required for SMS');
      return;
    }
    if (!formData.gender) {
      toast.error('Student gender is required');
      return;
    }
    setLoading(true);

    try {
      const { data } = await axios.post('/api/students', formData);
      invalidateCache('students');
      invalidateCache('dashboard');
      if (data?.warning) {
        toast.error(data.warning);
      } else {
        toast.success(data?.roll_number ? `Student added. ID ${data.roll_number}` : 'Student added successfully!');
      }
      finish();
    } catch (error) {
      if (error.offlineQueued) {
        finish();
        return;
      }
      console.error('Error adding student:', error);
      toast.error(error.response?.data?.error || 'Failed to add student. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  useEffect(() => {
    axios
      .get('/api/classes')
      .then(({ data }) => setSchoolClasses(Array.isArray(data) ? data : []))
      .catch(() => setSchoolClasses([]));
  }, []);

  return (
    <>
<div className="relative mx-auto max-w-4xl">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 -top-6 -z-10 h-56"
          style={{
            background:
              'radial-gradient(ellipse 70% 60% at 0% 0%, rgba(52, 152, 219, 0.14), transparent 55%)',
          }}
        />

        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            {onClose ? (
              <button
                type="button"
                onClick={onClose}
                className="mb-3 inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Back to students
              </button>
            ) : (
              <Link
                to="/students"
                className="mb-3 inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Back to students
              </Link>
            )}
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-300/90">
              Enrollment
            </p>
            <h1 className="mt-2 font-display text-3xl font-bold tracking-tight text-white md:text-4xl">
              Add new student
            </h1>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <section className="rounded-3xl border border-slate-700/80 bg-slate-900/50 p-6 md:p-8">
            <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              Student details
            </h2>
            <div className="mt-6 grid gap-5 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="mb-1.5 block text-sm font-medium text-slate-200">
                  Full name <span className="text-sky-400">*</span>
                </label>
                <div className="relative">
                  <GraduationCap className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                  <input
                    type="text"
                    name="name"
                    value={formData.name}
                    onChange={handleChange}
                    required
                    className={`${fieldClass} pl-10`}
                    placeholder="Student's full name"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-200">
                  Class / grade <span className="text-sky-400">*</span>
                </label>
                <select
                  name="class"
                  value={formData.class}
                  onChange={handleChange}
                  required
                  className={fieldClass}
                >
                  <option value="">Select a class</option>
                  {schoolClasses.map((cls) => (
                    <option key={cls.id || cls.name} value={cls.name}>
                      {cls.name}
                    </option>
                  ))}
                </select>
                {schoolClasses.length === 0 && (
                  <p className="mt-1.5 text-xs text-amber-300">
                    No classes yet. Add them in Setup before enrolling students.
                  </p>
                )}
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-200">
                  Gender <span className="text-sky-400">*</span>
                </label>
                <select
                  name="gender"
                  value={formData.gender}
                  onChange={handleChange}
                  required
                  className={fieldClass}
                >
                  <option value="">Select gender</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                </select>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-200">
                  Date of birth <span className="text-sky-400">*</span>
                </label>
                <div className="relative min-w-0">
                  <Calendar className="pointer-events-none absolute left-3.5 top-1/2 hidden h-4 w-4 -translate-y-1/2 text-slate-500 sm:block" />
                  <input
                    type="date"
                    name="dateOfBirth"
                    value={formData.dateOfBirth}
                    onChange={handleChange}
                    required
                    className={`${fieldClass} min-h-[48px] text-base sm:pl-10`}
                  />
                </div>
              </div>

              <div className="sm:col-span-2">
                <p className="text-sm font-medium text-slate-200">Student ID</p>
                <p className="mt-1 text-sm text-slate-400">
                  Assigned when you save. It looks like BFA-AS-2026-014: school letters, a unique two-letter code, the enrollment year, then the student’s place in that class at enrollment.
                </p>
              </div>

            </div>
          </section>

          <section className="rounded-3xl border border-slate-700/80 bg-slate-900/50 p-6 md:p-8">
            <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              Parent / guardian details
            </h2>
            <div className="mt-6 grid gap-5 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-200">
                  Parent / guardian name <span className="text-sky-400">*</span>
                </label>
                <div className="relative">
                  <UserPlus className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                  <input
                    type="text"
                    name="parentName"
                    value={formData.parentName}
                    onChange={handleChange}
                    required
                    className={`${fieldClass} pl-10`}
                    placeholder="Full name"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-200">Relationship</label>
                <select
                  name="parentRelationship"
                  value={formData.parentRelationship}
                  onChange={handleChange}
                  className={fieldClass}
                >
                  <option value="Parent">Parent</option>
                  <option value="Mother">Mother</option>
                  <option value="Father">Father</option>
                  <option value="Guardian">Guardian</option>
                  <option value="Other">Other</option>
                </select>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-200">
                  Parent phone <span className="text-sky-400">*</span>
                </label>
                <div className="relative">
                  <Phone className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                  <input
                    type="tel"
                    name="parentPhone"
                    value={formData.parentPhone}
                    onChange={handleChange}
                    required
                    className={`${fieldClass} pl-10`}
                    placeholder="0551234567"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-200">Parent email</label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                  <input
                    type="email"
                    name="parentEmail"
                    value={formData.parentEmail}
                    onChange={handleChange}
                    className={`${fieldClass} pl-10`}
                    placeholder="parent@example.com"
                  />
                </div>
              </div>

              <div className="sm:col-span-2">
                <label className="mb-1.5 block text-sm font-medium text-slate-200">
                  House location / address <span className="text-sky-400">*</span>
                </label>
                <div className="relative">
                  <MapPin className="pointer-events-none absolute left-3.5 top-3.5 h-4 w-4 text-slate-500" />
                  <textarea
                    name="houseAddress"
                    value={formData.houseAddress}
                    onChange={handleChange}
                    required
                    rows={3}
                    className={`${fieldClass} resize-y pl-10`}
                    placeholder="House number, street, area, city"
                  />
                </div>
              </div>
            </div>
          </section>

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => navigate('/students')}
              className="rounded-full border border-slate-600 px-6 py-3 text-sm font-medium text-slate-200 hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-sky-500 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-sky-500/20 transition hover:bg-sky-400 disabled:opacity-50"
            >
              <UserPlus className="h-4 w-4" />
              {loading ? 'Adding student…' : 'Add student'}
            </button>
          </div>
        </form>
      </div>
</>
  );
};

export default AddStudent;
