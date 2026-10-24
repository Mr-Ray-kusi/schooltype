export const EXTRA_FEE_REASONS = ['School bus', 'Lunch', 'Hostel', 'Other'];

export const emptyExtraFee = () => ({ label: 'School bus', amount: '' });

export function parseExtraFees(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .map((row) => ({
        label: String(row?.label || row?.reason || '').trim(),
        amount: row?.amount != null && row?.amount !== '' ? String(row.amount) : '',
      }))
      .filter((row) => row.label);
  }
  if (typeof value === 'string') {
    try {
      return parseExtraFees(JSON.parse(value));
    } catch {
      return [];
    }
  }
  return [];
}

export function extraFeesPayload(rows) {
  return (rows || [])
    .map((row) => ({
      label: String(row.label || '').trim(),
      amount: Number(String(row.amount || '').replace(/[,\s]/g, '')),
    }))
    .filter((row) => row.label && Number.isFinite(row.amount) && row.amount > 0);
}

export function formatExtraFees(value) {
  const rows = parseExtraFees(value).map((row) => {
    const amount = Number(row.amount);
    if (!row.label || !Number.isFinite(amount) || amount <= 0) return '';
    return `${row.label}: GHS ${amount.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }).filter(Boolean);
  return rows.join(' · ');
}
