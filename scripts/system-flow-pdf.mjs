import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../frontend/package.json', import.meta.url));
const { jsPDF } = require('jspdf');

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'SCHOOLTYPE-system-flow.pdf');
const doc = new jsPDF({ unit: 'mm', format: 'a4' });
const W = 210;
const H = 297;
const ink = [15, 23, 42];
const muted = [71, 85, 105];
const line = [100, 116, 139];

const kinds = {
  start: { fill: [220, 252, 231], edge: [22, 101, 52] },
  box: { fill: [224, 242, 254], edge: [14, 116, 184] },
  decision: { fill: [254, 243, 199], edge: [146, 64, 14] },
  stop: { fill: [255, 228, 230], edge: [159, 18, 57] },
  end: { fill: [220, 252, 231], edge: [22, 101, 52] },
};

function wrap(text, width) {
  return doc.splitTextToSize(String(text), width);
}

function arrow(x1, y1, x2, y2) {
  doc.setDrawColor(...line);
  doc.setLineWidth(0.35);
  doc.line(x1, y1, x2, y2);
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const len = 2.1;
  doc.setFillColor(...line);
  doc.triangle(
    x2,
    y2,
    x2 - len * Math.cos(angle - 0.5),
    y2 - len * Math.sin(angle - 0.5),
    x2 - len * Math.cos(angle + 0.5),
    y2 - len * Math.sin(angle + 0.5),
    'F'
  );
}

function boxHeight(text, w) {
  const lines = wrap(text, w - 6);
  return Math.max(11, lines.length * 3.6 + 5);
}

function card(x, y, w, h, text, kind) {
  const tone = kinds[kind] || kinds.box;
  doc.setFillColor(...tone.fill);
  doc.setDrawColor(...tone.edge);
  doc.setLineWidth(0.45);
  doc.roundedRect(x, y, w, h, 2, 2, 'FD');
  doc.setTextColor(...ink);
  doc.setFont('helvetica', kind === 'decision' ? 'bold' : 'normal');
  doc.setFontSize(8.5);
  const lines = wrap(text, w - 6);
  const block = lines.length * 3.6;
  doc.text(lines, x + 3, y + (h - block) / 2 + 3.1);
  if (y + h > 280 || x + w > 202) console.warn('overflow', y + h, x + w, String(text).slice(0, 48));
  return h;
}

function header(kicker, title) {
  doc.setFillColor(2, 12, 27);
  doc.rect(0, 0, W, 20, 'F');
  doc.setTextColor(125, 211, 252);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text(kicker, 14, 7.5);
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(13);
  doc.text(title, 14, 15);
}

function footer(page, total) {
  doc.setTextColor(...muted);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text('SCHOOLTYPE  ·  How the system works', 14, H - 8);
  doc.text(`${page} / ${total}`, W - 14, H - 8, { align: 'right' });
}

function down(x, y, w, text, kind) {
  const h = boxHeight(text, w);
  card(x, y, w, h, text, kind);
  return { x, y, w, h, bottom: y + h, cx: x + w / 2 };
}

function link(from, to) {
  arrow(from.cx, from.bottom, to.cx, to.y - 0.4);
}

