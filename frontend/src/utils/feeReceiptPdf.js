import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { formatMoney, normalizeFeeCurrency } from './feeCurrency';

export const formatGhs = (value) => formatMoney(value, 'GHS');

const money = (value, currency = 'GHS') => formatMoney(value, currency);

const formatWhen = (value) => {
  if (!value) return '—';
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Africa/Accra',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value));
  } catch {
    return String(value);
  }
};

const paymentLine = (row) => {
  const channel = String(row.channel || row.payment_method || '').toLowerCase();
  if (row.manual || channel === 'cash') return 'Cash at school';
  if (channel === 'momo' || channel === 'mobile_money') return row.manual ? 'MoMo at school' : 'Paid online · MoMo';
  if (channel === 'bank' || channel === 'bank_transfer') return row.manual ? 'Bank at school' : 'Paid online · Bank';
  if (channel === 'card') return 'Paid online · Card';
  return row.recorded_by_label || 'Payment';
};

const safeName = (value) =>
  String(value || 'receipt')
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 60);

export function buildFeeReceiptPdf({
  schoolName = 'School',
  studentName = 'Student',
  className,
  rollNumber,
  periodLabel,
  feeAmount,
  paidAmount,
  outstanding,
  payments = [],
  reference,
  recordedBy,
  charges = [],
  currency = 'GHS',
  title = 'School fees receipt',
} = {}) {
  const code = normalizeFeeCurrency(currency);
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  let y = 48;

  doc.setFontSize(16);
  doc.text(schoolName, pageWidth / 2, y, { align: 'center' });
  y += 22;
  doc.setFontSize(13);
  doc.text(title, pageWidth / 2, y, { align: 'center' });
  y += 28;

  doc.setFontSize(11);
  doc.text(`Student: ${studentName}`, 48, y);
  y += 16;
  if (className) {
    doc.text(`Class: ${className}`, 48, y);
    y += 16;
  }
  if (rollNumber) {
    doc.text(`Student ID / roll: ${rollNumber}`, 48, y);
    y += 16;
  }
  if (periodLabel) {
    doc.text(`Period: ${periodLabel}`, 48, y);
    y += 16;
  }
  if (reference) {
    doc.text(`Reference: ${reference}`, 48, y);
    y += 16;
  }
  if (recordedBy) {
    doc.text(`Recorded by: ${recordedBy}`, 48, y);
    y += 16;
  }

  y += 8;
  if ((charges || []).length) {
    autoTable(doc, {
      startY: y,
      head: [['Fee for this term', 'Amount']],
      body: [
        ...charges.map((row) => [row.label || 'Fee', money(row.amount, code)]),
        ['Total billed', money(feeAmount, code)],
      ],
      styles: { fontSize: 10, cellPadding: 6 },
      headStyles: { fillColor: [30, 27, 75] },
      margin: { left: 48, right: 48 },
    });
    y = (doc.lastAutoTable?.finalY || y) + 14;
  }
  autoTable(doc, {
    startY: y,
    head: [['Fee billed', 'Amount paid', 'Outstanding']],
    body: [
      [
        money(feeAmount, code),
        money(paidAmount, code),
        Number(outstanding) >= 0.01 ? money(outstanding, code) : 'None',
      ],
    ],
    styles: { fontSize: 10, cellPadding: 6 },
    headStyles: { fillColor: [52, 152, 219] },
    margin: { left: 48, right: 48 },
  });

  y = (doc.lastAutoTable?.finalY || y) + 18;
  doc.setFontSize(12);
  doc.text('Payment details', 48, y);
  y += 8;

  const rows = (payments || []).length
    ? payments.map((row) => [
        paymentLine(row),
        money(row.amount, code),
        formatWhen(row.created_at),
        row.recorded_by_label || row.recorded_by || '—',
        String(row.payment_reference || row.reference || '—').replace(/^manual:/, ''),
      ])
    : [['No payments listed', money(paidAmount, code), '—', recordedBy || '—', reference || '—']];

  autoTable(doc, {
    startY: y,
    head: [['Method', 'Amount', 'Date', 'Recorded by', 'Reference']],
    body: rows,
    styles: { fontSize: 9, cellPadding: 5 },
    headStyles: { fillColor: [30, 41, 59] },
    margin: { left: 48, right: 48 },
  });

  y = (doc.lastAutoTable?.finalY || y) + 24;
  doc.setFontSize(9);
  doc.setTextColor(100);
  const note =
    Number(outstanding) >= 0.01
      ? `Balance still due: ${money(outstanding, code)}. Keep this receipt for your records.`
      : 'This student is fully paid for the period shown.';
  doc.text(note, 48, y);
  doc.text(`Issued ${formatWhen(new Date().toISOString())}`, 48, y + 14);

  return doc;
}

