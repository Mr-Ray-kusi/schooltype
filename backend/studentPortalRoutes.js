import jwt from 'jsonwebtoken';
import { supabase } from './supabaseClient.js';
import { mergeSchoolWithExtras, schoolHasPaidPlan } from './schoolPlanStore.js';
import { getSubscriptionInfo } from './subscription.js';
import { listAcademicTerms } from './academicTerms.js';
import { inspectScoreLock, loadScoreLocks } from './scorePublishStore.js';
import { extraFeesTotal, getClassFeeAmount, isSuccessfulFeeStatus, resolveStudentFeeAmount, roundMoney } from './feePayments.js';
import { sendSmsBatch } from './smsProvider.js';
import { consumeSchoolAndPlatformUnits, refundSchoolAndPlatformUnits } from './platformSmsStore.js';
import {
  clearStudentPortalFailures,
  deleteStudentPortalPassword,
  isStudentPortalEnabled,
  issueStudentPortalPassword,
  listEnabledPortalSchoolIds,
  recordStudentPortalFailure,
  revealStudentPortalPassword,
  setStudentPortalEnabled,
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

async function publicSchoolCard(schoolId) {
  const { data, error } = await supabase.from('schools').select('*').eq('id', schoolId).maybeSingle();
  if (error || !data || String(data.role || '') === 'super_admin') return null;
  const merged = mergeSchoolWithExtras(data);
  if (!schoolHasPaidPlan(merged)) return null;
  if (!getSubscriptionInfo(merged).subscription_active) return null;
  return {
    id: merged.id,
    name: merged.name,
    logo_url: merged.logo_url || null,
  };
}

async function findStudentByPortalId(schoolId, rawId) {
  const wanted = String(rawId || '').trim().toUpperCase();
  if (!wanted) return null;
  const { data, error } = await supabase
    .from('students')
    .select('id, name, class, roll_number, parent_phone, school_id, extra_fees, monthly_fee')
    .eq('school_id', schoolId)
    .ilike('roll_number', wanted)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function loadOwnedStudent(portal) {
  const { data, error } = await supabase
    .from('students')
    .select('id, name, class, roll_number, parent_phone, school_id, extra_fees, monthly_fee')
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

function chosenTerm(terms, termId) {
  if (!terms.length) return null;
  return terms.find((term) => String(term.id) === String(termId)) || terms[terms.length - 1];
}

export function registerStudentPortalRoutes(app, { authenticateToken }) {
  app.get('/api/student-portal/schools', async (_req, res) => {
    try {
      const ids = await listEnabledPortalSchoolIds();
      const schools = [];
      for (const id of ids) {
        const card = await publicSchoolCard(id);
        if (card) schools.push(card);
      }
      schools.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
      res.json({ schools });
    } catch (error) {
      res.status(500).json({ error: error.message || 'Failed to load schools' });
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
      if (!(await isStudentPortalEnabled(schoolId))) {
        return res.status(403).json({ error: 'This school has not opened the student portal' });
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
      const terms = await termCatalog(schoolId);
      const term = chosenTerm(terms, req.query.termId);
      const termName = term?.name || '';

      const locks = await loadScoreLocks(schoolId);
      const published = termName
        ? inspectScoreLock(locks.locks, { term: termName, className: student.class }).published
        : false;

      let subjects = [];
      if (published) {
        const { data, error } = await supabase
          .from('student_scores')
          .select('subject, score, max_score, remark, attitude, term, class_name')
          .eq('school_id', schoolId)
          .eq('student_id', student.id)
          .eq('term', termName);
        if (error && error.code !== '42P01') throw error;
        subjects = (data || [])
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

      let attendance = { summary: { days: 0, present: 0, late: 0, absent: 0 }, records: [] };
      if (term?.starts_on && term?.ends_on) {
        const { data, error } = await supabase
          .from('attendance')
          .select('date, status, punctuality')
          .eq('school_id', schoolId)
          .eq('user_id', student.id)
          .eq('user_type', 'student')
          .gte('date', term.starts_on)
          .lte('date', term.ends_on)
          .order('date', { ascending: true });
        if (error && error.code !== '42P01') throw error;
        const records = (data || []).map((row) => {
          const mark = String(row.punctuality || row.status || '').toLowerCase();
          const status = mark === 'late' ? 'late' : mark === 'absent' ? 'absent' : 'present';
          return { date: row.date, status };
        });
        attendance = {
          summary: {
            days: records.length,
            present: records.filter((row) => row.status === 'present').length,
            late: records.filter((row) => row.status === 'late').length,
            absent: records.filter((row) => row.status === 'absent').length,
          },
          records,
        };
      }

      const classFee = await getClassFeeAmount(schoolId, student.class);
      const billed = resolveStudentFeeAmount(student, classFee);
      let payments = [];
      if (term?.id) {
        const { data, error } = await supabase
          .from('fee_payments')
          .select('id, amount, status, channel, payment_method, payment_reference, payment_month, created_at')
          .eq('school_id', schoolId)
          .eq('payer_id', student.id)
          .eq('payment_month', term.id)
          .order('created_at', { ascending: false });
        if (error && error.code !== '42P01') throw error;
        payments = (data || []).map((row) => ({
          id: row.id,
          amount: roundMoney(row.amount),
          status: row.status,
          channel: row.channel || row.payment_method || '',
          reference: row.payment_reference || '',
          created_at: row.created_at,
          paid: isSuccessfulFeeStatus(row.status),
        }));
      }
      const paid = roundMoney(payments.filter((row) => row.paid).reduce((sum, row) => sum + row.amount, 0));

      res.json({
        term,
        terms,
        today: todayAccra(),
        reports: { published, subjects },
        attendance,
        fees: {
          billed,
          extra: extraFeesTotal(student),
          paid,
          outstanding: roundMoney(Math.max(0, billed - paid)),
          payments,
        },
      });
    } catch (error) {
      res.status(500).json({ error: error.message || 'Failed to load this term' });
    }
  });

  app.get('/api/student-portal/settings', authenticateToken, async (req, res) => {
    try {
      if (req.user.role === 'super_admin') return res.json({ enabled: false });
      res.json({ enabled: await isStudentPortalEnabled(req.user.schoolId) });
    } catch (error) {
      res.status(500).json({ error: error.message || 'Failed to load portal settings' });
    }
  });

  app.put('/api/student-portal/settings', authenticateToken, async (req, res) => {
    try {
      if (req.user.role === 'super_admin') {
        return res.status(400).json({ error: 'Open a school account to change the student portal' });
      }
      const enabled = await setStudentPortalEnabled(req.user.schoolId, Boolean(req.body?.enabled));
      res.json({ enabled });
    } catch (error) {
      res.status(500).json({ error: error.message || 'Failed to update the student portal' });
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
      const { data: student, error } = await supabase
        .from('students')
        .select('id')
        .eq('id', req.params.id)
        .eq('school_id', req.user.schoolId)
        .maybeSingle();
      if (error) throw error;
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
      const { data: student, error } = await supabase
        .from('students')
        .select('id, name, roll_number, parent_phone')
        .eq('id', req.params.id)
        .eq('school_id', schoolId)
        .maybeSingle();
      if (error) throw error;
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
