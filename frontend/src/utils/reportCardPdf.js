import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

export const ATTITUDES = ['Excellent', 'Good', 'Bad', 'Worse'];

export const letterGrade = (percent) => {
  if (percent == null || Number.isNaN(percent)) return '—';
  if (percent >= 80) return 'A';
  if (percent >= 70) return 'B';
  if (percent >= 60) return 'C';
  if (percent >= 50) return 'D';
  if (percent >= 40) return 'E';
  return 'F';
};

/** Competition ranking: same score shares position; next skips. */
export function assignPositions(rows, getScore) {
  const sorted = [...rows].sort((a, b) => {
    const sb = getScore(b) ?? -Infinity;
    const sa = getScore(a) ?? -Infinity;
    if (sb !== sa) return sb - sa;
    return String(a.student_name || '').localeCompare(String(b.student_name || ''));
  });

  let position = 0;
  let lastScore = null;
  return sorted.map((row, index) => {
    const score = getScore(row);
    if (score !== lastScore) {
      position = index + 1;
      lastScore = score;
    }
    return { ...row, position };
  });
}

export function ordinal(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return '—';
  const v = num % 100;
  if (v >= 11 && v <= 13) return `${num}th`;
  switch (num % 10) {
    case 1:
      return `${num}st`;
    case 2:
      return `${num}nd`;
    case 3:
      return `${num}rd`;
    default:
      return `${num}th`;
  }
}

function pickAttitude(rows) {
  const counts = {};
  for (const row of rows) {
    const a = row.attitude;
    if (!a) continue;
    counts[a] = (counts[a] || 0) + 1;
  }
  const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (ranked[0]) return ranked[0][0];
  const latest = [...rows].sort(
    (a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0)
  )[0];
  return latest?.attitude || '—';
}

function studentKey(row) {
  return row.student_id || `${row.student_name}-${row.class_name}`;
}

function assignUniquePositions(rows, getScore) {
  const sorted = [...rows].sort((a, b) => {
    const sb = getScore(b) ?? -Infinity;
    const sa = getScore(a) ?? -Infinity;
    if (sb !== sa) return sb - sa;
    return String(a.student_name || '').localeCompare(String(b.student_name || ''));
  });
  return sorted.map((row, index) => ({ ...row, position: index + 1 }));
}

function numericScore(row) {
  const score = Number(row?.score);
  if (Number.isFinite(score)) return score;
  const percent = Number(row?.percent);
  return Number.isFinite(percent) ? percent : null;
}

function groupScoresByStudent(rows) {
  const byStudent = new Map();
  for (const row of rows) {
    const key = studentKey(row);
    if (!byStudent.has(key)) {
      byStudent.set(key, {
        student_id: row.student_id,
        student_name: row.student_name,
        class_name: row.class_name,
        roll_number: row.roll_number,
        term: row.term,
        subjects: [],
      });
    }
    const entry = byStudent.get(key);
    const existingIndex = entry.subjects.findIndex(
      (item) => String(item.subject || '').toLowerCase() === String(row.subject || '').toLowerCase()
    );
    if (existingIndex >= 0) entry.subjects[existingIndex] = row;
    else entry.subjects.push(row);
  }

  return Array.from(byStudent.values()).map((entry) => {
    const totalMarks = entry.subjects.reduce((sum, row) => sum + (Number(row.score) || 0), 0);
    const totalMax = entry.subjects.reduce((sum, row) => {
      const max = Number(row.max_score);
      return sum + (Number.isFinite(max) && max > 0 ? max : 100);
    }, 0);
    const percents = entry.subjects.map((row) => row.percent).filter((value) => value != null);
    const average =
      percents.length > 0
        ? Math.round((percents.reduce((a, b) => a + b, 0) / percents.length) * 10) / 10
        : null;
    const overallPercent =
      totalMax > 0 ? Math.round((totalMarks / totalMax) * 1000) / 10 : average;
    return {
      ...entry,
      totalMarks,
      totalMax,
      average,
      overallPercent,
      attitude: pickAttitude(entry.subjects),
    };
  });
}

function attachSubjectPositions(summaries, classRows) {
  const rankByKey = new Map();
  const subjects = [...new Set(classRows.map((row) => row.subject).filter(Boolean))];
  for (const subject of subjects) {
    const ranked = assignUniquePositions(
      classRows.filter((row) => row.subject === subject),
      (row) => numericScore(row)
    );
    for (const row of ranked) {
      rankByKey.set(`${studentKey(row)}::${subject}`, row.position);
    }
  }

  return summaries.map((student) => ({
    ...student,
    subjects: student.subjects.map((row) => ({
      ...row,
      position: rankByKey.get(`${studentKey(student)}::${row.subject}`) || null,
    })),
  }));
}

