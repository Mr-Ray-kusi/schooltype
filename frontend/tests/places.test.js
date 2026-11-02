import { describe, expect, test } from 'vitest';
import { COUNTRIES, citiesForCountry } from '../src/data/places';

describe('support places', () => {
  test('lists nations and suggests known cities without blocking a typed town', () => {
    expect(COUNTRIES).toContain('Ghana');
    expect(COUNTRIES).toContain('Nigeria');
    expect(COUNTRIES.length).toBeGreaterThan(150);
    expect(citiesForCountry('Ghana')).toContain('Accra');
    expect(citiesForCountry('Ghana')).toContain('Kumasi');
    expect(citiesForCountry('')).toEqual([]);
  });
});
