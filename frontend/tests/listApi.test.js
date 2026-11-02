import { describe, expect, test, vi } from 'vitest';
import { fetchAllPages, fetchRecord, parseListResponse } from '../src/utils/listApi';

/** Stands in for axios: returns one page per call, in order. */
const axiosReturning = (pages) => ({
  get: vi.fn(async () => ({ data: pages.shift() ?? { items: [] } })),
});

describe('parseListResponse', () => {
  test('reads the several shapes the API uses for a list', () => {
    expect(parseListResponse({ students: [1, 2], total: 2 }).items).toEqual([1, 2]);
    expect(parseListResponse({ scores: [1], total: 1 }).items).toEqual([1]);
    expect(parseListResponse([1, 2, 3])).toEqual({ items: [1, 2, 3], total: 3, page: 1, limit: 3 });
  });

  test('falls back to the item count when no total is sent', () => {
    expect(parseListResponse({ items: [1, 2] }).total).toBe(2);
  });
});

describe('fetchAllPages', () => {
  test('keeps asking while full pages come back', async () => {
    const axios = axiosReturning([
      { items: Array(50).fill('a'), total: 120 },
      { items: Array(50).fill('b'), total: 120 },
      { items: Array(20).fill('c'), total: 120 },
    ]);
    const items = await fetchAllPages(axios, '/api/students');
    expect(items).toHaveLength(120);
    expect(axios.get).toHaveBeenCalledTimes(3);
  });

  test('stops on a short page when the endpoint never reports a total', async () => {
    const axios = axiosReturning([{ items: Array(10).fill('a') }]);
    const items = await fetchAllPages(axios, '/api/students');
    expect(items).toHaveLength(10);
    expect(axios.get).toHaveBeenCalledTimes(1);
  });

  test('treats a page that reports no total as the whole list', async () => {
    const axios = axiosReturning([{ items: Array(50).fill('a') }, { items: [] }]);
    const items = await fetchAllPages(axios, '/api/students');
    expect(items).toHaveLength(50);
    expect(axios.get).toHaveBeenCalledTimes(1);
  });

  test('stops on an empty page when the total is larger than what exists', async () => {
    const axios = axiosReturning([{ items: Array(50).fill('a'), total: 500 }, { items: [] }]);
    const items = await fetchAllPages(axios, '/api/students');
    expect(items).toHaveLength(50);
    expect(axios.get).toHaveBeenCalledTimes(2);
  });

  test('page and limit are not overridden by a caller filter', async () => {
    const axios = axiosReturning([{ items: [], total: 0 }]);
    await fetchAllPages(axios, '/api/students', { page: 99, class: 'JHS 1' });
    expect(axios.get).toHaveBeenCalledWith('/api/students', {
      params: { page: 1, limit: 50, class: 'JHS 1' },
    });
  });
});

describe('fetchRecord', () => {
  test('returns the fallback instead of throwing when the request fails', async () => {
    const axios = { get: vi.fn(async () => { throw new Error('offline'); }) };
    expect(await fetchRecord(axios, '/api/students/1', { id: 1 })).toEqual({ id: 1 });
  });
});
