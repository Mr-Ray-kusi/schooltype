import { useEffect, useLayoutEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import MarketingChrome from '../components/MarketingChrome';
import { applyLiteClass } from '../hooks/useLiteMode';

const TOKEN_KEY = 'studentPortalSession';

const portal = axios.create();

function readSession() {
  try {
    return JSON.parse(sessionStorage.getItem(TOKEN_KEY) || 'null');
  } catch {
    return null;
  }
}

function writeSession(value) {
  if (!value) sessionStorage.removeItem(TOKEN_KEY);
  else sessionStorage.setItem(TOKEN_KEY, JSON.stringify(value));
}

function letterGrade(percent) {
  if (percent == null || Number.isNaN(percent)) return '—';
  if (percent >= 80) return 'A';
  if (percent >= 70) return 'B';
  if (percent >= 60) return 'C';
  if (percent >= 50) return 'D';
  if (percent >= 40) return 'E';
  return 'F';
}

function money(amount) {
  return `GHS ${Number(amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function SchoolCover({ school }) {
  if (school?.logo_url) {
    return <img src={school.logo_url} alt="" className="h-36 w-full object-cover object-[68%_center]" />;
  }
  return <div className="flex h-36 items-center justify-center bg-[#123028] text-3xl font-bold text-[#b08a3a]">{String(school?.name || 'S').slice(0, 1)}</div>;
}

const StudentPortal = () => {
  const { schoolId } = useParams();
  const navigate = useNavigate();
  useLayoutEffect(() => {
    applyLiteClass(false);
    return () => applyLiteClass(false);
  }, []);
  const [schools, setSchools] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [studentId, setStudentId] = useState('');
  const [password, setPassword] = useState('');
  const [signingIn, setSigningIn] = useState(false);
  const [session, setSession] = useState(() => readSession());
  const [record, setRecord] = useState(null);
  const [termId, setTermId] = useState('');
  const [tab, setTab] = useState('reports');

  useEffect(() => {
    if (session) return undefined;
    let cancelled = false;
    const applySchools = (rows) => {
      if (!cancelled) setSchools(Array.isArray(rows) ? rows : []);
    };
    const fail = (err) => {
      if (!cancelled) setError(err.response?.data?.error || 'Could not load schools');
    };
    axios
      .get('/api/student-portal/schools')
      .then(({ data }) => applySchools(data.schools))
      .catch(() =>
        axios
          .get('/api/public/schools')
          .then(({ data }) => applySchools(data.schools))
          .catch(fail)
      )
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [session]);

  useEffect(() => {
    if (!session?.sessionToken) return undefined;
    let cancelled = false;
    portal
      .get('/api/student-portal/me', { headers: { 'X-Student-Portal-Token': session.sessionToken } })
      .then(({ data }) => {
        if (cancelled) return;
        setSession((current) => ({ ...current, ...data }));
        const first = data.terms?.[data.terms.length - 1]?.id || '';
        setTermId((current) => current || first);
      })
      .catch(() => {
        if (cancelled) return;
        writeSession(null);
        setSession(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [session?.sessionToken]);

  useEffect(() => {
    if (!session?.sessionToken || !termId) return undefined;
    let cancelled = false;
    portal
      .get('/api/student-portal/record', {
        headers: { 'X-Student-Portal-Token': session.sessionToken },
        params: { termId },
      })
      .then(({ data }) => {
        if (!cancelled) setRecord(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err.response?.data?.error || 'Could not load this term');
      });
    return () => {
      cancelled = true;
    };
  }, [session?.sessionToken, termId]);

  const signIn = async (event) => {
    event.preventDefault();
    if (password.length !== 4) {
      setError('Enter the 4-digit password from the school');
      return;
    }
    setSigningIn(true);
    setError('');
    try {
      const { data } = await axios.post('/api/student-portal/login', { schoolId, studentId, password });
      writeSession(data);
      setSession(data);
      setPassword('');
      navigate('/portal');
    } catch (err) {
      setError(err.response?.data?.error || 'Student ID or password is wrong');
    } finally {
      setSigningIn(false);
    }
  };

  const signOut = () => {
    writeSession(null);
    setSession(null);
    setRecord(null);
    navigate('/portal');
  };

  const chosenSchool = schools.find((school) => school.id === schoolId);

  let body;
  if (session?.student) {
    const terms = session.terms || record?.terms || [];
    body = (
      <div className="mx-auto max-w-3xl">
        <div className="overflow-hidden rounded-3xl border border-[var(--mk-line)] bg-white">
          <SchoolCover school={session.school} />
          <div className="flex flex-wrap items-end justify-between gap-3 px-5 py-4">
            <div>
              <p className="text-sm font-semibold text-[#fffaf2]">{session.school?.name}</p>
              <h1 className="mt-1 font-serif text-3xl font-bold">{session.student.name}</h1>
              <p className="text-sm text-[#3d4a45]">
                {session.student.class} · {session.student.roll_number}
              </p>
            </div>
            <button type="button" onClick={signOut} className="text-sm font-semibold text-[#a3472a]">
              Sign out
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label className="text-sm font-semibold" htmlFor="portal-term">
            Academic term
          </label>
          <select
            id="portal-term"
            value={termId}
            onChange={(event) => setTermId(event.target.value)}
            className="rounded-lg border border-[var(--mk-line)] bg-white px-3 py-2 text-sm"
          >
            {terms.length ? null : <option value="">No terms yet</option>}
            {terms.map((term) => (
              <option key={term.id} value={term.id}>
                {term.name}
              </option>
            ))}
          </select>
        </div>

        <div className="mt-4 flex gap-2">
          {[
            ['reports', 'Reports'],
            ['attendance', 'Attendance'],
            ['fees', 'Fees'],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`rounded-full px-4 py-2 text-sm font-semibold ${tab === id ? 'bg-[#123028] text-[#fffaf2]' : 'border border-[var(--mk-line)] bg-white'}`}
            >
              {label}
            </button>
          ))}
        </div>

        <section className="mt-4 rounded-3xl border border-[var(--mk-line)] bg-white p-5">
          {tab === 'reports' ? (
            record?.reports?.published ? (
              record.reports.subjects.length ? (
                <table className="w-full text-left text-sm">
                  <thead className="text-xs uppercase tracking-wide text-[#6b7f78]">
                    <tr>
                      <th className="py-2">Subject</th>
                      <th>Score</th>
                      <th>Grade</th>
                    </tr>
                  </thead>
                  <tbody>
                    {record.reports.subjects.map((row) => (
                      <tr key={row.subject} className="border-t border-[var(--mk-line)]">
                        <td className="py-2 font-semibold">{row.subject}</td>
                        <td>
                          {row.score ?? '—'} / {row.max_score}
                        </td>
                        <td>{letterGrade(row.percent)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="text-sm">No scores were entered for this term.</p>
              )
            ) : (
              <p className="text-sm">The administrator has not published this term’s results yet.</p>
            )
          ) : null}

          {tab === 'attendance' ? (
            <>
              <p className="text-sm">
                Present {record?.attendance?.summary?.present || 0} · Late {record?.attendance?.summary?.late || 0} · Absent{' '}
                {record?.attendance?.summary?.absent || 0}
              </p>
              <ul className="mt-4 space-y-2 text-sm">
                {(record?.attendance?.records || []).map((row) => (
                  <li key={row.date} className="flex justify-between border-b border-[var(--mk-line)] py-2">
                    <span>{row.date}</span>
                    <span className="capitalize">{row.status}</span>
                  </li>
                ))}
              </ul>
              {record?.attendance?.records?.length ? null : (
                <p className="mt-3 text-sm text-[#6b7f78]">No attendance days in this term yet.</p>
              )}
            </>
          ) : null}

          {tab === 'fees' ? (
            <>
              <p className="text-sm">
                Billed {money(record?.fees?.billed)} · Paid {money(record?.fees?.paid)} · Outstanding{' '}
                {money(record?.fees?.outstanding)}
              </p>
              <ul className="mt-4 space-y-2 text-sm">
                {(record?.fees?.payments || []).map((row) => (
                  <li key={row.id} className="flex justify-between border-b border-[var(--mk-line)] py-2">
                    <span>{String(row.created_at || '').slice(0, 10)} · {row.channel || 'Payment'}</span>
                    <span>
                      {money(row.amount)} · {row.paid ? 'Paid' : row.status}
                    </span>
                  </li>
                ))}
              </ul>
              {record?.fees?.payments?.length ? null : <p className="mt-3 text-sm text-[#6b7f78]">No fee payments in this term yet.</p>}
            </>
          ) : null}
        </section>
      </div>
    );
  } else if (schoolId) {
    body = (
      <form onSubmit={signIn} className="mx-auto max-w-md rounded-3xl border border-[var(--mk-line)] bg-white p-6">
        <SchoolCover school={chosenSchool} />
        <h1 className="mt-4 font-serif text-3xl font-bold">Student portal</h1>
        <p className="mt-2 text-sm text-[#3d4a45]">Enter your student ID and password.</p>
        <label className="mt-5 block text-sm font-semibold" htmlFor="portal-id">
          Student ID
        </label>
        <input
          id="portal-id"
          value={studentId}
          onChange={(event) => setStudentId(event.target.value.toUpperCase())}
          autoComplete="username"
          className="mt-1 w-full rounded-xl border border-[var(--mk-line)] px-3 py-3 text-base"
          placeholder="BFA-AS-2026-014"
          required
        />
        <label className="mt-4 block text-sm font-semibold" htmlFor="portal-password">
          Password
        </label>
        <input
          id="portal-password"
          value={password}
          onChange={(event) => setPassword(event.target.value.replace(/\D/g, '').slice(0, 4))}
          inputMode="numeric"
          autoComplete="current-password"
          type="password"
          className="mt-1 w-full rounded-xl border border-[var(--mk-line)] px-3 py-3 text-base"
          placeholder="Enter Password"
          required
        />
        {error ? <p className="mt-3 text-sm text-[#a3472a]">{error}</p> : null}
        <button type="submit" disabled={signingIn} className="mk-btn mk-btn-primary mt-5 w-full justify-center">
          {signingIn ? 'Checking…' : 'Open portal'}
        </button>
        <p className="mt-4 text-sm">
          <Link to="/portal" className="font-semibold text-[#123028]">
            Choose a different school
          </Link>
        </p>
      </form>
    );
  } else {
    body = (
      <div className="mx-auto max-w-5xl">
        <h1 className="font-serif text-4xl font-bold">Student portal</h1>
        <p className="mt-2 max-w-2xl text-sm text-[#3d4a45]">Choose the school you attend.</p>
        {error ? <p className="mt-4 text-sm text-[#a3472a]">{error}</p> : null}
        {loading ? <p className="mt-8 text-sm">Loading schools…</p> : null}
        {!loading && !error && !schools.length ? (
          <p className="mt-8 text-sm">No schools are available yet.</p>
        ) : null}
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {schools.map((school) => (
            <button
              key={school.id}
              type="button"
              onClick={() => navigate(`/portal/${school.id}`)}
              className="overflow-hidden rounded-3xl border border-[var(--mk-line)] bg-white text-left"
            >
              <SchoolCover school={school} />
              <span className="portal-school-name">{school.name}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <MarketingChrome active="portal" showHeader={false}>
      <div className="mk-page">{body}</div>
    </MarketingChrome>
  );
};

export default StudentPortal;