/** Rank every student in a class by total marks, including those with no scores yet. */
export function rankClassRoster(students = [], scores = [], { className, term } = {}) {
  const roster = (students || []).filter((student) => {
    if (!className || className === 'all') return true;
    return String(student.class || student.class_name || '') === String(className);
  });

  const classRows = (scores || []).filter((row) => {
    if (className && className !== 'all' && String(row.class_name || '') !== String(className)) return false;
    if (term && term !== 'all' && String(row.term || '') !== String(term)) return false;
    return row.score != null || row.percent != null;
  });

  const summaries = attachSubjectPositions(groupScoresByStudent(classRows), classRows);
  const byId = new Map();
  const byName = new Map();
  for (const row of summaries) {
    if (row.student_id) byId.set(String(row.student_id).toLowerCase(), row);
    byName.set(String(row.student_name || '').trim().toLowerCase(), row);
  }

  const merged = roster.map((student) => {
    const id = String(student.id || student.student_id || '');
    const name = String(student.name || student.student_name || '').trim();
    const scored = (id && byId.get(id.toLowerCase())) || byName.get(name.toLowerCase()) || null;
    return {
      student_id: id || scored?.student_id || null,
      student_name: name || scored?.student_name || 'Student',
      class_name: student.class || student.class_name || scored?.class_name || className || '',
      roll_number: student.roll_number || scored?.roll_number || null,
      term: scored?.term || (term && term !== 'all' ? term : ''),
      totalMarks: scored?.totalMarks ?? 0,
      totalMax: scored?.totalMax ?? 0,
      overallPercent: scored?.overallPercent ?? null,
      subjects: scored?.subjects || [],
      attitude: scored?.attitude || '—',
    };
  });

  const seenIds = new Set(merged.map((row) => String(row.student_id || '').toLowerCase()).filter(Boolean));
  const seenNames = new Set(merged.map((row) => String(row.student_name || '').trim().toLowerCase()).filter(Boolean));
  for (const row of summaries) {
    const id = String(row.student_id || '').toLowerCase();
    const name = String(row.student_name || '').trim().toLowerCase();
    if ((id && seenIds.has(id)) || seenNames.has(name)) continue;
    merged.push(row);
  }

  return assignUniquePositions(merged, (row) => Number(row.totalMarks) || 0);
}

/** Rank students within each class + term by total marks across all subjects. */
export function rankStudentsForReports(scores, { className, term, studentIds } = {}) {
  const selected =
    Array.isArray(studentIds) && studentIds.length > 0 ? new Set(studentIds.map(String)) : null;

  const filtered = (scores || []).filter((row) => {
    if (className && className !== 'all' && row.class_name !== className) return false;
    if (term && term !== 'all' && row.term !== term) return false;
    return row.score != null || row.percent != null;
  });

  const groups = new Map();
  for (const row of filtered) {
    const groupKey = `${row.class_name || ''}||${row.term || ''}`;
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey).push(row);
  }

  const ranked = [];
  for (const classRows of groups.values()) {
    const summaries = groupScoresByStudent(classRows);
    const withOverall = assignUniquePositions(summaries, (row) => row.totalMarks);
    ranked.push(...attachSubjectPositions(withOverall, classRows));
  }

  ranked.sort((a, b) => {
    if ((a.position || 0) !== (b.position || 0)) return (a.position || 0) - (b.position || 0);
    return String(a.student_name || '').localeCompare(String(b.student_name || ''));
  });

  if (!selected) return ranked;
  return ranked.filter((student) => selected.has(String(studentKey(student))));
}

function safePdfName(value) {
  return (
    String(value || 'student')
      .replace(/[<>:"/\\|?*]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || 'student'
  );
}

function uniquePdfFileName(student, used) {
  const base = safePdfName(student?.student_name);
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate.toLowerCase())) {
    const roll = String(student?.roll_number || '').trim();
    candidate = roll && suffix === 2 ? `${base} ${roll}` : `${base} (${suffix})`;
    suffix += 1;
  }
  used.add(candidate.toLowerCase());
  return `${candidate}.pdf`;
}

