import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

const safeName = (value) =>
  String(value || 'person')
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'person';

const formatDay = (value) => {
  const raw = String(value || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return value || '—';
  try {
    return new Date(`${raw}T12:00:00`).toLocaleDateString(undefined, { dateStyle: 'medium' });
  } catch {
    return raw;
  }
};

const formatTime = (value) => {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '—';
  }
};

const statusOf = (row) => {
  const value = String(row?.punctuality || row?.status || '').toLowerCase();
  return value === 'late' ? 'Late' : 'Early';
};

export function buildTermAttendancePdfBytes({
  schoolName = 'School',
  personName,
  personLabel,
  userType,
  term,
  records = [],
  summary = {},
}) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const termName = term?.name || 'Current term';

  doc.setFontSize(16);
  doc.text(schoolName, pageWidth / 2, 40, { align: 'center' });
  doc.setFontSize(13);
  doc.text('Attendance record', pageWidth / 2, 60, { align: 'center' });
  doc.setFontSize(10);
  doc.setTextColor(80);
  doc.text(
    `${personName || 'Person'}  ·  ${personLabel || '—'}  ·  ${userType || ''}  ·  ${termName}`,
    pageWidth / 2,
    76,
    { align: 'center' }
  );
  const range =
    term?.starts_on || term?.ends_on
      ? `${formatDay(term.starts_on)} – ${formatDay(term.ends_on)}`
      : '';
  if (range) doc.text(range, pageWidth / 2, 90, { align: 'center' });
  doc.setTextColor(0);

  autoTable(doc, {
    startY: range ? 108 : 96,
    head: [['Date', 'Time', 'Status']],
    body: records.length
      ? records.map((row) => [formatDay(row.date), formatTime(row.timestamp), statusOf(row)])
      : [['No attendance records for this term', '', '']],
    styles: { fontSize: 9, cellPadding: 4 },
    headStyles: { fillColor: [15, 23, 42] },
  });

  const y = (doc.lastAutoTable?.finalY || 120) + 18;
  doc.setFontSize(10);
  doc.text(
    `Days: ${summary.days ?? records.length}   Early: ${summary.early ?? '—'}   Late: ${summary.late ?? '—'}`,
    40,
    y
  );

  return {
    bytes: new Uint8Array(doc.output('arraybuffer')),
    fileName: `${safeName(personName)}-${safeName(termName)}-attendance.pdf`,
    termName,
  };
}

const saveBlob = (blob, fileName) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
};

export function downloadTermAttendancePdf(options) {
  const { bytes, fileName } = buildTermAttendancePdfBytes(options);
  saveBlob(new Blob([bytes], { type: 'application/pdf' }), fileName);
}

export async function downloadAllStudentAttendanceZip({
  schoolName = 'School',
  term,
  students = [],
}) {
  const { createZipBlob } = await import('./zipStore');
  const termName = term?.name || 'Current term';
  const folder = `${safeName(termName)}-student-attendance`;
  const used = new Set();
  const files = [];
  students.forEach((student, index) => {
    try {
      const built = buildTermAttendancePdfBytes({
        schoolName,
        personName: student.name,
        personLabel: student.class || student.label,
        userType: 'student',
        term,
        records: student.records || [],
        summary: student.summary || {},
      });
      let base = `${safeName(student.name)}${student.class ? `-${safeName(student.class)}` : ''}`;
      if (used.has(base)) base = `${base}-${index + 1}`;
      used.add(base);
      files.push({ name: `${folder}/${base}-attendance.pdf`, data: built.bytes });
    } catch (error) {
      console.warn('Skipped attendance PDF for', student.name, error);
    }
  });
  if (!files.length) {
    throw new Error('No student attendance PDFs to pack.');
  }
  const blob = await createZipBlob(files);
  saveBlob(blob, `${folder}.zip`);
}
