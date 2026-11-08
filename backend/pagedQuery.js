/**
 * PostgREST stops at the project's max-rows setting (1,000 by default).
 * A school of 1,000 students is already on that cliff, so any full-school
 * read has to walk pages. Callers must set a stable `.order()` before ranging.
 */
export async function fetchAllRows(buildQuery, { pageSize = 1000, maxRows = 20000 } = {}) {
  const size = Math.min(1000, Math.max(1, Number(pageSize) || 1000));
  const cap = Math.max(size, Number(maxRows) || size);
  const rows = [];
  for (let from = 0; from < cap; from += size) {
    const { data, error } = await buildQuery().range(from, from + size - 1);
    if (error) {
      if (error instanceof Error) throw error;
      const failure = new Error(error.message || error.details || 'Query failed');
      if (error.code) failure.code = error.code;
      if (error.details) failure.details = error.details;
      if (error.hint) failure.hint = error.hint;
      throw failure;
    }
    const chunk = data || [];
    rows.push(...chunk);
    if (chunk.length < size) break;
  }
  return rows;
}

/** `.in(column, ids)` is sent in the URL. A few hundred UUIDs is enough to break the request. */
export async function selectByIds(buildQuery, ids, column = 'id', { chunkSize = 100 } = {}) {
  const wanted = [...new Set((ids || []).map((id) => String(id || '').trim()).filter(Boolean))];
  const size = Math.min(200, Math.max(1, Number(chunkSize) || 100));
  const rows = [];
  for (let index = 0; index < wanted.length; index += size) {
    const slice = wanted.slice(index, index + size);
    const { data, error } = await buildQuery().in(column, slice);
    if (error) {
      if (error instanceof Error) throw error;
      const failure = new Error(error.message || error.details || 'Query failed');
      if (error.code) failure.code = error.code;
      throw failure;
    }
    rows.push(...(data || []));
  }
  return rows;
}
