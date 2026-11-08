import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchAllRows } from '../pagedQuery.js';

function fakeTable(rows) {
  return () => ({
    range(from, to) {
      return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
    },
  });
}

test('fetchAllRows keeps going after the first 1,000 rows', async () => {
  const rows = Array.from({ length: 1500 }, (_, id) => ({ id }));
  const data = await fetchAllRows(fakeTable(rows));
  assert.equal(data.length, 1500);
  assert.equal(data[0].id, 0);
  assert.equal(data[1499].id, 1499);
});

test('fetchAllRows stops on a short page and surfaces query errors', async () => {
  const short = await fetchAllRows(fakeTable([{ id: 1 }, { id: 2 }]));
  assert.equal(short.length, 2);

  await assert.rejects(
    () =>
      fetchAllRows(() => ({
        range() {
          return Promise.resolve({ data: null, error: { message: 'relation missing' } });
        },
      })),
    { message: 'relation missing' }
  );
});
