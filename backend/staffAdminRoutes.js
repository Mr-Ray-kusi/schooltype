import { supabase } from './supabaseClient.js';
import { createStudent, createStaff, createNonStaff } from './peopleCreate.js';
import {
  allowTeacherScoreEdit,
  inspectScoreLock,
  loadScoreLocks,
  publishScoreLocks,
  unpublishScoreLocks,
} from './scorePublishStore.js';

export function isSchoolHeadRole(role) {
  const value = String(role || '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .trim();
  return (
    value === 'administrator' ||
    value === 'headteacher' ||
    value === 'head teacher' ||
    value === 'headmistress' ||
    value === 'headmaster'
  );
}

const accraDate = (date = new Date()) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Accra',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);

const requireSchoolHead = (req, res, next) => {
  if (!isSchoolHeadRole(req.staffPortal?.role)) {
    return res.status(403).json({ error: 'Only the school administrator can view this' });
  }
  next();
};

const normalizeType = (value) => {
  const raw = String(value || '').toLowerCase();
  if (raw === 'nonstaff' || raw === 'non_staff' || raw === 'non-staff') return 'non-staff';
  return raw || 'student';
};

export function registerStaffAdminRoutes(app, { authenticateStaffPortal }) {
  app.get(
    '/api/staff-portal/session/admin/overview',
    authenticateStaffPortal,
    requireSchoolHead,
    async (req, res) => {
      try {
        const schoolId = req.staffPortal.schoolId;
        const today = accraDate();
        const [students, staff, nonStaff, classes, attendance] = await Promise.all([
          supabase.from('students').select('id', { count: 'exact', head: true }).eq('school_id', schoolId),
          supabase.from('staffs').select('id', { count: 'exact', head: true }).eq('school_id', schoolId),
          supabase.from('nonstaffs').select('id', { count: 'exact', head: true }).eq('school_id', schoolId),
          supabase.from('classes').select('id', { count: 'exact', head: true }).eq('school_id', schoolId),
          supabase.from('attendance').select('status, user_type').eq('school_id', schoolId).eq('date', today),
        ]);
        const rows = attendance.data || [];
        res.json({
          date: today,
          students: students.count || 0,
          staff: staff.count || 0,
          nonStaff: nonStaff.error ? 0 : nonStaff.count || 0,
          classes: classes.count || 0,
          attendance: {
            marked: rows.length,
            late: rows.filter((row) => row.status === 'late').length,
            early: rows.filter((row) => row.status === 'early' || row.status === 'present').length,
          },
        });
      } catch (error) {
        res.status(500).json({ error: error.message || 'Failed to load school overview' });
      }
    }
  );

  app.get(
    '/api/staff-portal/session/admin/students',
    authenticateStaffPortal,
    requireSchoolHead,
    async (req, res) => {
      try {
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 8));
        const from = (page - 1) * limit;
        const q = String(req.query.q || '').trim();
        const className = String(req.query.class || '').trim();
        let query = supabase
          .from('students')
          .select('id, name, class, roll_number, parent_name, parent_phone', { count: 'exact' })
          .eq('school_id', req.staffPortal.schoolId)
          .order('name', { ascending: true })
          .range(from, from + limit - 1);
        if (className && className !== 'all') query = query.eq('class', className);
        if (q) query = query.or(`name.ilike.%${q.replace(/[%*,]/g, '')}%,roll_number.ilike.%${q.replace(/[%*,]/g, '')}%`);
        const { data, error, count } = await query;
        if (error) throw error;
        res.json({ items: data || [], total: count || 0, page, limit });
      } catch (error) {
        res.status(500).json({ error: error.message || 'Failed to load students' });
      }
    }
  );

  app.post(
    '/api/staff-portal/session/admin/students',
    authenticateStaffPortal,
    requireSchoolHead,
    async (req, res) => {
      try {
        const student = await createStudent(req.staffPortal.schoolId, req.body || {});
        res.status(201).json(student);
      } catch (error) {
        res.status(error.status || 500).json({ error: error.message || 'Failed to add student' });
      }
    }
  );

  app.get(
    '/api/staff-portal/session/admin/staff',
    authenticateStaffPortal,
    requireSchoolHead,
    async (req, res) => {
      try {
        const { data, error } = await supabase
          .from('staffs')
          .select('id, name, role, subjects, class_names')
          .eq('school_id', req.staffPortal.schoolId)
          .order('name', { ascending: true });
        if (error) throw error;
        res.json({ items: data || [] });
      } catch (error) {
        res.status(500).json({ error: error.message || 'Failed to load staff' });
      }
    }
  );

  app.post(
    '/api/staff-portal/session/admin/staff',
    authenticateStaffPortal,
    requireSchoolHead,
    async (req, res) => {
      try {
        const staff = await createStaff(req.staffPortal.schoolId, req.body || {});
        res.status(201).json(staff);
      } catch (error) {
        res.status(error.status || 500).json({ error: error.message || 'Failed to add staff' });
      }
    }
  );

  app.get(
    '/api/staff-portal/session/admin/non-staff',
    authenticateStaffPortal,
    requireSchoolHead,
    async (req, res) => {
      try {
        const { data, error } = await supabase
          .from('nonstaffs')
          .select('id, name, role')
          .eq('school_id', req.staffPortal.schoolId)
          .order('name', { ascending: true });
        if (error) {
          if (error.code === '42P01') return res.json({ items: [] });
          throw error;
        }
        res.json({ items: data || [] });
      } catch (error) {
        res.status(500).json({ error: error.message || 'Failed to load non-staff' });
      }
    }
  );

  app.post(
    '/api/staff-portal/session/admin/non-staff',
    authenticateStaffPortal,
    requireSchoolHead,
    async (req, res) => {
      try {
        const person = await createNonStaff(req.staffPortal.schoolId, req.body || {});
        res.status(201).json(person);
      } catch (error) {
        res.status(error.status || 500).json({ error: error.message || 'Failed to add non-staff' });
      }
    }
  );

  app.get(
    '/api/staff-portal/session/admin/classes',
    authenticateStaffPortal,
    requireSchoolHead,
    async (req, res) => {
      try {
        const { data, error } = await supabase
          .from('classes')
          .select('id, name')
          .eq('school_id', req.staffPortal.schoolId)
          .order('name', { ascending: true });
        if (error) throw error;
        res.json({ items: data || [] });
      } catch (error) {
        res.status(500).json({ error: error.message || 'Failed to load classes' });
      }
    }
  );

  app.get(
    '/api/staff-portal/session/admin/subjects',
    authenticateStaffPortal,
    requireSchoolHead,
    async (req, res) => {
      try {
        const { data, error } = await supabase
          .from('subjects')
          .select('id, name')
          .eq('school_id', req.staffPortal.schoolId)
          .order('name', { ascending: true });
        if (error) {
          if (error.code === '42P01') return res.json({ items: [] });
          throw error;
        }
        res.json({ items: data || [] });
      } catch (error) {
        res.status(500).json({ error: error.message || 'Failed to load subjects' });
      }
    }
  );

  app.get(
    '/api/staff-portal/session/admin/attendance',
    authenticateStaffPortal,
    requireSchoolHead,
    async (req, res) => {
      try {
        const schoolId = req.staffPortal.schoolId;
        const today = accraDate();
        const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date || ''))
          ? String(req.query.date)
          : today;
        const [attendanceRes, studentsRes, staffRes, nonStaffRes] = await Promise.all([
          supabase
            .from('attendance')
            .select('user_id, user_type, date, timestamp, status')
            .eq('school_id', schoolId)
            .eq('date', date)
            .order('timestamp', { ascending: false })
            .limit(800),
          supabase.from('students').select('id, name, class, roll_number').eq('school_id', schoolId),
          supabase.from('staffs').select('id, name, role').eq('school_id', schoolId),
          supabase.from('nonstaffs').select('id, name, role').eq('school_id', schoolId),
        ]);
        if (attendanceRes.error) throw attendanceRes.error;
        const nonStaffRows = nonStaffRes.error ? [] : nonStaffRes.data || [];
        const people = new Map([
          ...(studentsRes.data || []).map((row) => [row.id, { ...row, user_type: 'student' }]),
          ...(staffRes.data || []).map((row) => [row.id, { id: row.id, name: row.name, role: row.role, user_type: 'staff' }]),
          ...nonStaffRows.map((row) => [
            row.id,
            { id: row.id, name: row.name, role: row.role, user_type: 'non-staff' },
          ]),
        ]);
        const records = (attendanceRes.data || []).map((row) => {
          const type = normalizeType(row.user_type);
          const person = people.get(row.user_id) || {};
          const label = type === 'student' ? person.class : person.role;
          return {
            user_id: row.user_id,
            user_type: type,
            user_name: person.name || 'Unknown',
            user_label: label || null,
            name: person.name || 'Unknown',
            label: label || null,
            roll_number: person.roll_number || null,
            date: row.date,
            timestamp: row.timestamp,
            status: row.status || 'present',
            punctuality: row.status === 'late' ? 'late' : 'early',
            user: {
              id: row.user_id,
              name: person.name || 'Unknown',
              class: person.class || null,
              role: person.role || null,
              roll_number: person.roll_number || null,
            },
          };
        });
        res.json({
          date,
          records,
          summary: {
            marked: records.length,
            late: records.filter((row) => row.status === 'late').length,
            early: records.filter((row) => row.status !== 'late').length,
            students: records.filter((row) => row.user_type === 'student').length,
            staff: records.filter((row) => row.user_type === 'staff').length,
            nonStaff: records.filter((row) => row.user_type === 'non-staff').length,
          },
        });
      } catch (error) {
        res.status(500).json({ error: error.message || 'Failed to load attendance' });
      }
    }
  );

  app.get(
    '/api/staff-portal/session/admin/attendance/:userId',
    authenticateStaffPortal,
    requireSchoolHead,
    async (req, res) => {
      try {
        const userId = String(req.params.userId || '').trim();
        const userType = normalizeType(req.query.userType || req.query.user_type || 'student');
        const { data, error } = await supabase
          .from('attendance')
          .select('date, timestamp, status')
          .eq('school_id', req.staffPortal.schoolId)
          .eq('user_id', userId)
          .eq('user_type', userType)
          .order('date', { ascending: true })
          .limit(120);
        if (error) throw error;
        const records = (data || []).map((row) => ({
          ...row,
          punctuality: row.status === 'late' ? 'late' : 'early',
        }));
        const late = records.filter((row) => row.status === 'late').length;
        res.json({
          user_id: userId,
          user_type: userType,
          items: records,
          records,
          term: { name: 'This term' },
          summary: { days: records.length, early: records.length - late, late },
        });
      } catch (error) {
        res.status(500).json({ error: error.message || 'Failed to load attendance history' });
      }
    }
  );

  app.get(
    '/api/staff-portal/session/admin/report-cards',
    authenticateStaffPortal,
    requireSchoolHead,
    async (req, res) => {
      try {
        const schoolId = req.staffPortal.schoolId;
        const className = String(req.query.class || '').trim();
        const term = String(req.query.term || '').trim();
        let query = supabase
          .from('student_scores')
          .select('*')
          .eq('school_id', schoolId)
          .order('updated_at', { ascending: false })
          .limit(400);
        if (className && className !== 'all') query = query.eq('class_name', className);
        if (term && term !== 'all') query = query.eq('term', term);
        const { data: scores, error } = await query;
        if (error) {
          if (error.code === '42P01') return res.json({ scores: [], filters: { classes: [], terms: [] }, lock: null, teachers: [] });
          throw error;
        }
        const rows = scores || [];
        const studentIds = [...new Set(rows.map((row) => row.student_id).filter(Boolean))];
        const staffIds = [...new Set(rows.map((row) => row.staff_id).filter(Boolean))];
        const [studentsRes, staffRes, filterRes, lockState, teachersRes] = await Promise.all([
          studentIds.length
            ? supabase.from('students').select('id, name, class, roll_number').in('id', studentIds)
            : Promise.resolve({ data: [] }),
          staffIds.length
            ? supabase.from('staffs').select('id, name').in('id', staffIds)
            : Promise.resolve({ data: [] }),
          supabase.from('student_scores').select('class_name, term').eq('school_id', schoolId).limit(400),
          loadScoreLocks(schoolId),
          supabase.from('staffs').select('id, name, role').eq('school_id', schoolId).order('name', { ascending: true }),
        ]);
        const studentsById = new Map((studentsRes.data || []).map((row) => [row.id, row]));
        const staffById = new Map((staffRes.data || []).map((row) => [row.id, row]));
        const enriched = rows.map((row) => {
          const student = studentsById.get(row.student_id);
          const teacher = staffById.get(row.staff_id);
          const score = row.score == null ? null : Number(row.score);
          const maxScore = row.max_score == null ? 100 : Number(row.max_score);
          const percent = score != null && maxScore > 0 ? Math.round((score / maxScore) * 1000) / 10 : null;
          const lock = inspectScoreLock(lockState.locks, {
            term: row.term || 'Term 1',
            className: row.class_name || student?.class,
            staffId: row.staff_id,
          });
          return {
            id: row.id,
            student_id: row.student_id,
            student_name: student?.name || 'Student',
            class_name: row.class_name || student?.class || '—',
            roll_number: student?.roll_number || null,
            subject: row.subject,
            term: row.term || 'Term 1',
            score,
            max_score: maxScore,
            percent,
            remark: row.remark || null,
            attitude: row.attitude || null,
            teacher_id: row.staff_id,
            teacher_name: teacher?.name || 'Teacher',
            updated_at: row.updated_at || row.created_at,
            published: lock.published,
          };
        });
        const lock =
          term && term !== 'all'
            ? inspectScoreLock(lockState.locks, {
                term,
                className: className && className !== 'all' ? className : '*',
              })
            : { published: false, canEdit: true, allowStaffIds: [] };
        res.json({
          scores: enriched,
          lock,
          locks: lockState.locks,
          teachers: (teachersRes.data || [])
            .filter((row) => String(row.role || '').toLowerCase() === 'teacher')
            .map((row) => ({ id: row.id, name: row.name })),
          filters: {
            classes: [...new Set((filterRes.data || []).map((row) => row.class_name).filter(Boolean))].sort(),
            terms: [...new Set((filterRes.data || []).map((row) => row.term).filter(Boolean))].sort(),
          },
        });
      } catch (error) {
        res.status(500).json({ error: error.message || 'Failed to load report cards' });
      }
    }
  );

  app.post(
    '/api/staff-portal/session/admin/report-cards/publish',
    authenticateStaffPortal,
    requireSchoolHead,
    async (req, res) => {
      try {
        const term = String(req.body?.term || '').trim();
        if (!term || term === 'all') {
          return res.status(400).json({ error: 'Pick a term before publishing' });
        }
        const className = String(req.body?.class || req.body?.className || '').trim();
        let classNames = Array.isArray(req.body?.classNames) ? req.body.classNames : [];
        if (!classNames.length && className && className !== 'all') classNames = [className];
        if (!classNames.length) {
          const { data } = await supabase
            .from('student_scores')
            .select('class_name')
            .eq('school_id', req.staffPortal.schoolId)
            .eq('term', term)
            .limit(400);
          classNames = [...new Set((data || []).map((row) => row.class_name).filter(Boolean))];
        }
        if (!classNames.length) {
          return res.status(400).json({ error: 'No teacher scores to publish for this term' });
        }
        if (!className || className === 'all') classNames = [...classNames, '*'];
        const unpublish = Boolean(req.body?.unpublish);
        const state = unpublish
          ? await unpublishScoreLocks(req.staffPortal.schoolId, { term, classNames })
          : await publishScoreLocks(req.staffPortal.schoolId, {
              term,
              classNames,
              staffId: req.staffPortal.staffId,
              staffName: req.staffPortal.name,
            });
        res.json({ ok: true, published: !unpublish, term, classNames, locks: state.locks });
      } catch (error) {
        res.status(500).json({ error: error.message || 'Failed to publish reports' });
      }
    }
  );

  app.post(
    '/api/staff-portal/session/admin/report-cards/allow-edit',
    authenticateStaffPortal,
    requireSchoolHead,
    async (req, res) => {
      try {
        const term = String(req.body?.term || '').trim();
        const staffId = String(req.body?.staffId || req.body?.teacherId || '').trim();
        const className = String(req.body?.class || req.body?.className || '').trim() || '*';
        if (!term || term === 'all') {
          return res.status(400).json({ error: 'Pick a term before allowing edits' });
        }
        if (!staffId) return res.status(400).json({ error: 'Pick a teacher to allow' });
        const state = await allowTeacherScoreEdit(req.staffPortal.schoolId, {
          term,
          className,
          staffId,
          allow: req.body?.allow !== false,
        });
        res.json({
          ok: true,
          lock: inspectScoreLock(state.locks, { term, className, staffId }),
          locks: state.locks,
        });
      } catch (error) {
        res.status(500).json({ error: error.message || 'Failed to update teacher edit access' });
      }
    }
  );
}
