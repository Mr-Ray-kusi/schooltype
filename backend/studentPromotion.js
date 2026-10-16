import { supabase } from './supabaseClient.js';
import { nextClassName } from './classHierarchy.js';

const parseCsv = (value) =>
  String(value || '')
    .split(/[,;\n]+/)
    .map((part) => part.trim())
    .filter(Boolean);

const sameLabel = (left, right) =>
  String(left || '').trim().toLowerCase() === String(right || '').trim().toLowerCase();

function termPercent(scores) {
  const totalMarks = scores.reduce((sum, row) => sum + (Number(row.score) || 0), 0);
  const totalMax = scores.reduce((sum, row) => {
    const max = Number(row.max_score);
    return sum + (Number.isFinite(max) && max > 0 ? max : 100);
  }, 0);
  if (!totalMax) return { totalMarks: 0, totalMax: 0, percent: null };
  return {
    totalMarks,
    totalMax,
    percent: Math.round((totalMarks / totalMax) * 1000) / 10,
  };
}

function requiredSubjects(classRow, schoolSubjects, scoredSubjects) {
  const fromClass = parseCsv(classRow?.subjects);
  if (fromClass.length) return fromClass;
  const fromSchool = (schoolSubjects || []).map((row) => row.name).filter(Boolean);
  if (fromSchool.length) return fromSchool;
  return scoredSubjects;
}

export async function applyTermPromotion(schoolId, studentId, term) {
  if (!schoolId || !studentId || !term) return null;

  let { data: student, error: studentError } = await supabase
    .from('students')
    .select('id, name, class, alumni_year, last_promotion_key')
    .eq('id', studentId)
    .eq('school_id', schoolId)
    .maybeSingle();
  if (studentError) {
    const retry = await supabase
      .from('students')
      .select('id, name, class')
      .eq('id', studentId)
      .eq('school_id', schoolId)
      .maybeSingle();
    student = retry.data;
    studentError = retry.error;
  }
  if (studentError || !student) return null;
  if (student.alumni_year) return { action: 'alumni', student };

  const className = String(student.class || '').trim();
  if (!className) return null;

  const [scoresRes, classesRes, schoolSubjectsRes] = await Promise.all([
    supabase
      .from('student_scores')
      .select('subject, score, max_score, term, class_name')
      .eq('school_id', schoolId)
      .eq('student_id', studentId)
      .eq('term', term),
    supabase.from('classes').select('id, name, form, subjects').eq('school_id', schoolId),
    supabase.from('subjects').select('name').eq('school_id', schoolId),
  ]);
  let classes = classesRes.data;
  if (classesRes.error) {
    const retry = await supabase.from('classes').select('id, name, form').eq('school_id', schoolId);
    classes = retry.data;
  }
  const scores = scoresRes.data;
  const schoolSubjects = schoolSubjectsRes.error ? [] : schoolSubjectsRes.data;

  const termScores = (scores || []).filter((row) => sameLabel(row.term, term));
  if (!termScores.length) return null;

  const classRow = (classes || []).find((row) => sameLabel(row.name, className));
  const scoredSubjects = [...new Set(termScores.map((row) => String(row.subject || '').trim()).filter(Boolean))];
  const needed = requiredSubjects(classRow, schoolSubjects || [], scoredSubjects);
  const have = new Set(scoredSubjects.map((name) => name.toLowerCase()));
  const complete = needed.every((name) => have.has(String(name).toLowerCase()));
  if (!complete) return { action: 'pending', needed, have: scoredSubjects };

  const summary = termPercent(
    needed.map((name) => termScores.find((row) => sameLabel(row.subject, name))).filter(Boolean)
  );
  const promotionKey = `${term}|${className}`;
  if (student.last_promotion_key === `${promotionKey}|promoted` || student.last_promotion_key === `${promotionKey}|retained`) {
    return { action: 'already', percent: summary.percent };
  }

  const passed = summary.percent != null && summary.percent >= 50;
  const next = passed ? nextClassName(className, classes || []) : null;
  const action = passed && next && next !== className ? 'promoted' : 'retained';
  const payload = {
    last_promotion_key: `${promotionKey}|${action}`,
    last_term_percent: summary.percent,
    last_term_result: action,
  };
  if (action === 'promoted') payload.class = next;

  const { error } = await supabase
    .from('students')
    .update(payload)
    .eq('id', studentId)
    .eq('school_id', schoolId);
  if (error && String(error.message || '').includes('last_promotion_key')) {
    if (action === 'promoted') {
      await supabase.from('students').update({ class: next }).eq('id', studentId).eq('school_id', schoolId);
    }
    return { action, percent: summary.percent, nextClass: next, student, skippedPersist: true };
  }
  if (error) return { action: 'error', error: error.message, percent: summary.percent };

  return {
    action,
    percent: summary.percent,
    totalMarks: summary.totalMarks,
    totalMax: summary.totalMax,
    nextClass: action === 'promoted' ? next : className,
    student,
  };
}
