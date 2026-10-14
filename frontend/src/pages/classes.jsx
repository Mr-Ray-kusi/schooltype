import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { BookOpen, Calendar, GraduationCap, ImagePlus, Plus, Save, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../contexts/authcontext';
import { invalidateCache, peekCache, staleGet } from '../utils/requestCache';

const TERM_NAMES = ['First Term', 'Second Term', 'Third Term', 'Fourth Term'];

const fieldClass =
  'w-full rounded-lg border border-slate-600/80 bg-slate-950/60 px-3 py-1.5 text-sm text-white placeholder:text-slate-500 outline-none focus:border-sky-500/60 focus:ring-1 focus:ring-sky-500/30';

const emptyClassRow = () => ({ name: '', capacity: '', feeAmount: '' });
const emptySubjectRow = () => ({ name: '' });
const emptyTermRow = (index) => ({
  id: '',
  name: TERM_NAMES[index] || `Term ${index + 1}`,
  starts_on: '',
  ends_on: '',
});

const Setup = () => {
  const { school, persistSchool } = useAuth();
  const [classes, setClasses] = useState([]);
  const [logoPreview, setLogoPreview] = useState(school?.logo_url || '');
  const [logoDraft, setLogoDraft] = useState(null);
  const [savingLogo, setSavingLogo] = useState(false);
  const [subjects, setSubjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [classCount, setClassCount] = useState(1);
  const [classRows, setClassRows] = useState([emptyClassRow()]);
  const [subjectCount, setSubjectCount] = useState(1);
  const [subjectRows, setSubjectRows] = useState([emptySubjectRow()]);
  const [savingClasses, setSavingClasses] = useState(false);
  const [savingSubjects, setSavingSubjects] = useState(false);
  const [classDrafts, setClassDrafts] = useState({});
  const [savingClassEdits, setSavingClassEdits] = useState(false);
  const [subjectDrafts, setSubjectDrafts] = useState({});
  const [savingSubjectsEdit, setSavingSubjectsEdit] = useState(false);
  const [termCount, setTermCount] = useState(2);
  const [termRows, setTermRows] = useState([emptyTermRow(0), emptyTermRow(1)]);
  const [currentTerm, setCurrentTerm] = useState(null);
  const [savingTerms, setSavingTerms] = useState(false);

  const load = async () => {
    const apply = ([classData, subjectData]) => {
      setClasses(classData);
      setSubjects(subjectData);
      const drafts = {};
      for (const item of classData || []) {
        drafts[item.id] = {
          name: item.name || '',
          capacity: item.capacity != null && item.capacity !== '' ? String(item.capacity) : '',
          feeAmount: Number(item.fee_amount) > 0 ? String(item.fee_amount) : '',
        };
      }
      setClassDrafts(drafts);
      const nextSubjects = {};
      for (const item of subjectData || []) {
        nextSubjects[item.id] = item.name || '';
      }
      setSubjectDrafts(nextSubjects);
    };
    const cachedClasses = peekCache('classes');
    const cachedSubjects = peekCache('subjects');
    if (cachedClasses || cachedSubjects) {
      apply([cachedClasses || [], cachedSubjects || []]);
      setLoading(false);
    }
    try {
      const [classData, subjectData, termData] = await Promise.all([
        staleGet('classes', async () => (await axios.get('/api/classes')).data || [], 45000),
        staleGet('subjects', async () => (await axios.get('/api/subjects')).data || [], 45000),
        axios.get('/api/academic-terms').then(({ data }) => data).catch(() => ({ terms: [], current: null })),
      ]);
      apply([classData, subjectData]);
      const saved = termData?.terms || [];
      if (saved.length) {
        setTermCount(saved.length);
        setTermRows(
          saved.map((term, index) => ({
            id: term.id,
            name: term.name || TERM_NAMES[index] || `Term ${index + 1}`,
            starts_on: term.starts_on || '',
            ends_on: term.ends_on || '',
          }))
        );
      }
      setCurrentTerm(termData?.current || null);
    } catch (error) {
      if (error.response) toast.error(error.response?.data?.error || 'Failed to load setup');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!logoDraft && school?.logo_url && school.logo_url !== logoPreview) {
      setLogoPreview(school.logo_url);
    }
  }, [school?.logo_url, logoDraft, logoPreview]);

  const handleLogoFile = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error('Image must be smaller than 2MB');
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => {
      setLogoDraft(reader.result);
      setLogoPreview(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const saveDashboardImage = async () => {
    if (!logoDraft) {
      toast.error('Choose an image first');
      return;
    }
    setSavingLogo(true);
    try {
      const { data } = await axios.put('/api/school/branding', { logo: logoDraft });
      persistSchool({ ...(data.school || {}), logo_url: data.logo_url || logoDraft });
      setLogoDraft(null);
      setLogoPreview(data.logo_url || logoDraft);
      toast.success('Dashboard image updated');
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to save dashboard image');
    } finally {
      setSavingLogo(false);
    }
  };

  useEffect(() => {
    setClassRows((rows) => {
      const next = rows.slice(0, classCount);
      while (next.length < classCount) next.push(emptyClassRow());
      return next;
    });
  }, [classCount]);

  useEffect(() => {
    setSubjectRows((rows) => {
      const next = rows.slice(0, subjectCount);
      while (next.length < subjectCount) next.push(emptySubjectRow());
      return next;
    });
  }, [subjectCount]);

  useEffect(() => {
    setTermRows((rows) => {
      const next = rows.slice(0, termCount);
      while (next.length < termCount) next.push(emptyTermRow(next.length));
      return next;
    });
  }, [termCount]);

  const saveTerms = async () => {
    const toSave = termRows.filter((row) => row.name.trim());
    if (!toSave.length) {
      toast.error('Add at least one term name.');
      return;
    }
    setSavingTerms(true);
    try {
      const { data } = await axios.put('/api/academic-terms', {
        terms: toSave.map((row) => ({
          id: row.id || undefined,
          name: row.name.trim(),
          starts_on: row.starts_on || null,
          ends_on: row.ends_on || null,
        })),
      });
      const saved = data.terms || [];
      setTermCount(saved.length || toSave.length);
      setTermRows(
        (saved.length ? saved : toSave).map((term, index) => ({
          id: term.id || '',
          name: term.name || TERM_NAMES[index],
          starts_on: term.starts_on || '',
          ends_on: term.ends_on || '',
        }))
      );
      setCurrentTerm(data.current || null);
      toast.success('Academic terms saved');
    } catch (error) {
      if (!error.offlineQueued && error.response) {
        toast.error(error.response?.data?.error || 'Failed to save terms');
      }
    } finally {
      setSavingTerms(false);
    }
  };

  const saveClasses = async (e) => {
    e.preventDefault();
    const toSave = classRows.filter((row) => row.name.trim());
    if (!toSave.length) {
      toast.error('Enter at least one class name');
      return;
    }
    setSavingClasses(true);
    try {
      for (const row of toSave) {
        await axios.post('/api/classes', {
          name: row.name.trim(),
          capacity: row.capacity || null,
          fee_amount: row.feeAmount === '' ? 0 : Number(row.feeAmount) || 0,
        });
      }
      invalidateCache('classes');
      setClassRows([emptyClassRow()]);
      setClassCount(1);
      toast.success('Classes saved');
      await load();
    } catch (error) {
      if (!error.offlineQueued && error.response) {
        toast.error(error.response?.data?.error || 'Failed to save classes');
      }
    } finally {
      setSavingClasses(false);
    }
  };

  const saveSubjects = async (e) => {
    e.preventDefault();
    const toSave = subjectRows.filter((row) => row.name.trim());
    if (!toSave.length) {
      toast.error('Enter at least one subject name');
      return;
    }
    setSavingSubjects(true);
    try {
      for (const row of toSave) {
        await axios.post('/api/subjects', { name: row.name.trim() });
      }
      invalidateCache('subjects');
      setSubjectRows([emptySubjectRow()]);
      setSubjectCount(1);
      toast.success('Subjects saved');
      await load();
    } catch (error) {
      if (!error.offlineQueued && error.response) {
        toast.error(error.response?.data?.error || 'Failed to save subjects');
      }
    } finally {
      setSavingSubjects(false);
    }
  };

  const saveClassEdits = async () => {
    if (!classes.length) {
      toast.error('Add a class first, then edit it.');
      return;
    }
    setSavingClassEdits(true);
    try {
      await Promise.all(
        classes.map((item) => {
          const draft = classDrafts[item.id] || {};
          const name = String(draft.name || '').trim();
          if (!name) throw new Error('Class name is required');
          const feeAmount = draft.feeAmount === '' || draft.feeAmount == null ? 0 : Number(draft.feeAmount);
          return axios.put(`/api/classes/${item.id}`, {
            name,
            capacity: draft.capacity === '' || draft.capacity == null ? null : Number(draft.capacity),
            fee_amount: Number.isFinite(feeAmount) && feeAmount >= 0 ? feeAmount : 0,
          });
        })
      );
      invalidateCache('classes');
      toast.success('Classes updated');
      await load();
    } catch (error) {
      if (!error.offlineQueued && error.response) {
        toast.error(error.response?.data?.error || error.message || 'Failed to update classes');
      } else if (error.message) {
        toast.error(error.message);
      }
    } finally {
      setSavingClassEdits(false);
    }
  };

  const saveSubjectEdits = async () => {
    if (!subjects.length) {
      toast.error('Add a subject first, then edit it.');
      return;
    }
    setSavingSubjectsEdit(true);
    try {
      await Promise.all(
        subjects.map((item) => {
          const name = String(subjectDrafts[item.id] || '').trim();
          if (!name) throw new Error('Subject name is required');
          return axios.put(`/api/subjects/${item.id}`, { name });
        })
      );
      invalidateCache('subjects');
      toast.success('Subjects updated');
      await load();
    } catch (error) {
      if (!error.offlineQueued && error.response) {
        toast.error(error.response?.data?.error || error.message || 'Failed to update subjects');
      } else if (error.message) {
        toast.error(error.message);
      }
    } finally {
      setSavingSubjectsEdit(false);
    }
  };

  const deleteClass = async (id) => {
    if (!window.confirm('Delete this class?')) return;
    try {
      await axios.delete(`/api/classes/${id}`);
      invalidateCache('classes');
      load();
    } catch (error) {
      if (!error.offlineQueued && error.response) {
        toast.error(error.response?.data?.error || 'Failed to delete class');
      }
    }
  };

  const deleteSubject = async (id) => {
    if (!window.confirm('Delete this subject?')) return;
    try {
      await axios.delete(`/api/subjects/${id}`);
      invalidateCache('subjects');
      load();
    } catch (error) {
      if (!error.offlineQueued && error.response) {
        toast.error(error.response?.data?.error || 'Failed to delete subject');
      }
    }
  };

  if (loading && classes.length === 0 && subjects.length === 0) {
    return <div className="py-8 text-center text-sm text-slate-300">Loading setup…</div>;
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-white">Setup</h1>
        <p className="mt-0.5 text-sm text-slate-400">
          School image, terms, classes, fees, and subjects. Keep this tight so the school year is easy to run.
        </p>
      </div>

      <section className="rounded-2xl border border-slate-700/80 bg-slate-900/50 p-4">
        <div className="mb-3 flex items-center gap-2">
          <ImagePlus className="h-4 w-4 text-sky-300" />
          <h2 className="text-sm font-semibold text-white">Dashboard image</h2>
        </div>
        <p className="mb-3 text-xs text-slate-400">
          This is the banner on the admin dashboard. It starts as the image chosen at signup, and you can replace it
          here.
        </p>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="h-28 w-full overflow-hidden rounded-xl border border-slate-700 bg-slate-950 sm:w-56">
            {logoPreview ? (
              <img src={logoPreview} alt="Dashboard banner preview" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-slate-500">No image yet</div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="cursor-pointer rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-slate-200 hover:border-sky-500/60">
              Choose image
              <input type="file" accept="image/*" onChange={handleLogoFile} className="hidden" />
            </label>
            <button
              type="button"
              onClick={saveDashboardImage}
              disabled={savingLogo || !logoDraft}
              className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
            >
              <Save className="h-3.5 w-3.5" />
              {savingLogo ? 'Saving…' : 'Save image'}
            </button>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-700/80 bg-slate-900/50 p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-sky-300" />
            <h2 className="text-sm font-semibold text-white">Academic terms</h2>
          </div>
          {currentTerm?.name ? (
            <p className="text-xs text-slate-400">
              Current: <span className="text-sky-200">{currentTerm.name}</span>
            </p>
          ) : null}
        </div>
        <div className="mb-3 max-w-[11rem]">
          <label className="mb-1 block text-xs font-medium text-slate-300">Number of terms</label>
          <input
            type="number"
            min="1"
            max="4"
            value={termCount}
            onChange={(e) => setTermCount(Math.max(1, Math.min(4, Number(e.target.value) || 1)))}
            className={fieldClass}
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="pb-2 pr-2 font-medium">Term</th>
                <th className="pb-2 pr-2 font-medium">Starts</th>
                <th className="pb-2 font-medium">Ends</th>
              </tr>
            </thead>
            <tbody>
              {termRows.map((row, index) => (
                <tr key={row.id || index}>
                  <td className="py-1 pr-2">
                    <input
                      className={fieldClass}
                      value={row.name}
                      onChange={(e) => {
                        const next = [...termRows];
                        next[index] = { ...next[index], name: e.target.value };
                        setTermRows(next);
                      }}
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <input
                      type="date"
                      className={fieldClass}
                      value={row.starts_on}
                      onChange={(e) => {
                        const next = [...termRows];
                        next[index] = { ...next[index], starts_on: e.target.value };
                        setTermRows(next);
                      }}
                    />
                  </td>
                  <td className="py-1">
                    <input
                      type="date"
                      className={fieldClass}
                      value={row.ends_on}
                      onChange={(e) => {
                        const next = [...termRows];
                        next[index] = { ...next[index], ends_on: e.target.value };
                        setTermRows(next);
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button
          type="button"
          onClick={saveTerms}
          disabled={savingTerms}
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-sky-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-sky-400 disabled:opacity-50"
        >
          <Save className="h-3.5 w-3.5" />
          {savingTerms ? 'Saving…' : 'Save terms'}
        </button>
      </section>

      <section className="rounded-2xl border border-slate-700/80 bg-slate-900/50 p-4">
        <div className="mb-3 flex items-center gap-2">
          <GraduationCap className="h-4 w-4 text-sky-400" />
          <h2 className="text-sm font-semibold text-white">Classes and fees</h2>
        </div>

        <form onSubmit={saveClasses} className="space-y-2">
          <div className="max-w-[11rem]">
            <label className="mb-1 block text-xs font-medium text-slate-300">Number to add</label>
            <input
              type="number"
              min="1"
              max="40"
              value={classCount}
              onChange={(e) => setClassCount(Math.max(1, Math.min(40, Number(e.target.value) || 1)))}
              className={fieldClass}
            />
          </div>
          <div className="space-y-1.5">
            {classRows.map((row, index) => (
              <div key={index} className="grid grid-cols-3 gap-2">
                <input
                  type="text"
                  value={row.name}
                  onChange={(e) => {
                    const next = [...classRows];
                    next[index] = { ...next[index], name: e.target.value };
                    setClassRows(next);
                  }}
                  className={fieldClass}
                  placeholder="Class name"
                />
                <input
                  type="number"
                  min="1"
                  value={row.capacity}
                  onChange={(e) => {
                    const next = [...classRows];
                    next[index] = { ...next[index], capacity: e.target.value };
                    setClassRows(next);
                  }}
                  className={fieldClass}
                  placeholder="Capacity"
                />
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={row.feeAmount}
                  onChange={(e) => {
                    const next = [...classRows];
                    next[index] = { ...next[index], feeAmount: e.target.value };
                    setClassRows(next);
                  }}
                  className={fieldClass}
                  placeholder="Term fee"
                />
              </div>
            ))}
          </div>
          <button
            type="submit"
            disabled={savingClasses}
            className="inline-flex items-center gap-1.5 rounded-lg bg-sky-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-sky-400 disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" />
            {savingClasses ? 'Saving…' : 'Add classes'}
          </button>
        </form>

        {classes.length ? (
          <div className="mt-3 overflow-x-auto border-t border-slate-800 pt-3">
            <table className="w-full min-w-[480px] text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="pb-2 pr-2 font-medium">Class</th>
                  <th className="pb-2 pr-2 font-medium">Capacity</th>
                  <th className="pb-2 pr-2 font-medium">Term fee (GHS)</th>
                  <th className="pb-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {classes.map((item) => {
                  const draft = classDrafts[item.id] || { name: item.name || '', capacity: '', feeAmount: '' };
                  return (
                  <tr key={item.id} className="border-t border-slate-800/80">
                    <td className="py-1.5 pr-2">
                      <input
                        type="text"
                        value={draft.name}
                        onChange={(e) =>
                          setClassDrafts((prev) => ({
                            ...prev,
                            [item.id]: { ...draft, name: e.target.value },
                          }))
                        }
                        className={fieldClass}
                        placeholder="Class name"
                      />
                    </td>
                    <td className="py-1.5 pr-2">
                      <input
                        type="number"
                        min="1"
                        value={draft.capacity}
                        onChange={(e) =>
                          setClassDrafts((prev) => ({
                            ...prev,
                            [item.id]: { ...draft, capacity: e.target.value },
                          }))
                        }
                        className={`${fieldClass} max-w-[7rem]`}
                        placeholder="Capacity"
                      />
                    </td>
                    <td className="py-1.5 pr-2">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={draft.feeAmount}
                        onChange={(e) =>
                          setClassDrafts((prev) => ({
                            ...prev,
                            [item.id]: { ...draft, feeAmount: e.target.value },
                          }))
                        }
                        className={`${fieldClass} max-w-[8rem]`}
                        placeholder="0.00"
                      />
                    </td>
                    <td className="py-1.5 text-right">
                      <button type="button" onClick={() => deleteClass(item.id)} className="p-1 text-red-400 hover:text-red-300">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
            <button
              type="button"
              onClick={saveClassEdits}
              disabled={savingClassEdits}
              className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-sky-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-sky-400 disabled:opacity-50"
            >
              <Save className="h-3.5 w-3.5" />
              {savingClassEdits ? 'Saving…' : 'Save class changes'}
            </button>
          </div>
        ) : (
          <p className="mt-3 text-xs text-slate-500">No classes yet.</p>
        )}
      </section>

      <section className="rounded-2xl border border-slate-700/80 bg-slate-900/50 p-3 md:p-4">
        <div className="mb-2 flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-emerald-400" />
          <h2 className="text-sm font-semibold text-white">Subjects</h2>
        </div>
        <form onSubmit={saveSubjects} className="space-y-1.5">
          <div className="flex items-end gap-1.5">
            <div className="w-14 shrink-0">
              <label className="mb-1 block text-[10px] font-medium text-slate-400">No.</label>
              <input
                type="number"
                min="1"
                max="40"
                value={subjectCount}
                onChange={(e) => setSubjectCount(Math.max(1, Math.min(40, Number(e.target.value) || 1)))}
                className={`${fieldClass} px-1.5 text-center`}
                aria-label="Number of subjects"
              />
            </div>
            <div className="min-w-0 flex-1">
              <label className="mb-1 block text-[10px] font-medium text-slate-400">Subject name</label>
              <input
                type="text"
                value={subjectRows[0]?.name || ''}
                onChange={(e) => {
                  const next = [...subjectRows];
                  next[0] = { name: e.target.value };
                  setSubjectRows(next);
                }}
                className={fieldClass}
                placeholder="Subject name"
              />
            </div>
            <button
              type="submit"
              disabled={savingSubjects}
              className="inline-flex h-9 shrink-0 items-center gap-1 rounded-lg bg-emerald-600 px-2.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50 md:px-3 md:text-sm"
            >
              <Plus className="h-3.5 w-3.5" />
              {savingSubjects ? 'Saving…' : 'Add'}
            </button>
          </div>
          {subjectRows.length > 1 ? (
            <div className="grid grid-cols-2 gap-1.5">
              {subjectRows.slice(1).map((row, index) => (
                <input
                  key={index + 1}
                  type="text"
                  value={row.name}
                  onChange={(e) => {
                    const next = [...subjectRows];
                    next[index + 1] = { name: e.target.value };
                    setSubjectRows(next);
                  }}
                  className={fieldClass}
                  placeholder={`Subject ${index + 2}`}
                />
              ))}
            </div>
          ) : null}
        </form>
        {subjects.length === 0 ? (
          <p className="mt-2 text-xs text-slate-500">No subjects yet.</p>
        ) : (
          <>
            <ul className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {subjects.map((item) => (
                <li
                  key={item.id}
                  className="flex min-w-0 items-center gap-1 rounded-md bg-slate-800/70 px-2 py-1"
                >
                  <input
                    type="text"
                    value={subjectDrafts[item.id] ?? item.name}
                    onChange={(e) =>
                      setSubjectDrafts((prev) => ({ ...prev, [item.id]: e.target.value }))
                    }
                    className={`${fieldClass} min-w-0 flex-1 px-2 py-1 text-xs`}
                    aria-label={`Edit ${item.name}`}
                  />
                  <button
                    type="button"
                    onClick={() => deleteSubject(item.id)}
                    className="shrink-0 text-red-400 hover:text-red-300"
                    aria-label={`Delete ${item.name}`}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={saveSubjectEdits}
              disabled={savingSubjectsEdit}
              className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              <Save className="h-3.5 w-3.5" />
              {savingSubjectsEdit ? 'Saving…' : 'Save subject changes'}
            </button>
          </>
        )}
      </section>
    </div>
  );
};

export default Setup;