export function receiptOptionsFromStudent(student, extras = {}) {
  return {
    schoolName: extras.schoolName || 'School',
    studentName: student?.name || extras.studentName || 'Student',
    className: student?.class || extras.className,
    rollNumber: student?.roll_number || extras.rollNumber,
    periodLabel: extras.periodLabel || extras.month || student?.payment_month,
    feeAmount: student?.fee_amount ?? extras.feeAmount,
    paidAmount: student?.paid_amount ?? extras.paidAmount,
    outstanding: student?.outstanding ?? extras.outstanding,
    payments: student?.payments || extras.payments || [],
    reference: extras.reference,
    recordedBy: student?.recorded_by || extras.recordedBy,
  };
}

export function downloadFeeReceiptPdf(options) {
  const doc = buildFeeReceiptPdf(options);
  const label = options.fileLabel || options.studentName;
  doc.save(`fee-${safeName(label)}.pdf`);
}

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export function printFeeReceipt(options) {
  const win = window.open('', '_blank', 'width=720,height=900');
  if (!win) {
    downloadFeeReceiptPdf(options);
    return;
  }
  const outstanding = Number(options.outstanding) || 0;
  const code = normalizeFeeCurrency(options.currency);
  const heading = options.title || 'School fees receipt';
  const listed = Array.isArray(options.payments) ? options.payments : null;
  const payments = listed
    ? listed
    : [
        {
          channel: options.channel,
          amount: options.paidAmount,
          created_at: new Date().toISOString(),
          recorded_by_label: options.recordedBy,
          payment_reference: options.reference,
        },
      ];
  const rows = payments.length
    ? payments
        .map(
          (row) => `<tr>
        <td>${escapeHtml(paymentLine(row))}</td>
        <td>${escapeHtml(money(row.amount, code))}</td>
        <td>${escapeHtml(formatWhen(row.created_at))}</td>
        <td>${escapeHtml(row.recorded_by_label || row.recorded_by || '—')}</td>
        <td>${escapeHtml(String(row.payment_reference || row.reference || '—').replace(/^manual:/, ''))}</td>
      </tr>`
        )
        .join('')
    : '<tr><td colspan="5">No payments recorded yet.</td></tr>';
  const chargeRows = (options.charges || [])
    .map((row) => `<tr><td>${escapeHtml(row.label || 'Fee')}</td><td>${escapeHtml(money(row.amount, code))}</td></tr>`)
    .join('');
  const chargesTable = chargeRows
    ? `<table>
    <thead><tr><th>Fee for this term</th><th>Amount</th></tr></thead>
    <tbody>${chargeRows}<tr class="totals"><td>Total billed</td><td>${escapeHtml(money(options.feeAmount, code))}</td></tr></tbody>
  </table>`
    : '';
  win.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(heading)} · ${escapeHtml(options.studentName || 'Student')}</title>
  <style>
    body { font-family: Georgia, "Times New Roman", serif; color: #0f172a; margin: 32px; }
    h1 { font-size: 20px; margin: 0 0 4px; text-align: center; }
    h2 { font-size: 15px; margin: 0 0 24px; text-align: center; font-weight: normal; }
    p { margin: 4px 0; font-size: 13px; }
    table { width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 12px; }
    th, td { border: 1px solid #cbd5e1; padding: 8px; text-align: left; }
    th { background: #ebf5fb; color: #154360; }
    .totals td { font-weight: 700; }
    .paid { color: #27AE60; }
    .overdue { color: #E74C3C; }
    .note { margin-top: 20px; font-size: 12px; color: #334155; }
  </style>
</head>
<body>
  <h1>${escapeHtml(options.schoolName || 'School')}</h1>
  <h2>${escapeHtml(heading)}</h2>
  <p><strong>Student:</strong> ${escapeHtml(options.studentName || 'Student')}</p>
  ${options.className ? `<p><strong>Class:</strong> ${escapeHtml(options.className)}</p>` : ''}
  ${options.rollNumber ? `<p><strong>Student ID / roll:</strong> ${escapeHtml(options.rollNumber)}</p>` : ''}
  ${options.periodLabel ? `<p><strong>Period:</strong> ${escapeHtml(options.periodLabel)}</p>` : ''}
  ${options.reference ? `<p><strong>Reference:</strong> ${escapeHtml(options.reference)}</p>` : ''}
  ${chargesTable}
  <table>
    <thead><tr><th>Fee billed</th><th>Amount paid</th><th>Outstanding</th></tr></thead>
    <tbody class="totals"><tr>
      <td>${escapeHtml(money(options.feeAmount, code))}</td>
      <td class="paid">${escapeHtml(money(options.paidAmount, code))}</td>
      <td class="${outstanding >= 0.01 ? 'overdue' : 'paid'}">${outstanding >= 0.01 ? escapeHtml(money(outstanding, code)) : 'None'}</td>
    </tr></tbody>
  </table>
  <table>
    <thead><tr><th>Method</th><th>Amount</th><th>Date</th><th>Recorded by</th><th>Reference</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <p class="note">${
    outstanding >= 0.01
      ? `Balance still due: ${escapeHtml(money(outstanding, code))}. Keep this receipt for your records.`
      : 'This student is fully paid for the period shown.'
  }</p>
</body>
</html>`);
  win.document.close();
  win.focus();
  window.setTimeout(() => {
    try {
      win.print();
    } catch {
      downloadFeeReceiptPdf(options);
    }
  }, 300);
}
