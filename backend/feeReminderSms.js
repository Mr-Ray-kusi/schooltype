import { getFrontendBaseUrl } from './emailVerification.js';
import { attachFeePayLink, toE164 } from './smsProvider.js';

export function studentPayUrl(barcode, origin = getFrontendBaseUrl(), schoolId = '') {
  if (!barcode) return '';
  const path = `${origin}/pay/${encodeURIComponent(barcode)}`;
  const school = String(schoolId || '').trim();
  return school ? `${path}?school=${encodeURIComponent(school)}` : path;
}

export function groupOwingParents(unpaid, origin) {
  const byPhone = new Map();
  for (const row of unpaid || []) {
    const phone = toE164(row.parent_phone);
    const url = studentPayUrl(row.barcode, origin, row.school_id || row.schoolId);
    if (!phone || !url) continue;
    const entry = byPhone.get(phone) || { phone, links: [] };
    if (!entry.links.some((link) => link.url === url)) {
      entry.links.push({ name: row.name || 'Student', url });
    }
    byPhone.set(phone, entry);
  }
  return [...byPhone.values()];
}

export function buildOwingFeeSmsBodies(message, groups) {
  const bodiesByPhone = {};
  for (const group of groups) {
    const linkBlock =
      group.links.length === 1
        ? group.links[0].url
        : group.links.map((link) => `${link.name}: ${link.url}`).join('\n');
    bodiesByPhone[group.phone] = attachFeePayLink(message, linkBlock);
  }
  return bodiesByPhone;
}
