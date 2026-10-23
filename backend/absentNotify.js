import { quoteSmsForPhones, settleSmsPayment, refundSchoolAndPlatformUnits } from './smsBilling.js';
import { sendSmsBatch, toE164 } from './smsProvider.js';

const absenceMessage = (studentName, className) => {
  const who = studentName || 'your child';
  const where = className ? ` (${className})` : '';
  return `${who}${where} did not come to school today. Please contact the school if this is unexpected.`;
};

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
