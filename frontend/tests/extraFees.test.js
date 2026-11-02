import { describe, expect, test } from 'vitest';
import {
  DEFAULT_EXTRA_FEE_LABEL,
  emptyExtraFee,
  extraFeesPayload,
  formatExtraFees,
  parseExtraFees,
} from '../src/utils/extraFees';

describe('parseExtraFees', () => {
  test('reads rows the API sent as a JSON string', () => {
    expect(parseExtraFees('[{"label":"School bus","amount":150}]')).toEqual([
      { label: 'School bus', amount: '150' },
    ]);
  });

  test('keeps a row that has an amount but no reason', () => {
    expect(parseExtraFees([{ amount: 150 }])).toEqual([
      { label: DEFAULT_EXTRA_FEE_LABEL, amount: '150' },
    ]);
  });

  test('drops a row with no amount and survives malformed JSON', () => {
    expect(parseExtraFees([{ label: 'School bus' }])).toEqual([]);
    expect(parseExtraFees('not json')).toEqual([]);
    expect(parseExtraFees(null)).toEqual([]);
  });
});

describe('extraFeesPayload', () => {
  test('sends a reason even though the form only collects an amount', () => {
    expect(extraFeesPayload([{ label: '', amount: '150' }])).toEqual([
      { label: DEFAULT_EXTRA_FEE_LABEL, amount: 150 },
    ]);
  });

  test('strips separators typed into the amount', () => {
    expect(extraFeesPayload([{ amount: '1,250' }])).toEqual([
      { label: DEFAULT_EXTRA_FEE_LABEL, amount: 1250 },
    ]);
  });

  test('refuses zero, negative, and non-numeric amounts', () => {
    expect(extraFeesPayload([{ amount: '0' }, { amount: '-5' }, { amount: 'abc' }])).toEqual([]);
  });

  test('a blank new row is not submitted', () => {
    expect(extraFeesPayload([emptyExtraFee()])).toEqual([]);
  });
});

describe('formatExtraFees', () => {
  test('shows the amount alone for charges saved by the amount-only form', () => {
    expect(formatExtraFees([{ label: DEFAULT_EXTRA_FEE_LABEL, amount: 150 }])).toBe('GHS 150.00');
  });

  test('still shows the reason saved before the picker was removed', () => {
    expect(formatExtraFees([{ label: 'School bus', amount: 150 }])).toBe('School bus: GHS 150.00');
  });

  test('joins several charges and returns empty when there are none', () => {
    expect(formatExtraFees([{ label: 'Lunch', amount: 40 }, { amount: 60 }])).toBe(
      'Lunch: GHS 40.00 · GHS 60.00'
    );
    expect(formatExtraFees([])).toBe('');
  });
});
