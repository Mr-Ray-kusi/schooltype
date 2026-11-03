import jwt from 'jsonwebtoken';
import { platformSupabase, supabase } from './supabaseClient.js';
import { mergeSchoolWithExtras, schoolHasPaidPlan } from './schoolPlanStore.js';
import { getSubscriptionInfo } from './subscription.js';
import { listAcademicTerms } from './academicTerms.js';
import { academicPeriodFromDate } from './classHierarchy.js';
import { inspectScoreLock, loadScoreLocks } from './scorePublishStore.js';
import { extraFeesTotal, getClassFeeAmount, isSuccessfulFeeStatus, resolveStudentFeeAmount, roundMoney } from './feePayments.js';
import { sendSmsBatch } from './smsProvider.js';
import { consumeSchoolAndPlatformUnits, refundSchoolAndPlatformUnits } from './platformSmsStore.js';
import {
  clearStudentPortalFailures,
  deleteStudentPortalPassword,
  issueStudentPortalPassword,
  recordStudentPortalFailure,
  revealStudentPortalPassword,
  studentPortalLocked,
  verifyStudentPortalPassword,
} from './studentPortalStore.js';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this';

function todayAccra() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Accra',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  return `${year}-${month}-${day}`;
}

function authenticateStudentPortal(req, res, next) {
  const token = String(req.headers['x-student-portal-token'] || '').trim();
  if (!token) return res.status(401).json({ error: 'Sign in with your student ID and password' });
  jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }, (err, payload) => {
    if (err || payload?.purpose !== 'student_portal' || !payload.schoolId || !payload.studentId) {
      return res.status(401).json({ error: 'Your portal session has ended. Sign in again.' });
    }
    req.studentPortal = payload;
    next();
  });
}

function portalSchoolCard(row) {
  if (!row || String(row.role || '') === 'super_admin') return null;
  const merged = mergeSchoolWithExtras(row);
  if (!schoolHasPaidPlan(merged)) return null;
  if (!getSubscriptionInfo(merged).subscription_active) return null;
  return {
    id: merged.id,
    name: merged.name,
    logo_url: merged.logo_url || null,
    fee_currency: String(merged.fee_currency || 'GHS').toUpperCase(),
  };
}

async function publicSchoolCard(schoolId) {
  const { data, error } = await supabase.from('schools').select('*').eq('id', schoolId).maybeSingle();
  if (error || !data) return null;
  return portalSchoolCard(data);
}

function portalDb() {
  return platformSupabase || supabase;
}

async function schoolStudent(schoolId, studentId, columns) {
  const { data, error } = await portalDb()
    .from('students')
    .select(columns)
    .eq('id', studentId)
    .eq('school_id', schoolId)
    .maybeSingle();
  if (error) {
    const err = new Error(error.message || 'Could not load the student');
    err.status = 500;
    throw err;
  }
  return data || null;
}

