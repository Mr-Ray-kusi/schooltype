import { useEffect, useLayoutEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import { LogOut } from 'lucide-react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
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

function ordinal(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return '—';
  const mod = num % 100;
  if (mod >= 11 && mod <= 13) return `${num}th`;
  const last = num % 10;
  if (last === 1) return `${num}st`;
  if (last === 2) return `${num}nd`;
  if (last === 3) return `${num}rd`;
  return `${num}th`;
}

function gradeTone(grade) {
  const letter = String(grade || '').toUpperCase();
  if (letter.startsWith('A') || letter.startsWith('B')) return 'is-high';
  if (letter.startsWith('C')) return 'is-mid';
  if (letter.startsWith('D')) return 'is-low';
  return 'is-fail';
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

function downloadGroupedResults({ schoolName, student, years }) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  let y = 48;
  doc.setFontSize(16);
  doc.text(String(schoolName || 'School'), 40, y);
  y += 22;
  doc.setFontSize(12);
  doc.text(`${student.name} · ${student.class || ''} · ${student.roll_number || ''}`, 40, y);
  for (const year of years || []) {
    y += 28;
    if (y > 740) {
      doc.addPage();
      y = 48;
    }
    doc.setFontSize(14);
    doc.text(String(year.academicYear || 'Academic year'), 40, y);
    for (const term of year.terms || []) {
      y += 20;
      if (y > 740) {
        doc.addPage();
        y = 48;
      }
      doc.setFontSize(12);
      doc.text(
        `${term.name || 'Term'} · Total in class ${term.classSize ?? '—'} · Position ${ordinal(term.position)}`,
        40,
        y
      );
      if (!term.published) {
        y += 16;
        doc.setFontSize(11);
        doc.text('The administrator has not published this term’s results yet.', 40, y);
        continue;
      }
      autoTable(doc, {
        startY: y + 10,
        head: [['Subject', 'Score', 'Grade']],
        body: (term.subjects || []).map((row) => [
          row.subject,
          `${row.score ?? '—'} / ${row.max_score}`,
          letterGrade(row.percent),
        ]),
        styles: { fontSize: 10, textColor: [15, 23, 42] },
        headStyles: { fillColor: [30, 27, 75] },
      });
      y = (doc.lastAutoTable?.finalY || y) + 8;
    }
  }
  const safeName = String(student.roll_number || 'student').replace(/[^\w.-]+/g, '-');
  doc.save(`${safeName}-results.pdf`);
}

function money(amount) {
  return `GHS ${Number(amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const ATTENDANCE_WEEKDAYS = [
  ['Monday', 'M'],
  ['Tuesday', 'T'],
  ['Wednesday', 'W'],
  ['Thursday', 'T'],
  ['Friday', 'F'],
  ['Saturday', 'S'],
  ['Sunday', 'S'],
];

const ATTENDANCE_MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function parsePortalDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || '').trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

function portalDateKey(date) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function schoolNotHeld(date) {
  const key = portalDateKey(date);
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Accra',
    weekday: 'short',
  }).format(new Date(`${key}T12:00:00Z`));
  return weekday.startsWith('Sat') || weekday.startsWith('Sun');
}

function countSchoolDays(start, end) {
  const first = start <= end ? start : end;
  const last = start <= end ? end : start;
  const startUtc = Date.UTC(first.getFullYear(), first.getMonth(), first.getDate());
  const endUtc = Date.UTC(last.getFullYear(), last.getMonth(), last.getDate());
  const totalDays = Math.floor((endUtc - startUtc) / 86400000) + 1;
  let count = 0;
  for (let offset = 0; offset < totalDays; offset += 1) {
    const day = new Date(first.getFullYear(), first.getMonth(), first.getDate() + offset);
    if (!schoolNotHeld(day)) count += 1;
  }
  return count;
}

function schoolDaysOnCalendar(bounds) {
  if (!bounds?.start || !bounds?.end) return 0;
  const startKey = portalDateKey(bounds.start);
  const endKey = portalDateKey(bounds.end);
  const days = new Set();
  for (const month of monthGrids(bounds.start, bounds.end)) {
    for (const date of month.cells) {
      if (!date || schoolNotHeld(date)) continue;
      const key = portalDateKey(date);
      if (key < startKey || key > endKey) continue;
      days.add(key);
    }
  }
  return days.size;
}

function termSchoolDays(term, bounds) {
  const start = parsePortalDate(term?.starts_on);
  const end = parsePortalDate(term?.ends_on);
  if (start && end) return countSchoolDays(start, end);
  return schoolDaysOnCalendar(bounds);
}

function attendanceMark(status) {
  const mark = String(status || '')
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ');
  if (!mark) return '';
  if (mark === 'late' || mark === 'tardy' || mark.startsWith('late ')) return 'late';
  if (mark === 'absent' || mark === 'absence' || mark.startsWith('absent')) return 'absent';
  if (
    mark === 'present' ||
    mark === 'early' ||
    mark === 'on time' ||
    mark === 'ontime' ||
    mark === 'punctual' ||
    mark.startsWith('present') ||
    mark.startsWith('early')
  ) {
    return 'present';
  }
  return '';
}

function attendanceByDate(records) {
  const map = new Map();
  for (const row of records || []) {
    const key = String(row?.date || '').slice(0, 10);
    const mark = attendanceMark(row?.status);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !mark) continue;
    map.set(key, mark);
  }
  return map;
}

function termCalendarBounds(term) {
  let start = parsePortalDate(term?.starts_on);
  let end = parsePortalDate(term?.ends_on);
  if (!start || !end) {
    const dates = (term?.attendance?.records || [])
      .map((row) => parsePortalDate(row?.date))
      .filter(Boolean)
      .sort((a, b) => a - b);
    if (!start) start = dates[0] || null;
    if (!end) end = dates[dates.length - 1] || null;
  }
  if (!start || !end) return null;
  if (start > end) {
    const swap = start;
    start = end;
    end = swap;
  }
  return { start, end };
}

function monthGrids(start, end) {
  const months = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  const last = new Date(end.getFullYear(), end.getMonth(), 1);
  let guard = 0;
  while (cursor <= last && guard < 24) {
    guard += 1;
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const lead = (new Date(year, month, 1).getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells = Array.from({ length: lead }, () => null);
    for (let day = 1; day <= daysInMonth; day += 1) cells.push(new Date(year, month, day));
    while (cells.length % 7 !== 0) cells.push(null);
    months.push({
      key: `${year}-${String(month + 1).padStart(2, '0')}`,
      label: `${ATTENDANCE_MONTHS[month]} ${year}`,
      cells,
    });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return months;
}

function attendanceCount(summaryValue, records, mark) {
  const count = Number(summaryValue);
  if (Number.isFinite(count)) return count;
  return (records || []).filter((row) => attendanceMark(row?.status) === mark).length;
}

function AttendanceCalendar({ term }) {
  const records = term?.attendance?.records || [];
  const bounds = termCalendarBounds(term);
  if (!bounds?.start || !bounds?.end) {
    return <p>No attendance days in this term yet.</p>;
  }

  const marks = attendanceByDate(records);
  const months = monthGrids(bounds.start, bounds.end);
  const startKey = portalDateKey(bounds.start);
  const endKey = portalDateKey(bounds.end);
  const summary = term?.attendance?.summary || {};
  const schoolDays = termSchoolDays(term, bounds);

  return (
    <>
      <div className="portal-attendance-cal">
        {months.map((month) => (
          <section key={month.key} className="portal-attendance-month" aria-label={month.label}>
            <h4>{month.label}</h4>
            <div className="portal-attendance-weekdays">
              {ATTENDANCE_WEEKDAYS.map(([name, letter]) => (
                <span key={`${month.key}-${name}`} title={name}>
                  {letter}
                </span>
              ))}
            </div>
            <div className="portal-attendance-days">
              {month.cells.map((date, index) => {
                if (!date) {
                  return <span key={`${month.key}-pad-${index}`} className="portal-attendance-day" />;
                }
                const key = portalDateKey(date);
                const outside = key < startKey || key > endKey;
                const mark = outside ? '' : marks.get(key) || '';
                const closed = !mark && schoolNotHeld(date);
                const spoken = mark === 'present' ? 'early' : mark;
                return (
                  <span
                    key={key}
                    className={`portal-attendance-day${outside ? ' is-outside' : ''}${mark ? ` is-${mark}` : ''}${closed ? ' is-closed' : ''}`}
                    title={spoken ? `${date.getDate()} ${spoken}` : undefined}
                  >
                    {date.getDate()}
                  </span>
                );
              })}
            </div>
          </section>
        ))}
      </div>
      <div className="portal-attendance-totals">
        <span className="portal-attendance-total">
          <span className="portal-grade is-early">{attendanceCount(summary.present, records, 'present')}</span>
          Early
        </span>
        <span className="portal-attendance-total">
          <span className="portal-grade is-late">{attendanceCount(summary.late, records, 'late')}</span>
          Late
        </span>
        <span className="portal-attendance-total">
          <span className="portal-grade is-absent">{attendanceCount(summary.absent, records, 'absent')}</span>
          Absent
        </span>
        <span className="portal-attendance-total">
          <span className="portal-grade is-school">{schoolDays}</span>
          School days
        </span>
      </div>
      {records.length ? null : <p>No attendance days in this term yet.</p>}
    </>
  );
}

function SchoolCover({ school }) {
  const [logo, setLogo] = useState(school?.logo_url || '');

  useEffect(() => {
    setLogo(school?.logo_url || '');
    if (school?.logo_url || !school?.id) return undefined;
    let cancelled = false;
    axios
      .get(`/api/public/schools/${school.id}/logo`)
      .then(({ data }) => {
        if (!cancelled && data?.logo_url) setLogo(data.logo_url);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [school?.id, school?.logo_url]);

  if (logo) {
    return <img src={logo} alt="" className="h-36 w-full object-cover object-[68%_center]" />;
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
    if (!session?.sessionToken) return undefined;
    let cancelled = false;
    portal
      .get('/api/student-portal/record', {
        headers: { 'X-Student-Portal-Token': session.sessionToken },
      })
      .then(({ data }) => {
        if (!cancelled) setRecord(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err.response?.data?.error || 'Could not load your record');
      });
    return () => {
      cancelled = true;
    };
  }, [session?.sessionToken]);

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

  if (session?.student) {
    const years = record?.years || [];
    const firstName = String(session.student.name || 'Student').trim().split(/\s+/)[0];
    const publishedYears = years
      .map((year) => ({
        ...year,
        terms: (year.terms || []).filter((term) => term.published),
      }))
      .filter((year) => year.terms.length);
    return (
      <div className="portal-shell">
        <aside className="portal-side">
          <div className="portal-brand">
            {session.school?.logo_url ? (
              <img src={session.school.logo_url} alt="" className="portal-brand-logo" />
            ) : (
              <span className="portal-brand-mark">{String(session.school?.name || 'S').slice(0, 1)}</span>
            )}
            <p className="portal-brand-title">Students&apos; Portal</p>
          </div>
          <nav className="portal-nav" aria-label="Student portal">
            {[
              ['reports', 'Results'],
              ['attendance', 'Attendance'],
              ['fees', 'Fees'],
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={tab === id ? 'is-active' : ''}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </nav>
        </aside>
        <div className="portal-main">
          <header className="portal-top">
            <p className="portal-signed">
              <span>Signed in as</span>
              <strong>{session.student.name}</strong>
            </p>
            <span className="portal-avatar" aria-hidden="true">
              {String(session.student.name || 'S').slice(0, 1)}
            </span>
            <button type="button" className="portal-logout" onClick={signOut}>
              <LogOut className="h-4 w-4" />
              Logout
            </button>
          </header>
          <div className="portal-scroll">
          <div className="portal-banner">
            <p className="portal-banner-kicker">{session.school?.name}</p>
            <h1>Hello, {firstName}.</h1>
            <p>
              {session.student.class} · {session.student.roll_number}
            </p>
          </div>
          <div className="portal-content">
            {error ? <p className="portal-note">{error}</p> : null}
            {tab === 'reports' ? (
              years.length ? (
                <>
                  <button
                    type="button"
                    className="portal-download"
                    onClick={() =>
                      downloadGroupedResults({
                        schoolName: session.school?.name,
                        student: session.student,
                        years,
                      })
                    }
                  >
                    Download results
                  </button>
                  {years.map((year) => (
                  <section key={year.academicYear} className="portal-year">
                    {(year.terms || []).map((term) => (
                      <article key={term.id || term.name} className="portal-card">
                        {term.published && term.subjects?.length ? null : (
                          <h3>
                            {year.academicYear} · {term.name}
                          </h3>
                        )}
                        {term.published ? (
                          term.subjects?.length ? (
                            <div className="portal-sheet">
                              <div className="portal-sheet-head">
                                <h2>{year.academicYear} Academic Year</h2>
                                <span>{term.name}</span>
                              </div>
                              <table>
                                <thead>
                                  <tr>
                                    <th>Title</th>
                                    <th>Status</th>
                                    <th>Score</th>
                                    <th>Grade</th>
                                    <th>Percent</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {term.subjects.map((row) => {
                                    const grade = letterGrade(row.percent);
                                    const passed = row.percent != null && row.percent >= 50;
                                    return (
                                      <tr key={row.subject}>
                                        <td>{row.subject}</td>
                                        <td>{row.percent == null ? '—' : passed ? 'Pass' : 'Fail'}</td>
                                        <td>{row.score ?? '—'}</td>
                                        <td>
                                          <span className={`portal-grade ${gradeTone(grade)}`}>{grade}</span>
                                        </td>
                                        <td>{row.percent == null ? '—' : row.percent.toFixed(1)}</td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                              <div className="portal-sheet-foot">
                                <span>
                                  <b>Total in class</b> {term.classSize ?? '—'}
                                </span>
                                <span>
                                  <b>Position</b> {ordinal(term.position)}
                                </span>
                              </div>
                            </div>
                          ) : (
                            <p>No scores were entered for this term.</p>
                          )
                        ) : (
                          <p>The administrator has not published this term’s results yet.</p>
                        )}
                      </article>
                    ))}
                  </section>
                  ))}
                </>
              ) : (
                <p className="portal-note">No academic terms are set up yet.</p>
              )
            ) : null}

            {tab === 'attendance' ? (
              publishedYears.length ? (
                publishedYears.map((year) => (
                  <section key={year.academicYear} className="portal-year">
                    <h2>{year.academicYear}</h2>
                    {year.terms.map((term) => (
                      <article key={term.id || term.name} className="portal-card">
                        <h3>{term.name}</h3>
                        <AttendanceCalendar term={term} />
                      </article>
                    ))}
                  </section>
                ))
              ) : (
                <p className="portal-note">Attendance appears here after the administrator publishes the term’s results.</p>
              )
            ) : null}

            {tab === 'fees' ? (
              <section className="portal-card">
                <h3>School fees</h3>
                <p>
                  Billed {money(record?.fees?.billed)} · Paid {money(record?.fees?.paid)} · Outstanding{' '}
                  {money(record?.fees?.outstanding)}
                </p>
                <ul>
                  {(record?.fees?.payments || []).map((row) => (
                    <li key={row.id}>
                      <span>
                        {String(row.created_at || '').slice(0, 10)} · {row.channel || 'Payment'}
                      </span>
                      <span>
                        {money(row.amount)} · {row.paid ? 'Paid' : row.status}
                      </span>
                    </li>
                  ))}
                </ul>
                {record?.fees?.payments?.length ? null : <p>No fee payments yet. The amount billed is shown above.</p>}
              </section>
            ) : null}
          </div>
          </div>
        </div>
      </div>
    );
  }

  let body;
  if (schoolId) {
    body = (
      <form onSubmit={signIn} className="portal-signin mx-auto max-w-md rounded-3xl border border-[var(--mk-line)] bg-white p-6">
        <SchoolCover school={chosenSchool} />
        <h1 className="mt-4 text-3xl font-semibold">Student portal</h1>
        <p className="portal-signin-note mt-2 text-sm">Enter your student ID and password.</p>
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
          <Link to="/portal" className="font-semibold">
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
