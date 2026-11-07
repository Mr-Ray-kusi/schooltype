const envValue = (key) => String(import.meta.env[key] || '').trim();

/** Live support line. Set VITE_SUPPORT_PHONE (and SUPPORT_PHONE on the API) to publish a number. */
export const SUPPORT_PHONE = envValue('VITE_SUPPORT_PHONE');

export const SUPPORT_FAQS = [
  {
    q: 'How do parents pay school fees?',
    a: 'Open Pay fees on this site, choose the school, enter the student ID from the ID card, confirm the student, then pay with MoMo or bank. Schooltype never asks for a MoMo PIN.',
  },
  {
    q: 'Where do I find the student ID?',
    a: 'It is printed on the student ID card. It looks like BFA-AS-2026-014. Use that code, not a barcode number, when paying fees.',
  },
  {
    q: 'Do I get a receipt after I pay?',
    a: 'After a successful payment you land on a receipt page. You can download or print it. It shows what was paid and any balance still due.',
  },
  {
    q: 'Who handles a wrong payment or a fee refund?',
    a: 'Fee amounts, receipts, and refunds of school fees are handled by the school you paid. Contact that school with the student ID and the payment reference.',
  },
  {
    q: 'How does a school create an account?',
    a: 'Choose a plan. Starter schools get the first term free. Growth and Unlimited pay per term on Paystack, then the administrator finishes from the verification email.',
  },
  {
    q: 'How much does a plan cost?',
    a: 'Plans are billed per term. Starter is ₵1,500 a term for up to 300 students, and the first term is free. Growth is ₵2,500 a term for 301 to 1,000 students. Unlimited is ₵3,500 a term for 1,000 or more.',
  },
  {
    q: 'How do report cards work?',
    a: 'Teachers upload results in the school workspace. Those records stay with the student’s class.',
  },
  {
    q: 'Can teachers and accountants sign in on a phone?',
    a: 'Yes. The school administrator shares the staff portal link. Staff enter their access code and role. Administrators handle academics; accountants handle fees except withdraw and deposit.',
  },
  {
    q: 'What happens if a student is marked absent?',
    a: 'The school can send a ready-made SMS to the parent from Attendance. Late check-ins can also move to absent after the late window.',
  },
  {
    q: 'Who can see our school records?',
    a: 'Each school stays in its own workspace. Staff only see what their role allows.',
  },
];

export const telHref = (phone) => {
  const digits = String(phone || '').replace(/[^\d+]/g, '');
  return digits ? `tel:${digits}` : '';
};
