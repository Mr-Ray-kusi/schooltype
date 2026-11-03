export const FEE_CURRENCIES = [
  { code: 'GHS', name: 'Ghana Cedi' },
  { code: 'USD', name: 'US Dollar' },
  { code: 'EUR', name: 'Euro' },
  { code: 'GBP', name: 'Pound Sterling' },
  { code: 'NGN', name: 'Nigerian Naira' },
  { code: 'XOF', name: 'West African CFA' },
  { code: 'XAF', name: 'Central African CFA' },
  { code: 'KES', name: 'Kenyan Shilling' },
  { code: 'ZAR', name: 'South African Rand' },
  { code: 'CAD', name: 'Canadian Dollar' },
];

const ALLOWED = new Set(FEE_CURRENCIES.map((item) => item.code));

export function normalizeFeeCurrency(value) {
  const code = String(value || 'GHS').trim().toUpperCase();
  return ALLOWED.has(code) ? code : 'GHS';
}

export function formatMoney(amount, currency = 'GHS') {
  const code = normalizeFeeCurrency(currency);
  return `${code} ${Number(amount || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
