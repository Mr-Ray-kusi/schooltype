import { supabase } from './supabaseClient.js';
import { cacheInvalidate } from './ttlCache.js';
import { listAcademicTerms, resolveFeePeriod } from './academicTerms.js';
import { isSuccessfulFeeStatus } from './feePayments.js';
import {
  academicPeriodFromDate,
  academicYearFromPeriod,
  buildClassHierarchy,
  periodFromTermName,
} from './classHierarchy.js';

const isMissing = (error, column) => {
  const msg = String(error?.message || error?.details || error?.hint || '');
  return (
    error?.code === '42P01' ||
    error?.code === 'PGRST204' ||
    (column &&
      msg.includes(column) &&
      (msg.includes('does not exist') || msg.includes('Could not find') || msg.includes('schema cache')))
  );
};

const settle = async (promise, fallback = null) => {
  try {
    const result = await promise;
    if (result?.error) return fallback;
    return result?.data ?? result ?? fallback;
  } catch {
    return fallback;
  }
};

async function loadClasses(schoolId) {
  const { data, error } = await supabase
    .from('classes')
    .select('id, name, form, created_at')
    .eq('school_id', schoolId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function loadCurrentStudents(schoolId) {
  const { data, error } = await supabase
    .from('students')
    .select('id, name, class, roll_number, created_at, alumni_year, alumni_class, alumni_completed_at, barcode, last_term_percent, last_term_result')
    .eq('school_id', schoolId)
    .order('name', { ascending: true });
  if (error) {
    if (isMissing(error, 'alumni_year')) {
      const retry = await supabase
        .from('students')
        .select('id, name, class, roll_number, created_at, barcode')
        .eq('school_id', schoolId)
        .order('name', { ascending: true });
      if (retry.error) throw retry.error;
      return (retry.data || []).map((row) => ({ ...row, alumni_year: null, alumni_class: null }));
    }
    if (isMissing(error, 'last_term_percent') || isMissing(error, 'last_term_result')) {
      const retry = await supabase
        .from('students')
        .select('id, name, class, roll_number, created_at, alumni_year, alumni_class, alumni_completed_at, barcode')
        .eq('school_id', schoolId)
        .order('name', { ascending: true });
      if (retry.error) throw retry.error;
      return retry.data || [];
    }
    throw error;
  }
  return data || [];
}

function isAlumni(student) {
  return student?.alumni_year != null && Number(student.alumni_year) > 0;
}

function enrollmentYear(student) {
  const stamp = student?.created_at ? new Date(student.created_at) : null;
  if (!stamp || Number.isNaN(stamp.getTime())) return null;
  return stamp.getFullYear();
}

async function buildOverview(schoolId) {
  const [classes, students, period] = await Promise.all([
    loadClasses(schoolId),
    loadCurrentStudents(schoolId),
    resolveFeePeriod(schoolId).catch(() => null),
  ]);
  const hierarchy = buildClassHierarchy(classes);
  const year = academicYearFromPeriod(period);
  const completingSet = new Set(hierarchy.completing_classes);
  const enrolled = students.filter((row) => !isAlumni(row));
  const completingNow = enrolled.filter((row) => completingSet.has(String(row.class || '').trim()));

  const batchMap = new Map();
  for (const row of students) {
    if (!isAlumni(row)) continue;
    const key = Number(row.alumni_year);
    const entry = batchMap.get(key) || { year: key, status: 'alumni', count: 0, classes: new Set() };
    entry.count += 1;
    if (row.alumni_class || row.class) entry.classes.add(row.alumni_class || row.class);
    batchMap.set(key, entry);
  }

  if (completingNow.length && !batchMap.has(year)) {
    batchMap.set(year, {
      year,
      status: 'completing',
      count: completingNow.length,
      classes: new Set(hierarchy.completing_classes),
    });
  } else if (completingNow.length && batchMap.has(year)) {
    const entry = batchMap.get(year);
    entry.count += completingNow.length;
    hierarchy.completing_classes.forEach((name) => entry.classes.add(name));
  }

  const batches = [...batchMap.values()]
    .map((row) => ({
      year: row.year,
      status: row.status,
      count: row.count,
      classes: [...row.classes].filter(Boolean),
    }))
    .sort((a, b) => b.year - a.year);

  return {
    year,
    term_name: period?.name || null,
    hierarchy: hierarchy.classes,
    completing_classes: hierarchy.completing_classes,
    completing_count: completingNow.length,
    batches,
  };
}

async function loadBatchStudents(schoolId, year, overview) {
  const students = await loadCurrentStudents(schoolId);
  const completingSet = new Set(overview.completing_classes || []);
  const currentYear = overview.year;
  return students.filter((row) => {
    if (Number(row.alumni_year) === Number(year)) return true;
    if (Number(year) === Number(currentYear) && !isAlumni(row) && completingSet.has(String(row.class || '').trim())) {
      return true;
    }
    return false;
  });
}

function scorePercent(row) {
  const score = Number(row?.score);
  const max = Number(row?.max_score);
  if (!Number.isFinite(score)) return null;
  const denom = Number.isFinite(max) && max > 0 ? max : 100;
  return Math.round((score / denom) * 1000) / 10;
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

function rankByScore(rows) {
  const sorted = [...rows].sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));
  const positions = new Map();
  let position = 0;
  let last = null;
  sorted.forEach((row, index) => {
    const score = Number(row.score) || 0;
    if (score !== last) {
      position = index + 1;
      last = score;
    }
    positions.set(row.student_id, position);
  });
  return positions;
}

function periodKey(period) {
  if (!period) return null;
  return `${period.academicYear}||${period.term}`;
}

async function attachBatchDetails(schoolId, students) {
  const ids = students.map((row) => row.id).filter(Boolean);
  if (!ids.length) return [];

  const [ownScores, allScores, payments, attendance, reports, terms] = await Promise.all([
    settle(
      supabase
        .from('student_scores')
        .select('student_id, subject, class_name, term, score, max_score, attitude, remark, updated_at, created_at')
        .eq('school_id', schoolId)
        .in('student_id', ids)
        .order('updated_at', { ascending: true }),
      []
    ),
    settle(
      supabase
        .from('student_scores')
        .select('student_id, subject, class_name, term, score, max_score, updated_at')
        .eq('school_id', schoolId)
        .limit(8000),
      []
    ),
    settle(
      supabase
        .from('fee_payments')
        .select('payer_id, amount, status, payment_month, channel, payment_method, created_at')
        .eq('school_id', schoolId)
        .in('payer_id', ids),
      []
    ),
    settle(
      supabase
        .from('attendance')
        .select('user_id, date, status, punctuality')
        .eq('school_id', schoolId)
        .eq('user_type', 'student')
        .in('user_id', ids),
      []
    ),
    settle(
      supabase
        .from('report_cards')
        .select('id, class_name, course, title, file_name, uploaded_at, teacher_name')
        .eq('school_id', schoolId)
        .order('uploaded_at', { ascending: false })
        .limit(80),
      []
    ),
    listAcademicTerms(schoolId).catch(() => []),
  ]);

  const peerScores = allScores?.length ? allScores : ownScores || [];

  return students.map((student) => {
    const reportCards = (ownScores || []).filter((row) => row.student_id === student.id);
    const feeRows = (payments || [])
      .filter((row) => row.payer_id === student.id && isSuccessfulFeeStatus(row.status))
      .map((row) => ({
        amount: Number(row.amount) || 0,
        month: row.payment_month,
        channel: row.channel || row.payment_method,
        created_at: row.created_at,
      }));
    const attendanceRows = (attendance || []).filter((row) => row.user_id === student.id);
    const att = {
      present_days: attendanceRows.length,
      late_days: attendanceRows.filter(
        (row) => String(row.punctuality || row.status).toLowerCase() === 'late'
      ).length,
    };
    const className = student.alumni_class || student.class;
    const classReports = (reports || []).filter(
      (row) => !row.class_name || row.class_name === className
    );

    const buckets = new Map();
    const ensure = (period, classLabel) => {
      const key = periodKey(period);
      if (!key) return null;
      if (!buckets.has(key)) {
        buckets.set(key, {
          key,
          academic_year: period.academicYear,
          term: period.term,
          sort_key: period.sortKey,
          class_name: classLabel || className,
          subjects: [],
          attendance: { present_days: 0, late_days: 0 },
          fees: { paid_amount: 0, payments: [] },
        });
      }
      return buckets.get(key);
    };

    for (const row of reportCards) {
      const period = periodFromTermName(row.term, row.updated_at || row.created_at, terms);
      const bucket = ensure(period, row.class_name);
      if (!bucket) continue;
      const percent = scorePercent(row);
      const peers = peerScores.filter(
        (peer) =>
          String(peer.subject || '') === String(row.subject || '') &&
          String(peer.term || '') === String(row.term || '') &&
          String(peer.class_name || '') === String(row.class_name || '')
      );
      const positions = rankByScore(peers);
      bucket.subjects.push({
        subject: row.subject,
        class_name: row.class_name,
        term: row.term,
        score: row.score,
        max_score: row.max_score || 100,
        percent,
        grade: letterGrade(percent),
        position: positions.get(student.id) || null,
        attitude: row.attitude,
        remark: row.remark,
      });
    }

    for (const row of attendanceRows) {
      const period = academicPeriodFromDate(row.date, terms);
      const bucket = ensure(period, className);
      if (!bucket) continue;
      bucket.attendance.present_days += 1;
      if (String(row.punctuality || row.status).toLowerCase() === 'late') {
        bucket.attendance.late_days += 1;
      }
    }

    for (const row of feeRows) {
      const period = academicPeriodFromDate(row.month || row.created_at, terms);
      const bucket = ensure(period, className);
      if (!bucket) continue;
      bucket.fees.payments.push(row);
      bucket.fees.paid_amount += Number(row.amount) || 0;
    }

    const termRecords = [...buckets.values()]
      .map((bucket) => {
        const totalMarks = bucket.subjects.reduce((sum, row) => sum + (Number(row.score) || 0), 0);
        const totalMax = bucket.subjects.reduce((sum, row) => {
          const max = Number(row.max_score);
          return sum + (Number.isFinite(max) && max > 0 ? max : 100);
        }, 0);
        const overallPercent = totalMax > 0 ? Math.round((totalMarks / totalMax) * 1000) / 10 : null;
        const classTermPeers = new Map();
        for (const peer of peerScores) {
          if (String(peer.term || '') !== String(bucket.term || '')) continue;
          if (String(peer.class_name || '') !== String(bucket.class_name || '')) continue;
          const entry = classTermPeers.get(peer.student_id) || { student_id: peer.student_id, score: 0 };
          entry.score += Number(peer.score) || 0;
          classTermPeers.set(peer.student_id, entry);
        }
        const overallPositions = rankByScore([...classTermPeers.values()]);
        return {
          ...bucket,
          overall_percent: overallPercent,
          overall_grade: letterGrade(overallPercent),
          overall_position: overallPositions.get(student.id) || null,
          total_marks: totalMarks,
          total_max: totalMax,
        };
      })
      .sort((a, b) => String(a.sort_key).localeCompare(String(b.sort_key)));

    return {
      id: student.id,
      name: student.name,
      class: className,
      roll_number: student.roll_number,
      enrolled_year: enrollmentYear(student),
      enrolled_on: student.created_at,
      alumni_year: student.alumni_year || null,
      last_term_percent: student.last_term_percent ?? null,
      last_term_result: student.last_term_result || null,
      status: isAlumni(student) ? 'alumni' : 'completing',
      report_cards: reportCards.map((row) => ({
        subject: row.subject,
        class_name: row.class_name,
        term: row.term,
        score: row.score,
        max_score: row.max_score,
        attitude: row.attitude,
        remark: row.remark,
      })),
      terms: termRecords,
      class_reports: classReports.slice(0, 8),
      attendance: att,
      fees: {
        paid_amount: feeRows.reduce((sum, row) => sum + Number(row.amount || 0), 0),
        payments: feeRows,
      },
    };
  });
}

export function registerAlumniRoutes(app, { authenticateToken, enforcePlanApproval }) {
  app.get('/api/alumni', authenticateToken, enforcePlanApproval, async (req, res) => {
    try {
      const overview = await buildOverview(req.user.schoolId);
      res.json(overview);
    } catch (error) {
      console.error('Alumni overview error:', error);
      res.status(500).json({ error: error.message || 'Failed to load alumni' });
    }
  });

  app.get('/api/alumni/batches/:year', authenticateToken, enforcePlanApproval, async (req, res) => {
    try {
      const year = Number(req.params.year);
      if (!Number.isFinite(year) || year < 1990) {
        return res.status(400).json({ error: 'Choose a valid year batch.' });
      }
      const overview = await buildOverview(req.user.schoolId);
      const students = await loadBatchStudents(req.user.schoolId, year, overview);
      const details = await attachBatchDetails(req.user.schoolId, students);
      res.json({
        year,
        classes: overview.completing_classes,
        count: details.length,
        students: details,
      });
    } catch (error) {
      console.error('Alumni batch error:', error);
      res.status(500).json({ error: error.message || 'Failed to load this year batch' });
    }
  });

  app.post('/api/alumni/complete', authenticateToken, enforcePlanApproval, async (req, res) => {
    try {
      const overview = await buildOverview(req.user.schoolId);
      const year = Number(req.body?.year) || overview.year;
      if (!overview.completing_classes.length) {
        return res.status(400).json({ error: 'Add classes in Setup first so the completing class can be read.' });
      }

      const students = await loadCurrentStudents(req.user.schoolId);
      const completingSet = new Set(overview.completing_classes);
      const toMark = students.filter(
        (row) => !isAlumni(row) && completingSet.has(String(row.class || '').trim())
      );
      if (!toMark.length) {
        return res.status(400).json({ error: 'No students are in the completing class.' });
      }

      const completedAt = new Date().toISOString();
      const results = [];
      for (const student of toMark) {
        const payload = {
          alumni_year: year,
          alumni_class: student.class,
          alumni_completed_at: completedAt,
        };
        const { data, error } = await supabase
          .from('students')
          .update(payload)
          .eq('id', student.id)
          .eq('school_id', req.user.schoolId)
          .select('id, name, class, alumni_year')
          .single();
        if (error) {
          if (isMissing(error, 'alumni_year')) {
            return res.status(503).json({
              error: 'Run the alumni_year migration on the students table, then try again.',
            });
          }
          throw error;
        }
        results.push(data);
      }

      cacheInvalidate(`dash:${req.user.schoolId}`);
      cacheInvalidate(`att-sum:${req.user.schoolId}`);

      res.json({
        ok: true,
        year,
        marked: results.length,
        classes: overview.completing_classes,
      });
    } catch (error) {
      console.error('Alumni complete error:', error);
      res.status(500).json({ error: error.message || 'Failed to save this alumni batch' });
    }
  });
}