function drawStudentReport(doc, student, { schoolName, term }) {
  const pageWidth = doc.internal.pageSize.getWidth();
  let y = 48;
  doc.setFontSize(16);
  doc.text(schoolName, pageWidth / 2, y, { align: 'center' });
  y += 22;
  doc.setFontSize(13);
  doc.text('Student Report Card', pageWidth / 2, y, { align: 'center' });
  y += 28;

  doc.setFontSize(11);
  doc.text(`Student: ${student.student_name}`, 40, y);
  y += 16;
  doc.text(`Class: ${student.class_name || '—'}`, 40, y);
  y += 16;
  doc.text(`Term: ${term === 'all' ? student.term || '—' : term}`, 40, y);
  y += 16;
  doc.text(`Overall position: ${ordinal(student.position)}`, 40, y);
  y += 16;
  doc.text(
    `Total marks: ${student.totalMarks ?? 0}${student.totalMax ? `/${student.totalMax}` : ''} (${
      student.overallPercent == null ? '—' : `${student.overallPercent}%`
    } · ${letterGrade(student.overallPercent)})`,
    40,
    y
  );
  y += 16;
  doc.text(`Attitude: ${student.attitude || '—'}`, 40, y);
  y += 20;

  autoTable(doc, {
    startY: y,
    head: [['Subject', 'Score', '%', 'Grade', 'Subject pos.', 'Attitude', 'Remark']],
    body: student.subjects.map((row) => [
      row.subject,
      row.score == null ? '—' : `${row.score}/${row.max_score ?? 100}`,
      row.percent == null ? '—' : `${row.percent}%`,
      letterGrade(row.percent),
      ordinal(row.position),
      row.attitude || '—',
      row.remark || '—',
    ]),
    styles: { fontSize: 9, cellPadding: 4 },
    headStyles: { fillColor: [52, 152, 219] },
    margin: { left: 40, right: 40 },
  });

  const footY = (doc.lastAutoTable?.finalY || y) + 28;
  doc.setFontSize(9);
  doc.setTextColor(100);
  doc.text('Generated by SCHOOLTYPE', pageWidth / 2, footY, { align: 'center' });
  doc.setTextColor(0);
}

export function downloadSubjectRankingsPdf({
  scores,
  schoolName = 'School',
  className = 'all',
  term = 'all',
  subject = 'all',
}) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  let y = 48;

  doc.setFontSize(16);
  doc.text(schoolName, pageWidth / 2, y, { align: 'center' });
  y += 22;
  doc.setFontSize(13);
  doc.text('Terminal Exam Subject Rankings', pageWidth / 2, y, { align: 'center' });
  y += 18;
  doc.setFontSize(10);
  doc.setTextColor(80);
  doc.text(
    `Class: ${className === 'all' ? 'All' : className}  ·  Term: ${term === 'all' ? 'All' : term}`,
    pageWidth / 2,
    y,
    { align: 'center' }
  );
  doc.setTextColor(0);
  y += 16;

  const scoped = scores.filter((row) => {
    if (className !== 'all' && row.class_name !== className) return false;
    if (term !== 'all' && row.term !== term) return false;
    if (subject !== 'all' && row.subject !== subject) return false;
    return row.percent != null;
  });

  const subjects = [
    ...new Set(scoped.map((row) => row.subject).filter(Boolean)),
  ].sort((a, b) => a.localeCompare(b));

  if (!subjects.length) {
    doc.setFontSize(11);
    doc.text('No scores available for the selected filters.', 40, y + 20);
    doc.save(`subject-rankings-${Date.now()}.pdf`);
    return;
  }

  subjects.forEach((subj, index) => {
    const rows = assignPositions(
      scoped.filter((row) => row.subject === subj),
      (row) => row.percent
    );

    if (index > 0) {
      const needed = 40 + rows.length * 18;
      if (y + needed > doc.internal.pageSize.getHeight() - 40) {
        doc.addPage();
        y = 48;
      } else {
        y += 18;
      }
    }

    doc.setFontSize(12);
    doc.text(`${subj}`, 40, y);
    y += 8;

    autoTable(doc, {
      startY: y,
      head: [['Pos', 'Student', 'Class', 'Score', '%', 'Grade', 'Attitude']],
      body: rows.map((row) => [
        ordinal(row.position),
        row.student_name,
        row.class_name || '—',
        row.score == null ? '—' : `${row.score}/${row.max_score ?? 100}`,
        row.percent == null ? '—' : `${row.percent}%`,
        letterGrade(row.percent),
        row.attitude || '—',
      ]),
      styles: { fontSize: 9, cellPadding: 4 },
      headStyles: { fillColor: [52, 152, 219] },
      margin: { left: 40, right: 40 },
    });

    y = (doc.lastAutoTable?.finalY || y) + 16;
  });

  const classPart = className === 'all' ? 'all-classes' : className;
  doc.save(`subject-rankings-${classPart}-${term}-${Date.now()}.pdf`);
}

export function downloadStudentReportCardsPdf({
  scores,
  schoolName = 'School',
  className = 'all',
  term = 'all',
  studentIds,
}) {
  const summaries = rankStudentsForReports(scores, { className, term, studentIds });
  const usedNames = new Set();

  if (!summaries.length) {
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    doc.setFontSize(12);
    doc.text('No student scores available for the selected filters.', 40, 60);
    doc.save('student-report.pdf');
    return 0;
  }

  summaries.forEach((student, index) => {
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    drawStudentReport(doc, student, { schoolName, term });
    const filename = uniquePdfFileName(student, usedNames);
    if (index === 0) {
      doc.save(filename);
      return;
    }
    window.setTimeout(() => doc.save(filename), index * 280);
  });

  return summaries.length;
}