function page1() {
  header('SYSTEM MAP', 'Who uses SCHOOLTYPE, and where they enter');
  doc.setTextColor(...muted);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(
    wrap(
      'One website serves every school. Each school only sees its own students, staff, attendance, fees, and messages. Parents never receive a sign-in.',
      182
    ),
    14,
    28
  );

  const rows = [
    ['Visitor', 'Home page', 'Reads the product, opens plans, pays fees, or reads the privacy notice.'],
    ['New school', 'Plans, then signup', 'Pays yearly by MoMo, card, or bank. The account exists only after payment succeeds.'],
    ['School administrator', 'Sign in', 'Runs one school: people, classes, attendance, messages, fees, wallet, report cards, and alumni.'],
    ['Teacher', 'Staff portal + code', 'Enters scores for the subjects and classes assigned to them.'],
    ['Accountant', 'Staff portal + code', 'Records fee payments and sends fee reminders.'],
    ['Staff administrator', 'Staff portal + code', 'Can sign in. This role cannot enter scores or manage fees.'],
    ['Parent', 'Pay fees page', 'Looks up a student ID and pays. Cannot open results or attendance.'],
    ['Platform owner', 'Sign in', 'Sees every school, plans, SMS units, and platform analytics.'],
  ];
  const cols = [40, 46, 96];
  let y = 42;
  doc.setFillColor(15, 23, 42);
  doc.roundedRect(14, y, 182, 8, 1.4, 1.4, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  let x = 17;
  ['Person', 'Door', 'What they can do'].forEach((label, i) => {
    doc.text(label, x, y + 5.2);
    x += cols[i];
  });
  y += 10;
  rows.forEach((row, index) => {
    const lineCounts = row.map((cell, i) => wrap(cell, cols[i] - 6).length);
    const h = Math.max(...lineCounts) * 3.7 + 4;
    doc.setFillColor(...(index % 2 ? [255, 255, 255] : [248, 250, 252]));
    doc.setDrawColor(226, 232, 240);
    doc.rect(14, y, 182, h, 'FD');
    doc.setTextColor(...ink);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    let cx = 17;
    row.forEach((cell, i) => {
      doc.text(wrap(cell, cols[i] - 6), cx, y + 4);
      cx += cols[i];
    });
    y += h;
  });

  const note = down(
    14,
    y + 8,
    182,
    'A student, fee, score, or attendance row is stored with that school\'s id. Another school\'s sign-in cannot open it. The platform owner is the only login that can see across schools.',
    'box'
  );
  return note;
}

function page2() {
  header('SIGN UP', 'A school joins');
  const x = 32;
  const w = 146;
  let y = 28;
  const a = down(x, y, w, 'Visitor opens the SCHOOLTYPE website and chooses Get started.', 'start');
  y = a.bottom + 7;
  const b = down(
    x,
    y,
    w,
    'Picks a yearly plan. Small is GHS 10 for up to 200 students. Mid is GHS 20 for 200 to 1,000. Large is GHS 30 for 1,000 and above. Every plan includes the same tools.',
    'box'
  );
  link(a, b);
  y = b.bottom + 7;
  const c = down(x, y, w, 'Enters the school name and administrator email, optionally uploads a logo, and accepts the privacy notice.', 'box');
  link(b, c);
  y = c.bottom + 7;
  const d = down(x, y, w, 'Pays with MoMo, card, or bank on Paystack. The MoMo PIN stays on the phone. SCHOOLTYPE does not store it.', 'box');
  link(c, d);
  y = d.bottom + 7;
  const e = down(x, y, w, 'Did the payment succeed?', 'decision');
  link(d, e);

  const left = down(16, e.bottom + 12, 84, 'No. No school account is created. Nothing is unlocked.', 'stop');
  const right = down(110, e.bottom + 12, 84, 'Yes. The school account is created and a verification email is sent.', 'box');
  arrow(e.cx - 18, e.bottom, left.cx, left.y - 0.4);
  arrow(e.cx + 18, e.bottom, right.cx, right.y - 0.4);
  doc.setFontSize(7);
  doc.setTextColor(...muted);
  doc.text('No', left.cx - 8, e.bottom + 6);
  doc.text('Yes', right.cx - 4, e.bottom + 6);

  const f = down(110, right.bottom + 8, 84, 'Administrator opens the email, verifies the address, and chooses a password.', 'box');
  link(right, f);
  const g = down(110, f.bottom + 8, 84, 'They sign in and land on the school dashboard.', 'end');
  link(f, g);
}

function page3() {
  header('SIGN IN', 'Each person lands in a different place');
  const top = down(32, 26, 146, 'Opens Sign in and uses email and password, or Google.', 'start');
  const ask = down(32, top.bottom + 7, 146, 'What kind of account is this?', 'decision');
  link(top, ask);

  const y = ask.bottom + 12;
  const p1 = down(14, y, 58, 'Platform owner. Opens every school, plans, SMS units, broadcasts, and analytics.', 'box');
  const p2 = down(76, y, 58, 'School that has not paid. Must choose a plan and pay before the school tools open.', 'box');
  const p3 = down(138, y, 58, 'Paid school administrator. Opens that one school. Two devices can stay signed in.', 'end');
  arrow(ask.cx - 36, ask.bottom, p1.cx, p1.y - 0.4);
  arrow(ask.cx, ask.bottom, p2.cx, p2.y - 0.4);
  arrow(ask.cx + 36, ask.bottom, p3.cx, p3.y - 0.4);

  const staffY = Math.max(p1.bottom, p2.bottom, p3.bottom) + 10;
  const s0 = down(32, staffY, 146, 'Teachers, accountants, and staff administrators use a different door: the staff-portal link plus the access code the school gave them.', 'start');
  const s1 = down(32, s0.bottom + 7, 146, 'Which role is on that access code?', 'decision');
  link(s0, s1);
  const roleY = s1.bottom + 12;
  const r1 = down(14, roleY, 58, 'Teacher. Enters scores for assigned subjects and classes.', 'box');
  const r2 = down(76, roleY, 58, 'Accountant. Sees fees, records a payment, and sends a reminder.', 'box');
  const r3 = down(138, roleY, 58, 'Staff administrator. Signs in and out. Scores and fees stay with the other roles.', 'end');
  arrow(s1.cx - 36, s1.bottom, r1.cx, r1.y - 0.4);
  arrow(s1.cx, s1.bottom, r2.cx, r2.y - 0.4);
  arrow(s1.cx + 36, s1.bottom, r3.cx, r3.y - 0.4);
}

function page4() {
  header('DAILY WORK', 'A normal school day');
  const x = 28;
  const w = 154;
  const steps = [
    ['School administrator opens the dashboard: students, staff, today\'s attendance, and fees.', 'start'],
    ['Setup: creates classes, subjects, terms, and the fee amount for each class.', 'box'],
    ['People: enrolls students and adds staff. A new student receives an ID such as BFA-AA-2026-001: school letters, a two-letter mark, the year they enrolled, and a number that counts inside that class. Class 1 and Class 2 can each start at 001.', 'box'],
    ['Attendance: a desk scanner or a phone camera reads the student\'s QR code and marks them for today. The school can filter the list and export it.', 'box'],
    ['Messages: the school sends SMS or email to parents and staff. SMS uses units bought from the school wallet.', 'box'],
    ['At the end of the year the school saves the finishing class as alumni. Those students leave the current list. The alumni record stays until the school deletes it.', 'end'],
  ];
  let y = 28;
  let prev = null;
  steps.forEach(([text, kind]) => {
    const node = down(x, y, w, text, kind);
    if (prev) link(prev, node);
    prev = node;
    y = node.bottom + 7;
  });
}

function page5() {
  header('MONEY', 'How school fees move');
  const a = down(32, 26, 146, 'The class fee is set in Setup. The Fees screen shows who has paid and who still owes for the term.', 'start');
  const b = down(32, a.bottom + 7, 146, 'How does the payment arrive?', 'decision');
  link(a, b);

  const left = down(14, b.bottom + 12, 86, 'In the office. The school administrator, or an accountant in the staff portal, records the amount, method, and reference.', 'box');
  const right = down(110, b.bottom + 12, 86, 'From a parent. They open Pay fees with no account, pick the school, enter the student ID, and confirm the name, class, and amount.', 'box');
  arrow(b.cx - 22, b.bottom, left.cx, left.y - 0.4);
  arrow(b.cx + 22, b.bottom, right.cx, right.y - 0.4);

  const pay = down(110, right.bottom + 7, 86, 'Parent pays with MTN MoMo, Telecel, AT, or bank, and confirms the prompt on their phone.', 'box');
  link(right, pay);

  const joinY = Math.max(left.bottom, pay.bottom) + 10;
  const c = down(32, joinY, 146, 'A successful payment reduces what that student owes and can be opened as a receipt.', 'box');
  arrow(left.cx, left.bottom, c.cx - 20, c.y - 0.4);
  arrow(pay.cx, pay.bottom, c.cx + 20, c.y - 0.4);

  const d = down(32, c.bottom + 7, 146, 'The money is held in the school wallet.', 'box');
  link(c, d);
  const e = down(32, d.bottom + 7, 146, 'The school pays out from the wallet to the MoMo number or bank account saved in Bank settings.', 'end');
  link(d, e);
}

function page6() {
  header('RESULTS AND LIMITS', 'Scores, ID cards, and what stays closed');
  const a = down(28, 28, 154, 'A teacher signs into the staff portal and saves subject scores, remarks, and attitude for their class.', 'start');
  const b = down(28, a.bottom + 7, 154, 'The school administrator opens Report cards, reviews the scores, and downloads or prints a report.', 'box');
  link(a, b);
  const c = down(28, b.bottom + 7, 154, 'A QR code on a student card opens a public page for a found card: name, school, class or role, student ID, and parent phone.', 'box');
  link(b, c);
  const left = down(14, c.bottom + 12, 88, 'That public page does not show a photo, email, home address, date of birth, fees, or results.', 'stop');
  const right = down(108, c.bottom + 12, 88, 'A parent cannot sign in. They cannot see results or attendance. Their only signed-out tool is Pay fees.', 'stop');
  arrow(c.cx - 24, c.bottom, left.cx, left.y - 0.4);
  arrow(c.cx + 24, c.bottom, right.cx, right.y - 0.4);
  const joinY = Math.max(left.bottom, right.bottom) + 14;
  doc.setTextColor(...muted);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text('Where it runs', 28, joinY - 3);
  down(28, joinY, 154, 'The website works in a browser on Windows, Mac, Android, and iPhone. It is not packaged as an App Store or Play Store app.', 'end');
}

const painters = [page1, page2, page3, page4, page5, page6];
painters.forEach((paint, index) => {
  if (index > 0) doc.addPage();
  paint();
  footer(index + 1, painters.length);
});

writeFileSync(out, Buffer.from(doc.output('arraybuffer')));
console.log(out);
