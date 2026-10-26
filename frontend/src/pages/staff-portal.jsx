import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import toast from 'react-hot-toast';
import { BookOpen, GraduationCap, LogOut, MessageSquare, Moon, Pencil, Save, Sun, Users } from 'lucide-react';
import AdministratorSchool from '../components/AdministratorSchool';
import AccountantFees from '../components/AccountantFees';
import SchoolWallet from './school-wallet';
import { AuthContext } from '../contexts/authcontext';
import useLiteMode from '../hooks/useLiteMode';

const ROLES = ['Administrator', 'Teacher', 'Accountant'];
const ATTITUDES = ['Excellent', 'Good', 'Bad', 'Worse'];
const SESSION_KEY = 'staffPortalSession';

const normalizeClassKey = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');

const StaffPortal = () => {
  const { token: tokenParam, schoolSlug } = useParams();
  const [token, setToken] = useState(tokenParam || null);
  const [resolvingSlug, setResolvingSlug] = useState(Boolean(schoolSlug && !tokenParam));
  const [schoolName, setSchoolName] = useState('');
  const [linkError, setLinkError] = useState('');
  const [accessCode, setAccessCode] = useState('');
  const [role, setRole] = useState('Teacher');
  const [loggingIn, setLoggingIn] = useState(false);
  const [sessionToken, setSessionToken] = useState(() => {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (tokenParam && parsed?.portalToken === tokenParam) return parsed.sessionToken;
      if (schoolSlug && parsed?.schoolSlug === schoolSlug) return parsed.sessionToken;
    } catch {
      /* ignore */
    }
    return null;
  });
  const [staff, setStaff] = useState(null);
  const [students, setStudents] = useState([]);
  const [selectedSubject, setSelectedSubject] = useState('');
  const [selectedClass, setSelectedClass] = useState('');
  const [term, setTerm] = useState('Term 1');
  const [draftScores, setDraftScores] = useState({});
  const [loadingPortal, setLoadingPortal] = useState(true);
  const [savingAll, setSavingAll] = useState(false);
  const [promotionResult, setPromotionResult] = useState(null);
  const [scoreLock, setScoreLock] = useState({ published: false, canEdit: true });
  const [hasSavedScores, setHasSavedScores] = useState(false);
  const [editingSaved, setEditingSaved] = useState(false);
  const [schoolRecord, setSchoolRecord] = useState(null);
  const [financeTab, setFinanceTab] = useState('fees');
  const [owingSmsOpen, setOwingSmsOpen] = useState(false);
  const { liteMode, toggleLiteMode } = useLiteMode();

  const themeToggle = (
    <button
      type="button"
      onClick={toggleLiteMode}
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm ${
        liteMode
          ? 'border-slate-300 bg-white text-slate-800 hover:bg-slate-50'
          : 'border-slate-600 text-slate-200 hover:bg-slate-800'
      }`}
      aria-pressed={liteMode}
    >
      {liteMode ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
      {liteMode ? 'Dark' : 'Lite'}
    </button>
  );

  const authHeaders = useMemo(
    () => (sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
    [sessionToken]
  );

  useEffect(() => {
    if (!schoolSlug || tokenParam) {
      setResolvingSlug(false);
      if (tokenParam) setToken(tokenParam);
      return undefined;
    }
    let cancelled = false;
    const resolve = async () => {
      setResolvingSlug(true);
      setLinkError('');
      try {
        const { data } = await axios.get(
          `/api/public/staff-portal/${encodeURIComponent(schoolSlug)}`
        );
        if (!cancelled) {
          setSchoolName(data.schoolName || 'School');
        }
      } catch (err) {
        if (!cancelled) {
          setLinkError(err.response?.data?.error || 'Invalid or inactive staff portal link');
        }
      } finally {
        if (!cancelled) setResolvingSlug(false);
      }
    };
    resolve();
    return () => {
      cancelled = true;
    };
  }, [schoolSlug, tokenParam]);

  useEffect(() => {
    if (!token) {
      if (schoolSlug) {
        if (!resolvingSlug) setLoadingPortal(false);
        return undefined;
      }
      if (!resolvingSlug) {
        setLoadingPortal(false);
        setLinkError('Invalid or inactive staff portal link');
      }
      return undefined;
    }
    let cancelled = false;
    const loadSchool = async () => {
      setLoadingPortal(true);
      setLinkError('');
      try {
        const { data } = await axios.get(`/api/staff-portal/${token}/school`);
        if (!cancelled) setSchoolName(data.schoolName || 'School');
      } catch (err) {
        if (!cancelled) {
          setLinkError(err.response?.data?.error || 'Invalid or inactive staff portal link');
        }
      } finally {
        if (!cancelled) setLoadingPortal(false);
      }
    };
    loadSchool();
    return () => {
      cancelled = true;
    };
  }, [token, resolvingSlug, schoolSlug]);

  const persistSession = (nextToken, nextStaff, nextSchool, nextSchoolRecord) => {
    sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        portalToken: token,
        schoolSlug: schoolSlug || null,
        sessionToken: nextToken,
        staff: nextStaff,
        schoolName: nextSchool,
        school: nextSchoolRecord || null,
      })
    );
  };

  const clearSession = ({ leavePortal = false } = {}) => {
    sessionStorage.removeItem(SESSION_KEY);
    setSessionToken(null);
    setStaff(null);
    setStudents([]);
    setDraftScores({});
    setSchoolRecord(null);
    if (leavePortal) window.location.assign('/');
  };

  useEffect(() => {
    if (!sessionToken) return undefined;
    const id = axios.interceptors.request.use((config) => {
      config.headers = config.headers || {};
      if (!config.headers.Authorization) {
        config.headers.Authorization = `Bearer ${sessionToken}`;
      }
      return config;
    });
    return () => axios.interceptors.request.eject(id);
  }, [sessionToken]);

  const loadTeacherData = useCallback(
    async (subject, className, selectedTerm) => {
      if (!sessionToken) return;
      try {
        const [studentsRes, scoresRes] = await Promise.all([
          axios.get('/api/staff-portal/session/students', { headers: authHeaders }),
          axios.get('/api/staff-portal/session/scores', {
            headers: authHeaders,
            params: { subject, className, term: selectedTerm },
          }),
        ]);
        setStudents(studentsRes.data || []);
        const payload = scoresRes.data;
        const rows = Array.isArray(payload) ? payload : payload?.scores || [];
        setScoreLock(Array.isArray(payload) ? { published: false, canEdit: true } : payload?.lock || { published: false, canEdit: true });
        const nextDraft = {};
        for (const row of rows) {
          nextDraft[row.student_id] = {
            score: row.score ?? '',
            maxScore: row.max_score ?? 100,
            attitude: row.attitude || '',
          };
        }
        setDraftScores(nextDraft);
        const selectedKey = normalizeClassKey(className);
        const inClass = (studentsRes.data || []).filter(
          (student) => !selectedKey || normalizeClassKey(student.class) === selectedKey
        );
        const complete =
          inClass.length > 0 &&
          inClass.every((student) => {
            const draft = nextDraft[student.id];
            return draft && draft.score !== '' && draft.score != null && Number.isFinite(Number(draft.score));
          });
        setHasSavedScores(complete);
        setEditingSaved(false);
      } catch (err) {
        toast.error(err.response?.data?.error || 'Failed to load portal data');
        if (err.response?.status === 401) clearSession();
      }
    },
    [authHeaders, sessionToken]
  );

  useEffect(() => {
    if (!sessionToken) return undefined;
    let cancelled = false;
    const restore = async () => {
      try {
        const { data } = await axios.get('/api/staff-portal/session/me', { headers: authHeaders });
        if (cancelled) return;
        setStaff(data.staff);
        setSchoolName(data.schoolName || schoolName);
        if (data.school) setSchoolRecord(data.school);
        if (data.currentTerm) setTerm(data.currentTerm);
        const firstSubject = data.staff.subjects?.[0] || '';
        const firstClass = data.staff.classNames?.[0] || '';
        setSelectedSubject((prev) => prev || firstSubject);
        setSelectedClass((prev) => prev || firstClass);
      } catch {
        if (!cancelled) clearSession();
      }
    };
    restore();
    return () => {
      cancelled = true;
    };
  }, [sessionToken, authHeaders]);

  useEffect(() => {
    if (!staff || String(staff.role).toLowerCase() !== 'teacher') return;
    if (!selectedSubject || !selectedClass) return;
    loadTeacherData(selectedSubject, selectedClass, term);
  }, [staff, selectedSubject, selectedClass, term, loadTeacherData]);

  useEffect(() => {
    if (!sessionToken || !staff) return undefined;
    const headers = { Authorization: `Bearer ${sessionToken}` };
    const send = (events) => {
      axios
        .post('/api/staff-portal/session/telemetry', { events, schoolName }, { headers })
        .catch(() => {});
    };
    const isTeacher = String(staff.role).toLowerCase() === 'teacher';
    const activity =
      isTeacher && selectedSubject && selectedClass
        ? `Entering ${selectedSubject} scores for ${selectedClass}`
        : `Signed in as ${staff.role}`;
    send([
      {
        type: 'page_view',
        path: '/staff-portal',
        meta: { activity, staffName: staff.name },
      },
    ]);
    const id = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      send([
        {
          type: 'heartbeat',
          path: '/staff-portal',
          meta: { activity, staffName: staff.name },
        },
      ]);
    }, 45000);
    return () => clearInterval(id);
  }, [sessionToken, staff, schoolName, selectedSubject, selectedClass]);

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!token && !schoolSlug) return;
    setLoggingIn(true);
    try {
      const loginUrl = token
        ? `/api/staff-portal/${token}/login`
        : `/api/public/staff-portal/${encodeURIComponent(schoolSlug)}/login`;
      const { data } = await axios.post(loginUrl, { accessCode, role });
      setSessionToken(data.sessionToken);
      setStaff(data.staff);
      setSchoolName(data.schoolName || schoolName);
      if (data.school) setSchoolRecord(data.school);
      persistSession(data.sessionToken, data.staff, data.schoolName, data.school);
      setSelectedSubject(data.staff.subjects?.[0] || '');
      setSelectedClass(data.staff.classNames?.[0] || '');
      toast.success(`Welcome, ${data.staff.name}`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Login failed');
    } finally {
      setLoggingIn(false);
    }
  };

  const classStudents = useMemo(() => {
    if (!selectedClass) return students;
    const selectedKey = normalizeClassKey(selectedClass);
    return students.filter((student) => normalizeClassKey(student.class) === selectedKey);
  }, [students, selectedClass]);

  const hasEnteredMark = (student) => {
    const draft = draftScores[student.id];
    if (!draft || draft.score === '' || draft.score == null) return false;
    return Number.isFinite(Number(draft.score));
  };

  const markedCount = classStudents.filter(hasEnteredMark).length;
  const allMarksEntered = classStudents.length > 0 && markedCount === classStudents.length;

  const saveAllScores = async () => {
    if (!allMarksEntered || savingAll || (scoreLock?.published && !scoreLock?.canEdit)) return;
    setSavingAll(true);
    try {
      const { data } = await axios.post(
        '/api/staff-portal/session/scores/batch',
        {
          subject: selectedSubject,
          className: selectedClass,
          term,
          entries: classStudents.map((student) => {
            const draft = draftScores[student.id] || { score: '', maxScore: 100, attitude: '' };
            return {
              studentId: student.id,
              className: selectedClass || student.class,
              score: draft.score,
              maxScore: draft.maxScore,
              attitude: draft.attitude || null,
            };
          }),
        },
        { headers: authHeaders }
      );
      setPromotionResult(data?.promotions || null);
      if (data?.failed?.length) {
        toast.error(data.message || `Saved with ${data.failed.length} errors`);
        setEditingSaved(true);
      } else {
        toast.success(data?.message || `Saved ${classStudents.length} scores`);
        setHasSavedScores(true);
        setEditingSaved(false);
      }
      await loadTeacherData(selectedSubject, selectedClass, term);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to save scores');
    } finally {
      setSavingAll(false);
    }
  };

  if (resolvingSlug || loadingPortal) {
    return (
      <div className={`flex min-h-screen items-center justify-center ${liteMode ? 'lite-shell bg-slate-100 text-slate-700' : 'bg-slate-950 text-slate-300'}`}>
        Loading staff portal…
      </div>
    );
  }

  if (linkError) {
    return (
      <div className={`flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center ${liteMode ? 'lite-shell bg-slate-100' : 'bg-slate-950'}`}>
        <h1 className={`text-2xl font-bold ${liteMode ? 'text-slate-900' : 'text-white'}`}>Staff portal unavailable</h1>
        <p className={liteMode ? 'text-slate-600' : 'text-slate-400'}>{linkError}</p>
      </div>
    );
  }

  if (!sessionToken || !staff) {
    return (
      <div className={`relative min-h-screen overflow-hidden ${liteMode ? 'lite-shell bg-slate-100 text-slate-900' : 'bg-slate-950 text-white'}`}>
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(ellipse 55% 40% at 50% 0%, rgba(52,152,219,0.18), transparent 55%), #020617',
          }}
        />
        <div className="relative z-10 mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-10">
          <div className="mb-6 flex justify-end">{themeToggle}</div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-300/90">Staff portal</p>
          <h1 className="mt-2 font-display text-3xl font-bold">{schoolName}</h1>
          <form
            onSubmit={handleLogin}
            className="mt-8 space-y-4 rounded-3xl border border-slate-700/80 bg-slate-900/70 p-6"
          >
            <div>
              <label className="mb-1.5 block text-sm text-slate-300">Access code</label>
              <input
                value={accessCode}
                onChange={(e) => setAccessCode(e.target.value)}
                className="w-full rounded-xl border border-slate-600 bg-slate-950/70 px-4 py-3 text-white"
                placeholder="SCH-XXXXXXXX"
                required
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm text-slate-300">Role</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="w-full rounded-xl border border-slate-600 bg-slate-950/70 px-4 py-3 text-white"
                required
              >
                {ROLES.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              disabled={loggingIn}
              className="w-full rounded-full bg-sky-500 py-3 text-sm font-semibold text-white hover:bg-sky-400 disabled:opacity-50"
            >
              {loggingIn ? 'Signing in…' : 'Enter portal'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  const isTeacher = String(staff.role).toLowerCase() === 'teacher';
  const isAccountant = String(staff.role).toLowerCase() === 'accountant';
  const isAdministrator = ['administrator', 'headteacher', 'head teacher', 'headmistress', 'headmaster'].includes(
    String(staff.role).toLowerCase()
  );
  const wideLayout = isAccountant || isAdministrator;
  const scoresLocked = Boolean(scoreLock?.published && !scoreLock?.canEdit);
  const viewingSaved = hasSavedScores && !editingSaved && !scoresLocked;
  const fieldsLocked = savingAll || scoresLocked || viewingSaved;
  const portalAuth = {
    token: sessionToken,
    school: schoolRecord || {
      name: schoolName,
      role: 'school',
      plan_approved: true,
      plan_status: 'approved',
    },
    isSuperAdmin: false,
    isPlanApproved: true,
    isSubscriptionActive: true,
    includesPlanFeature: () => true,
    hasFeature: () => true,
    hasMessaging: false,
    persistSchool: (next) => setSchoolRecord((prev) => ({ ...(prev || {}), ...next })),
    refreshSchool: async () => {},
    loading: false,
  };

  return (
    <div className={`min-h-screen ${liteMode ? 'lite-shell bg-slate-100 text-slate-900' : 'bg-slate-950 text-white'}`}>
      <header className={`border-b px-4 py-4 ${liteMode ? 'border-slate-200 bg-white' : 'border-slate-800 bg-slate-900/80'}`}>
        <div className={`mx-auto flex items-center justify-between gap-3 ${wideLayout ? 'max-w-7xl' : 'max-w-5xl'}`}>
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">{schoolName}</p>
            <h1 className="text-xl font-bold">{staff.name}</h1>
            <p className="text-sm text-sky-300">{staff.role}</p>
          </div>
          <div className="flex items-center gap-2">
            {themeToggle}
            <button
              type="button"
              onClick={() => clearSession({ leavePortal: true })}
              className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm ${
                liteMode
                  ? 'border-slate-300 bg-white text-slate-800 hover:bg-slate-50'
                  : 'border-slate-600 text-slate-200 hover:bg-slate-800'
              }`}
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className={`mx-auto space-y-6 px-4 py-8 ${wideLayout ? 'max-w-7xl' : 'max-w-5xl'}`}>
        {isAdministrator ? (
          <AuthContext.Provider value={portalAuth}>
            <AdministratorSchool schoolName={schoolName} authHeaders={authHeaders} />
          </AuthContext.Provider>
        ) : isAccountant ? (
          <AuthContext.Provider value={portalAuth}>
            <div className="flex flex-col gap-6 lg:flex-row">
              <aside className="shrink-0 lg:w-52">
                <div className="sticky top-4 space-y-2 rounded-2xl border border-slate-700 bg-slate-900/70 p-3">
                  <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-300">
                    Finance
                  </p>
                  {[
                    { id: 'fees', label: 'Fees' },
                    { id: 'wallet', label: 'School wallet' },
                  ].map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setFinanceTab(item.id)}
                      className={`flex w-full items-center rounded-xl px-3 py-2 text-left text-sm font-medium ${
                        financeTab === item.id ? 'bg-emerald-600 text-white' : 'text-slate-200 hover:bg-slate-800'
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      setFinanceTab('fees');
                      setOwingSmsOpen(true);
                    }}
                    className="mt-2 flex w-full items-center gap-2 rounded-xl border border-slate-600 px-3 py-2 text-left text-sm font-medium text-slate-200 hover:bg-slate-800"
                  >
                    <MessageSquare className="h-4 w-4" />
                    SMS owing parents
                  </button>
                </div>
              </aside>
              <div className="min-w-0 flex-1">
                {financeTab === 'fees' ? (
                  <AccountantFees
                    schoolName={schoolName}
                    authHeaders={authHeaders}
                    hideReminderButton
                    reminderOpen={owingSmsOpen}
                    onReminderOpenChange={setOwingSmsOpen}
                  />
                ) : (
                  <SchoolWallet viewOnly />
                )}
              </div>
            </div>
          </AuthContext.Provider>
        ) : !isTeacher ? (
          <div className="rounded-3xl border border-slate-700 bg-slate-900/60 p-8 text-center">
            <p className="text-lg font-semibold">Signed in as {staff.role}</p>
            <p className="mt-2 text-sm text-slate-400">
              Teacher score entry is available when you sign in with the Teacher role. Ask your admin to assign
              subjects and classes on your staff profile.
            </p>
          </div>
        ) : (
          <>
            <section className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-2xl border border-slate-700 bg-slate-900/60 p-4">
                <p className="flex items-center gap-2 text-xs uppercase tracking-wide text-slate-500">
                  <BookOpen className="h-3.5 w-3.5" /> Subjects
                </p>
                <p className="mt-2 text-sm text-slate-200">
                  {staff.subjects?.length ? staff.subjects.join(', ') : 'None assigned'}
                </p>
              </div>
              <div className="rounded-2xl border border-slate-700 bg-slate-900/60 p-4">
                <p className="flex items-center gap-2 text-xs uppercase tracking-wide text-slate-500">
                  <GraduationCap className="h-3.5 w-3.5" /> Classes
                </p>
                <p className="mt-2 text-sm text-slate-200">
                  {staff.classNames?.length ? staff.classNames.join(', ') : 'None assigned'}
                </p>
              </div>
              <div className="rounded-2xl border border-slate-700 bg-slate-900/60 p-4">
                <p className="flex items-center gap-2 text-xs uppercase tracking-wide text-slate-500">
                  <Users className="h-3.5 w-3.5" /> Students in view
                </p>
                <p className="mt-2 text-2xl font-bold text-white">{classStudents.length}</p>
              </div>
            </section>

            {!staff.subjects?.length || !staff.classNames?.length ? (
              <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-5 py-4 text-sm text-amber-100">
                Your admin must set subjects and classes on your staff profile before you can enter scores.
              </div>
            ) : (
              <>
                <section className="grid gap-3 sm:grid-cols-3">
                  <select
                    value={selectedSubject}
                    onChange={(e) => setSelectedSubject(e.target.value)}
                    className="rounded-xl border border-slate-600 bg-slate-900 px-4 py-3 text-sm"
                    disabled={savingAll}
                  >
                    {staff.subjects.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                  <select
                    value={selectedClass}
                    onChange={(e) => setSelectedClass(e.target.value)}
                    className="rounded-xl border border-slate-600 bg-slate-900 px-4 py-3 text-sm"
                    disabled={savingAll}
                  >
                    {staff.classNames.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                  <div className="rounded-xl border border-slate-600 bg-slate-900 px-4 py-3 text-sm text-slate-100">
                    <p className="font-medium">{term}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      Current term only. Past marks stay on the school record.
                    </p>
                  </div>
                </section>

                <section className="overflow-hidden rounded-3xl border border-slate-700 bg-slate-900/50">
                  <div className="flex flex-col gap-3 border-b border-slate-700 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h2 className="font-semibold">
                        Scores · {selectedSubject} · {selectedClass}
                      </h2>
                      <p className="mt-1 text-xs text-slate-400">
                        {viewingSaved
                          ? 'These marks are saved. Click Edit to change them.'
                          : 'Enter a mark for every student, then save once.'}
                        {classStudents.length > 0
                          ? ` ${markedCount}/${classStudents.length} entered.`
                          : ''}
                      </p>
                      {scoreLock?.published && !scoreLock?.canEdit ? (
                        <p className="mt-2 text-xs text-amber-200">
                          The administrator has published this report. Ask them to allow you to edit.
                        </p>
                      ) : null}
                      {scoreLock?.published && scoreLock?.canEdit ? (
                        <p className="mt-2 text-xs text-emerald-200">
                          The administrator allowed you to edit this published report.
                        </p>
                      ) : null}
                    </div>
                    {viewingSaved ? (
                      <button
                        type="button"
                        onClick={() => setEditingSaved(true)}
                        className="inline-flex items-center justify-center gap-1.5 rounded-full border border-sky-400/70 bg-sky-500/10 px-4 py-2 text-sm font-semibold text-sky-100 hover:bg-sky-500/20"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        Edit
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={saveAllScores}
                        disabled={!allMarksEntered || savingAll || scoresLocked}
                        className="inline-flex items-center justify-center gap-1.5 rounded-full bg-sky-500 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <Save className="h-3.5 w-3.5" />
                        {savingAll ? 'Saving…' : 'Save all'}
                      </button>
                    )}
                  </div>
                  {promotionResult &&
                  (promotionResult.promoted?.length ||
                    promotionResult.retained?.length ||
                    promotionResult.pending?.length) ? (
                    <div className="space-y-2 border-b border-slate-800 bg-slate-950/40 px-5 py-4 text-sm">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                        After this term
                      </p>
                      {promotionResult.promoted?.length ? (
                        <p className="text-emerald-200">
                          Promoted:{' '}
                          {promotionResult.promoted
                            .map((row) => `${row.name}${row.nextClass ? ` → ${row.nextClass}` : ''}`)
                            .join(', ')}
                        </p>
                      ) : null}
                      {promotionResult.retained?.length ? (
                        <p className="text-amber-200">
                          Retained: {promotionResult.retained.map((row) => row.name).join(', ')}
                        </p>
                      ) : null}
                      {promotionResult.pending?.length ? (
                        <p className="text-slate-300">
                          Still waiting for other subjects:{' '}
                          {promotionResult.pending.map((row) => row.name).join(', ')}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="divide-y divide-slate-800">
                    {classStudents.length === 0 ? (
                      <p className="px-5 py-8 text-center text-sm text-slate-400">
                        No students found in this class. Ask your admin to match the teacher class names with
                        each student&apos;s class from Setup.
                      </p>
                    ) : (
                      classStudents.map((student) => {
                        const draft = draftScores[student.id] || {
                          score: '',
                          maxScore: 100,
                          attitude: '',
                        };
                        return (
                          <div
                            key={student.id}
                            className="flex flex-col gap-3 px-5 py-4 lg:flex-row lg:items-center"
                          >
                            <div className="min-w-0 flex-1">
                              <p className="font-medium text-white">{student.name}</p>
                              <p className="text-xs text-slate-500">
                                {student.class}
                                {student.roll_number ? ` · ${student.roll_number}` : ''}
                                {student.parent_phone ? ` · Parent: ${student.parent_phone}` : ''}
                              </p>
                            </div>
                            <input
                              type="number"
                              value={draft.score}
                              onChange={(e) =>
                                setDraftScores((prev) => ({
                                  ...prev,
                                  [student.id]: { ...draft, score: e.target.value },
                                }))
                              }
                              className="w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm lg:w-24"
                              placeholder="Score"
                              disabled={fieldsLocked}
                            />
                            <input
                              type="number"
                              value={draft.maxScore}
                              onChange={(e) =>
                                setDraftScores((prev) => ({
                                  ...prev,
                                  [student.id]: { ...draft, maxScore: e.target.value },
                                }))
                              }
                              className="w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm lg:w-24"
                              placeholder="Max"
                              disabled={fieldsLocked}
                            />
                            <select
                              value={draft.attitude || ''}
                              onChange={(e) =>
                                setDraftScores((prev) => ({
                                  ...prev,
                                  [student.id]: { ...draft, attitude: e.target.value },
                                }))
                              }
                              className="w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm lg:w-36"
                              disabled={fieldsLocked}
                            >
                              <option value="">Attitude</option>
                              {ATTITUDES.map((item) => (
                                <option key={item} value={item}>
                                  {item}
                                </option>
                              ))}
                            </select>
                          </div>
                        );
                      })
                    )}
                  </div>
                </section>
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
};

export default StaffPortal;
