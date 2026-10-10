import crypto from 'crypto';

const TOKEN_BYTES = 32;
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export function createEmailVerificationToken() {
  const rawToken = crypto.randomBytes(TOKEN_BYTES).toString('hex');
  const tokenHash = hashEmailVerificationToken(rawToken);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();
  return { rawToken, tokenHash, expiresAt };
}

export function hashEmailVerificationToken(rawToken) {
  return crypto.createHash('sha256').update(String(rawToken || '')).digest('hex');
}

export function getFrontendBaseUrl() {
  const configured = String(process.env.FRONTEND_URL || process.env.APP_URL || '')
    .trim()
    .replace(/\/$/, '');
  if (configured) return configured;
  // Vercel production fallback when FRONTEND_URL was forgotten
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${String(process.env.VERCEL_PROJECT_PRODUCTION_URL).replace(/^https?:\/\//, '')}`;
  }
  if (process.env.VERCEL_URL) {
    return `https://${String(process.env.VERCEL_URL).replace(/^https?:\/\//, '')}`;
  }
  return 'http://localhost:3000';
}

export function buildVerifyEmailUrl(rawToken) {
  const base = getFrontendBaseUrl();
  const token = encodeURIComponent(String(rawToken || '').trim());
  return `${base}/verify-email?token=${token}`;
}

export function isSchoolEmailVerified(school) {
  if (!school) return false;
  if (school.role === 'super_admin') return true;
  // Legacy / missing column: treat as verified so existing schools keep working
  if (school.email_verified === undefined || school.email_verified === null) return true;
  return school.email_verified === true;
}

/** Email-first signup pending password choice after magic link. */
export const PASSWORD_SETUP_MARKER = '__EMAIL_SETUP__';

export function needsPasswordSetup(school) {
  return Boolean(school) && school.initial_password === PASSWORD_SETUP_MARKER;
}

export function buildVerificationEmail({ schoolName, email, verifyUrl, paid = false }) {
  const name = schoolName || 'your school';
  const safeUrl = String(verifyUrl || '').trim();
  const subject = paid
    ? 'Payment received — verify your Schooltype email'
    : 'Create your Schooltype account — verify your email';

  const text = [
    `Hi,`,
    ``,
    paid
      ? `Payment for ${name} on Schooltype was successful. Your plan is unlocked.`
      : `Thanks for starting registration for ${name} on Schooltype.`,
    ``,
    `Open this link to verify your email and choose a password:`,
    safeUrl,
    ``,
    `If the link above is not clickable, copy and paste it into your browser.`,
    ``,
    `This link expires in 24 hours.`,
    `If you did not request this, you can ignore this email.`,
  ].join('\n');

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f5f9;">
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;padding:24px;line-height:1.5;color:#0f172a;">
    <div style="background:#ffffff;border-radius:16px;padding:28px;border:1px solid #e2e8f0;">
      <h2 style="margin:0 0 16px;font-size:22px;color:#0f172a;">${paid ? 'Payment received' : 'Create your Schooltype account'}</h2>
      <p style="margin:0 0 12px;">${paid ? `Payment for <strong>${escapeHtml(name)}</strong> was successful. Your plan is unlocked.` : `Thanks for starting registration for <strong>${escapeHtml(name)}</strong>.`}</p>
      <p style="margin:0 0 20px;">Confirm <strong>${escapeHtml(email)}</strong>, then choose a password to finish setup.</p>
      <p style="margin:0 0 8px;text-align:center;">
        <a href="${escapeHtml(safeUrl)}"
           style="display:inline-block;background:#0284c7;color:#ffffff !important;text-decoration:none;padding:14px 28px;border-radius:999px;font-weight:700;font-size:16px;">
          Verify email &amp; continue
        </a>
      </p>
      <p style="margin:24px 0 8px;font-size:14px;color:#334155;font-weight:600;">Or copy this link into your browser:</p>
      <p style="margin:0;padding:12px;background:#f8fafc;border:1px solid #cbd5e1;border-radius:8px;word-break:break-all;font-size:13px;">
        <a href="${escapeHtml(safeUrl)}" style="color:#0284c7;text-decoration:underline;">${escapeHtml(safeUrl)}</a>
      </p>
      <p style="margin:20px 0 0;font-size:12px;color:#64748b;">This link expires in 24 hours. If you did not request this, ignore this email.</p>
    </div>
  </div>
</body>
</html>`;

  return { subject, text, html };
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
