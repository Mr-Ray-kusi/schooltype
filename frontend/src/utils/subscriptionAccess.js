export const SUBSCRIPTION_READ_ONLY_MESSAGE =
  'Your term plan has ended. You can still view records and record school fees. Renew to add results, change setup, download, pay staff, or move wallet money.';

export function schoolIsReadOnly(school) {
  if (!school || school.role === 'super_admin') return false;
  return Boolean(school.subscription_read_only || school.subscription_frozen);
}

export function schoolCanRecordFees(school) {
  if (!school || school.subscription_frozen) return false;
  if (school.subscription_can_record_fees === false) return false;
  return true;
}

export function schoolCanDownload(school) {
  return !schoolIsReadOnly(school);
}