async function findStudentByPortalId(schoolId, rawId) {
  const wanted = String(rawId || '').trim().toUpperCase();
  if (!wanted) return null;
  const { data, error } = await supabase
    .from('students')
    .select('id, name, class, roll_number, barcode, parent_phone, school_id, extra_fees, monthly_fee')
    .eq('school_id', schoolId)
    .ilike('roll_number', wanted)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function loadOwnedStudent(portal) {
  const { data, error } = await supabase
    .from('students')
    .select('id, name, class, roll_number, barcode, parent_phone, school_id, extra_fees, monthly_fee')
    .eq('id', portal.studentId)
    .eq('school_id', portal.schoolId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function termCatalog(schoolId) {
  const rows = await listAcademicTerms(schoolId).catch(() => []);
  return (rows || []).map((term) => ({
    id: term.id,
    name: term.name,
    starts_on: term.starts_on || null,
    ends_on: term.ends_on || null,
  }));
}

function emptyAttendance() {
  return { summary: { days: 0, present: 0, late: 0, absent: 0 }, records: [] };
}

function attendanceFromRows(rows) {
  const records = (rows || []).map((row) => {
    const mark = String(row.punctuality || row.status || '').toLowerCase();
    const status = mark === 'late' ? 'late' : mark === 'absent' ? 'absent' : 'present';
    return { date: String(row.date || '').slice(0, 10), status };
  });
  return {
    summary: {
      days: records.length,
      present: records.filter((row) => row.status === 'present').length,
      late: records.filter((row) => row.status === 'late').length,
      absent: records.filter((row) => row.status === 'absent').length,
    },
    records,
  };
}

function scoreRowsForStudent(rows, student) {
  return (rows || [])
    .filter((row) => !row.class_name || row.class_name === student.class)
    .map((row) => {
      const score = Number(row.score);
      const max = Number(row.max_score) || 100;
      const percent = Number.isFinite(score) && max > 0 ? Math.round((score / max) * 1000) / 10 : null;
      return {
        subject: row.subject,
        score: Number.isFinite(score) ? score : null,
        max_score: max,
        percent,
        remark: row.remark || '',
        attitude: row.attitude || '',
      };
    });
}

function groupPublishedTerms(terms, student, locks, scoreRows, attendanceRows) {
  const ordered = [...(terms || [])].sort((a, b) => {
    const start = String(a.starts_on || '').localeCompare(String(b.starts_on || ''));
    if (start) return start;
    return Number(a.sort_order || 0) - Number(b.sort_order || 0);
  });
  const groups = new Map();
  for (const term of ordered) {
    const name = String(term.name || '');
    const published = name
      ? inspectScoreLock(locks, { term: name, className: student.class }).published
      : false;
    const period = academicPeriodFromDate(term.starts_on || term.ends_on, terms);
    const academicYear = period?.academicYear || 'Academic year';
    const start = String(term.starts_on || '').slice(0, 10);
    const end = String(term.ends_on || '').slice(0, 10);
    const subjects = published
      ? scoreRowsForStudent(
          scoreRows.filter((row) => String(row.term || '') === name),
          student
        )
      : [];
    const inTerm =
      published && /^\d{4}-\d{2}-\d{2}$/.test(start)
        ? attendanceRows.filter((row) => {
            const day = String(row.date || '').slice(0, 10);
            if (day < start) return false;
            if (/^\d{4}-\d{2}-\d{2}$/.test(end) && day > end) return false;
            return true;
          })
        : [];
    const entry = {
      id: term.id,
      name,
      starts_on: start || null,
      ends_on: end || null,
      published,
      subjects,
      attendance: published ? attendanceFromRows(inTerm) : emptyAttendance(),
    };
    const list = groups.get(academicYear) || [];
    list.push(entry);
    groups.set(academicYear, list);
  }
  return [...groups.entries()].map(([academicYear, termRows]) => ({ academicYear, terms: termRows }));
}

async function classStanding(schoolId, student, termName) {
  const className = String(student.class || '').trim().toLowerCase();
  const { data: classmates, error: classError } = await supabase
    .from('students')
    .select('id, class')
    .eq('school_id', schoolId);
  if (classError && classError.code !== '42P01') throw classError;
  const classIds = new Set(
    (classmates || [])
      .filter((row) => String(row.class || '').trim().toLowerCase() === className)
      .map((row) => String(row.id))
  );
  if (student.id) classIds.add(String(student.id));

  const { data: scoreRows, error } = await supabase
    .from('student_scores')
    .select('student_id, score, class_name, term')
    .eq('school_id', schoolId)
    .eq('term', termName);
  if (error && error.code !== '42P01') throw error;

  const totals = new Map();
  for (const row of scoreRows || []) {
    const classLabel = String(row.class_name || '').trim().toLowerCase();
    if (classLabel && classLabel !== className) continue;
    const id = String(row.student_id || '');
    if (!id || !classIds.has(id)) continue;
    totals.set(id, (totals.get(id) || 0) + (Number(row.score) || 0));
  }
  for (const id of classIds) {
    if (!totals.has(id)) totals.set(id, 0);
  }

  const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  let position = null;
  let place = 0;
  let last = null;
  for (let index = 0; index < ranked.length; index += 1) {
    const [id, total] = ranked[index];
    if (total !== last) {
      place = index + 1;
      last = total;
    }
    if (id === String(student.id)) position = place;
  }

  return { classSize: classIds.size, position };
}

export function registerStudentPortalRoutes(app, { authenticateToken }) {
  app.get('/api/student-portal/schools', async (_req, res) => {
    try {
      const client = platformSupabase || supabase;
      const columns =
        'id, name, role, logo_url, payment_plan, plan_status, plan_selected_at, next_payment_due, last_payment_at, subscription_frozen, subscription_started_at, total_paid';
      let rows;
      const first = await client.from('schools').select(columns);
      if (first.error) {
        const retry = await client.from('schools').select('id, name, role, logo_url');
        if (retry.error) throw retry.error;
        rows = retry.data || [];
      } else {
        rows = first.data || [];
      }
      const schools = [];
      for (const row of rows) {
        try {
          const card = portalSchoolCard(row);
          if (card) schools.push(card);
        } catch (err) {
          console.warn('Skipped a school on the portal list:', err.message);
        }
      }
      schools.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
      res.json({ schools });
    } catch (error) {
      console.error('Student portal school list failed:', error.message || error);
      res.status(500).json({ error: 'Could not load schools' });
    }
  });

  app.post('/api/student-portal/login', async (req, res) => {
    try {
      const schoolId = String(req.body?.schoolId || '').trim();
      const studentCode = String(req.body?.studentId || req.body?.rollNumber || '').trim();
      const password = String(req.body?.password || '').trim();
      if (!schoolId || !studentCode || !password) {
        return res.status(400).json({ error: 'School, student ID, and password are required' });
      }
      const card = await publicSchoolCard(schoolId);
      if (!card) return res.status(404).json({ error: 'School not found' });

      const lockKey = `${schoolId}:${studentCode.toUpperCase()}`;
      if (studentPortalLocked(lockKey)) {
        return res.status(429).json({ error: 'Too many tries. Wait 15 minutes and try again.' });
      }

      const student = await findStudentByPortalId(schoolId, studentCode);
      const matches = student ? await verifyStudentPortalPassword(schoolId, student.id, password) : false;
      if (!student || !matches) {
        recordStudentPortalFailure(lockKey);
        return res.status(401).json({ error: 'Student ID or password is wrong' });
      }
      clearStudentPortalFailures(lockKey);

      const sessionToken = jwt.sign(
        {
          purpose: 'student_portal',
          schoolId,
          studentId: student.id,
          rollNumber: student.roll_number,
        },
        JWT_SECRET,
        { expiresIn: '12h', algorithm: 'HS256' }
      );

      res.json({
        sessionToken,
        school: card,
        student: {
          id: student.id,
          name: student.name,
          class: student.class,
          roll_number: student.roll_number,
          barcode: student.barcode || student.roll_number || null,
        },
      });
    } catch (error) {
      res.status(500).json({ error: error.message || 'Failed to sign in' });
    }
  });

  app.get('/api/student-portal/me', authenticateStudentPortal, async (req, res) => {
    try {
      const student = await loadOwnedStudent(req.studentPortal);
      if (!student) return res.status(401).json({ error: 'Your portal session has ended. Sign in again.' });
      const card = await publicSchoolCard(req.studentPortal.schoolId);
      const terms = await termCatalog(req.studentPortal.schoolId);
      res.json({
        school: card,
        student: {
          id: student.id,
          name: student.name,
          class: student.class,
          roll_number: student.roll_number,
          barcode: student.barcode || student.roll_number || null,
        },
        terms,
      });
    } catch (error) {
      res.status(500).json({ error: error.message || 'Failed to open the portal' });
    }
  });

  app.get('/api/student-portal/record', authenticateStudentPortal, async (req, res) => {
    try {
      const student = await loadOwnedStudent(req.studentPortal);
      if (!student) return res.status(401).json({ error: 'Your portal session has ended. Sign in again.' });
      const schoolId = req.studentPortal.schoolId;
      if (String(student.school_id) !== String(schoolId) || String(student.id) !== String(req.studentPortal.studentId)) {
        return res.status(401).json({ error: 'Your portal session has ended. Sign in again.' });
      }
      const terms = await termCatalog(schoolId);
      const locks = await loadScoreLocks(schoolId);
      const publishedNames = new Set(
        terms
          .filter((term) =>
            inspectScoreLock(locks.locks, { term: term.name, className: student.class }).published
          )
          .map((term) => String(term.name || ''))
      );

      let scoreRows = [];
      if (publishedNames.size) {
        const { data, error } = await supabase
          .from('student_scores')
          .select('subject, score, max_score, remark, attitude, term, class_name')
          .eq('school_id', schoolId)
          .eq('student_id', student.id);
        if (error && error.code !== '42P01') throw error;
        scoreRows = (data || []).filter((row) => publishedNames.has(String(row.term || '')));
      }

      let attendanceRows = [];
      if (publishedNames.size) {
        const { data, error } = await supabase
          .from('attendance')
          .select('date, status')
          .eq('school_id', schoolId)
          .eq('user_id', student.id)
          .eq('user_type', 'student')
          .order('date', { ascending: true })
          .limit(800);
        if (error && error.code !== '42P01') throw error;
        attendanceRows = data || [];
      }

      const years = groupPublishedTerms(terms, student, locks.locks, scoreRows, attendanceRows);
      for (const year of years) {
        for (const term of year.terms) {
          if (!term.published) {
            term.classSize = null;
            term.position = null;
            continue;
          }
          const standing = await classStanding(schoolId, student, term.name);
          term.classSize = standing.classSize;
          term.position = standing.position;
        }
      }

      const [classFee, card] = await Promise.all([
        getClassFeeAmount(schoolId, student.class),
        publicSchoolCard(schoolId),
      ]);
      const billed = resolveStudentFeeAmount(student, classFee);
      let payments = [];
      const { data: feeRows, error: feeError } = await supabase
        .from('fee_payments')
        .select('id, amount, status, channel, payment_method, payment_reference, created_at')
        .eq('school_id', schoolId)
        .eq('payer_id', student.id)
        .order('created_at', { ascending: false })
        .limit(100);
      if (feeError && feeError.code !== '42P01') throw feeError;
      payments = (feeRows || []).map((row) => ({
        id: row.id,
        amount: roundMoney(row.amount),
        status: row.status,
        channel: row.channel || row.payment_method || '',
        reference: row.payment_reference || '',
        created_at: row.created_at,
        paid: isSuccessfulFeeStatus(row.status),
      }));
      const paid = roundMoney(payments.filter((row) => row.paid).reduce((sum, row) => sum + row.amount, 0));

      res.json({
        today: todayAccra(),
        years,
        fees: {
          billed,
          extra: extraFeesTotal(student),
          paid,
          outstanding: roundMoney(Math.max(0, billed - paid)),
          currency: String(card?.fee_currency || 'GHS').toUpperCase(),
          pay_path: (() => {
            const payCode = student.barcode || student.roll_number;
            if (!payCode) return '/fees';
            return `/fees?school=${encodeURIComponent(schoolId)}&student=${encodeURIComponent(payCode)}`;
          })(),
          payments,
        },
      });
    } catch (error) {
      res.status(500).json({ error: error.message || 'Failed to load this term' });
    }
  });

  app.get('/api/students/:id/portal-password', authenticateToken, async (req, res) => {
    try {
      if (req.user.role === 'super_admin') return res.status(400).json({ error: 'Open a school account' });
      const password = await revealStudentPortalPassword(req.user.schoolId, req.params.id);
      res.json({ password });
    } catch (error) {
      res.status(500).json({ error: error.message || 'Failed to load the password' });
    }
  });

  app.post('/api/students/:id/portal-password', authenticateToken, async (req, res) => {
    try {
      if (req.user.role === 'super_admin') return res.status(400).json({ error: 'Open a school account' });
      const student = await schoolStudent(req.user.schoolId, req.params.id, 'id');
      if (!student) return res.status(404).json({ error: 'Student not found' });
      const issued = await issueStudentPortalPassword(req.user.schoolId, student.id);
      res.json(issued);
    } catch (error) {
      res.status(error.status || 500).json({ error: error.message || 'Failed to issue a password' });
    }
  });

  app.post('/api/students/:id/portal-password/sms', authenticateToken, async (req, res) => {
    try {
      if (req.user.role === 'super_admin') return res.status(400).json({ error: 'Open a school account' });
      const schoolId = req.user.schoolId;
      const student = await schoolStudent(schoolId, req.params.id, 'id, name, roll_number, parent_phone');
      if (!student) return res.status(404).json({ error: 'Student not found' });
      const password = await revealStudentPortalPassword(schoolId, student.id);
      if (!password) return res.status(400).json({ error: 'Issue a portal password before sending it' });
      const phone = String(student.parent_phone || '').trim();
      if (!phone) return res.status(400).json({ error: 'This student has no parent phone number' });

      const { data: school } = await supabase.from('schools').select('name').eq('id', schoolId).maybeSingle();
      const schoolName = school?.name || 'School';
      const body = `${schoolName}: ${student.name}'s portal ID is ${student.roll_number}. Password is ${password}.`;
      let settlement;
      try {
        settlement = await consumeSchoolAndPlatformUnits({
          schoolId,
          schoolName,
          units: 1,
          recipientsCount: 1,
          segments: 1,
          reference: `portal-${student.id}`,
          messagePreview: 'Student portal password',
        });
      } catch (smsError) {
        return res.status(smsError.status || 400).json({ error: smsError.message });
      }

      const delivery = await sendSmsBatch({ phones: [phone], body, schoolName });
      if (!delivery.sent) {
        await refundSchoolAndPlatformUnits({
          schoolId,
          schoolName,
          units: 1,
          reference: settlement?.reference || `portal-${student.id}`,
          reason: 'Refund after the portal password SMS failed',
        }).catch(() => {});
        return res.status(502).json({ error: delivery.results?.[0]?.error || 'The password SMS could not be sent' });
      }
      res.json({ sent: true });
    } catch (error) {
      res.status(error.status || 500).json({ error: error.message || 'Failed to send the password' });
    }
  });
}

export { issueStudentPortalPassword, deleteStudentPortalPassword };
