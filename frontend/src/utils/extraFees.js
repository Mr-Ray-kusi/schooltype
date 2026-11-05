/** Rows saved before the amount-only form carry a reason such as "School bus"; keep showing it. */
export const DEFAULT_EXTRA_FEE_LABEL = 'Extra';

export const emptyExtraFee = () => ({ label: DEFAULT_EXTRA_FEE_LABEL, amount: '' });

function formatGhs(amount) {
  return `GHS ${amount.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function parseExtraFees(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .map((row) => ({
        label: String(row?.label || row?.reason || '').trim() || DEFAULT_EXTRA_FEE_LABEL,
        amount: row?.amount != null && row?.amount !== '' ? String(row.amount) : '',
      }))
      .filter((row) => row.amount !== '');
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
      label: String(row.label || '').trim() || DEFAULT_EXTRA_FEE_LABEL,
      amount: Number(String(row.amount || '').replace(/[,\s]/g, '')),
    }))
    .filter((row) => Number.isFinite(row.amount) && row.amount > 0);
}

export function extraFeesAmount(value) {
  return parseExtraFees(value)
    .map((row) => Number(row.amount))
    .filter((amount) => Number.isFinite(amount) && amount > 0)
    .reduce((sum, amount) => sum + amount, 0);
}

export function formatExtraFeesAmount(value) {
  const total = extraFeesAmount(value);
  return total > 0 ? formatGhs(total) : '';
}

export function formatExtraFees(value) {
  const parts = parseExtraFees(value)
    .map((row) => ({ label: row.label, amount: Number(row.amount) }))
    .filter((row) => Number.isFinite(row.amount) && row.amount > 0)
    .map((row) =>
      row.label === DEFAULT_EXTRA_FEE_LABEL
        ? formatGhs(row.amount)
        : `${row.label}: ${formatGhs(row.amount)}`
    );
  return parts.join(' · ');
}
