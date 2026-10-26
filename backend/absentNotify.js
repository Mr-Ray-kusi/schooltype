import { quoteSmsForPhones, settleSmsPayment, refundSchoolAndPlatformUnits } from './smsBilling.js';
import { sendSmsBatch, toE164 } from './smsProvider.js';
import { supabase } from './supabaseClient.js';

export const ABSENT_SMS_TEMPLATE =
  '{student_name} did not come to school today. Please contact the school if this is unexpected.';

const accraDate = (date = new Date()) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Accra',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);

const isPresentStatus = (status) => {
  const value = String(status || '').toLowerCase();
  return value === 'early' || value === 'late' || value === 'present';
};

export function absenceMessage(studentName, className, schoolName) {
  const who = studentName || 'your child';
  const where = className ? ` (${className})` : '';
  const school = schoolName || 'the school';
  return `${who}${where} did not come to school today. Please contact ${school} if this is unexpected.`;
}

export function groupAbsentParents(students) {
  const byPhone = new Map();
  for (const student of students || []) {
    const phone = toE164(student.parent_phone || student.parentPhone);
    if (!phone) continue;
    const list = byPhone.get(phone) || [];
    list.push(student);
    byPhone.set(phone, list);
  }
  return [...byPhone.entries()].map(([phone, kids]) => ({ phone, students: kids }));
}

export function buildAbsentSmsBodies(groups, schoolName) {
  const bodies = {};
  for (const group of groups || []) {
    const names = (group.students || []).map((student) => {
      const cls = student.class ? ` (${student.class})` : '';
      return `${student.name || 'your child'}${cls}`;
    });
    const who =
      names.length <= 1
        ? names[0] || 'your child'
        : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
    bodies[group.phone] = absenceMessage(who, '', schoolName).replace(' ()', '');
  }
  return bodies;
}

export async function listAbsentStudentsForDay({ schoolId, date } = {}) {
  const ymd = /^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) ? String(date) : accraDate();
  const today = accraDate();
  const [{ data: students, error: studentError }, { data: rows, error: attError }] = await Promise.all([
    supabase.from('students').select('id, name, class, parent_phone').eq('school_id', schoolId),
    supabase
      .from('attendance')
      .select('user_id, user_type, status')
      .eq('school_id', schoolId)
      .eq('date', ymd),
  ]);
  if (studentError) throw studentError;
  if (attError) throw attError;

  const marked = new Map();
  for (const row of rows || []) {
    const type = String(row.user_type || '').toLowerCase();
    if (type && type !== 'student') continue;
    marked.set(row.user_id, row.status);
  }

  return (students || []).filter((student) => {
    const status = marked.get(student.id);
    if (isPresentStatus(status)) return false;
    if (String(status || '').toLowerCase() === 'absent') return true;
    if (marked.has(student.id)) return false;
    return ymd < today;
  });
}

export async function sendAbsentParentSms({
  schoolId,
  schoolName,
  date,
  confirmSmsPayment,
  senderName,
  senderRole,
} = {}) {
  if (!schoolId) {
    const err = new Error('School is required');
    err.status = 400;
    throw err;
  }
  const ymd = /^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) ? String(date) : accraDate();
  const label = schoolName || 'School';
  const absent = await listAbsentStudentsForDay({ schoolId, date: ymd });
  const groups = groupAbsentParents(absent);
  const phones = groups.map((group) => group.phone);
  const bodiesByPhone = buildAbsentSmsBodies(groups, label);
  const sample =
    Object.values(bodiesByPhone).sort((left, right) => right.length - left.length)[0] ||
    absenceMessage('your child', '', label);

  if (!phones.length) {
    const err = new Error(
      absent.length
        ? 'Absent students have no parent phone numbers to SMS.'
        : 'No students are marked absent for this day yet.'
    );
    err.status = 400;
    err.code = 'SMS_NO_RECIPIENTS';
    throw err;
  }

  if (!confirmSmsPayment) {
    const quote = await quoteSmsForPhones({ schoolId, message: sample, phones });
    return {
      ...quote,
      date: ymd,
      message: sample,
      absent_students: absent.length,
      quoted: true,
    };
  }

  const smsSettlement = await settleSmsPayment({
    supabase,
    schoolId,
    schoolName: label,
    message: sample,
    phones,
  });

  let smsDelivery;
  try {
    smsDelivery = await sendSmsBatch({
      phones: smsSettlement.phones,
      body: sample,
      schoolName: label,
      bodiesByPhone,
    });
  } catch (sendErr) {
    const refundUnits = smsSettlement.quote?.units_required || 0;
    if (refundUnits > 0) {
      await refundSchoolAndPlatformUnits({
        schoolId,
        schoolName: label,
        units: refundUnits,
        reference: smsSettlement.reference,
        reason: 'Refund after absence SMS failed to send',
      }).catch(() => {});
    }
    throw sendErr;
  }

  const segments = smsSettlement.quote?.segments || 1;
  const failedUnits = (smsDelivery.failed || 0) * segments;
  if (failedUnits > 0) {
    await refundSchoolAndPlatformUnits({
      schoolId,
      schoolName: label,
      units: failedUnits,
      reference: smsSettlement.reference,
      reason: `Refund for ${smsDelivery.failed} failed absence SMS`,
    }).catch(() => {});
  }

  if (smsDelivery.sent === 0 && smsDelivery.failed > 0) {
    const err = new Error('SMS provider could not deliver to any absent-student parent. Units were refunded where possible.');
    err.status = 502;
    err.code = 'SMS_DELIVERY_FAILED';
    err.sms_billing = smsSettlement;
    err.sms_delivery = smsDelivery;
    throw err;
  }

  await supabase.from('messages').insert([
    {
      school_id: schoolId,
      sender_name: senderName || 'Administrator',
      sender_role: senderRole || 'Administrator',
      send_mode: 'Group',
      recipients: 'Parents (absent students)',
      message: sample,
      delivery_channel: 'sms',
      created_at: new Date(),
    },
  ]);

  return {
    ok: true,
    date: ymd,
    message: sample,
    absent_students: absent.length,
    sms_billing: smsSettlement,
    sms_delivery: {
      sent: smsDelivery.sent,
      failed: smsDelivery.failed,
      total: smsDelivery.total,
      dryRun: smsDelivery.dryRun,
    },
  };
}

export async function notifyParentsOfAbsence({
  schoolId,
  schoolName,
  students,
  sendEmail,
}) {
  const roster = (students || []).filter((row) => row?.id);
  if (!schoolId || !roster.length) return { sms: 0, email: 0 };

  const label = schoolName || 'School';
  const smsCandidates = [];
  const emailCandidates = [];

  for (const student of roster) {
    const phone = toE164(student.parent_phone || student.parentPhone);
    const email = String(student.parent_email || student.parentEmail || '').trim();
    const body = absenceMessage(student.name, student.class || student.label);
    if (phone) smsCandidates.push({ student, phone, body, email });
    else if (email) emailCandidates.push({ student, email, body });
  }

  let smsSent = 0;
  if (smsCandidates.length) {
    const uniquePhones = [...new Set(smsCandidates.map((row) => row.phone))];
    const sample = smsCandidates[0].body;
    let canSms = false;
    try {
      const quote = await quoteSmsForPhones({ schoolId, message: sample, phones: uniquePhones });
      canSms = Boolean(quote.can_send);
    } catch {
      canSms = false;
    }

    if (canSms) {
      try {
        const settlement = await settleSmsPayment({
          supabase: null,
          schoolId,
          schoolName: label,
          message: sample,
          phones: uniquePhones,
        });
        const delivery = await sendSmsBatch({
          phones: settlement.phones,
          body: sample,
          schoolName: label,
          bodiesByPhone: Object.fromEntries(smsCandidates.map((row) => [row.phone, row.body])),
        });
        smsSent = delivery.sent || 0;
        const failedUnits = (delivery.failed || 0) * (settlement.quote?.segments || 1);
        if (failedUnits > 0) {
          await refundSchoolAndPlatformUnits({
            schoolId,
            schoolName: label,
            units: failedUnits,
            reference: settlement.reference,
            reason: 'Refund after absence SMS failed to send',
          }).catch(() => {});
        }
        if (delivery.failed > 0) {
          for (const row of smsCandidates) {
            if (row.email) emailCandidates.push({ student: row.student, email: row.email, body: row.body });
          }
        }
      } catch (error) {
        console.warn('Absence SMS failed, sending email instead:', error.message);
        for (const row of smsCandidates) {
          if (row.email) emailCandidates.push({ student: row.student, email: row.email, body: row.body });
        }
      }
    } else {
      for (const row of smsCandidates) {
        if (row.email) emailCandidates.push({ student: row.student, email: row.email, body: row.body });
      }
    }
  }

  let emailSent = 0;
  const seenEmail = new Set();
  for (const row of emailCandidates) {
    const key = String(row.email || '').toLowerCase();
    if (!key || seenEmail.has(key) || typeof sendEmail !== 'function') continue;
    seenEmail.add(key);
    try {
      await sendEmail({
        to: row.email,
        subject: `${label}: ${row.student?.name || 'Student'} is absent today`,
        text: row.body,
        html: `<p>${row.body}</p>`,
      });
      emailSent += 1;
    } catch (error) {
      console.warn('Absence email failed:', error.message);
    }
  }

  return { sms: smsSent, email: emailSent };
}
