export const LIST_PAGE_SIZE = 8;

export function parseListResponse(data) {
  if (Array.isArray(data)) {
    return { items: data, total: data.length, page: 1, limit: data.length || 50 };
  }
  const items = data?.items || data?.students || data?.staff || [];
  return {
    items,
    total: Number(data?.total ?? items.length) || 0,
    page: Number(data?.page) || 1,
    limit: Number(data?.limit) || 50,
  };
}

export async function fetchAllPages(axios, url, extraParams = {}) {
  const items = [];
  let page = 1;
  let total = Infinity;
  while (items.length < total && page <= 200) {
    const params = { page, limit: 50, ...extraParams };
    const { data } = await axios.get(url, { params });
    const parsed = parseListResponse(data);
    total = parsed.total;
    if (!parsed.items.length) break;
    items.push(...parsed.items);
    page += 1;
  }
  return items;
}

export async function fetchRecord(axios, url, fallback = null) {
  try {
    const { data } = await axios.get(url);
    return data || fallback;
  } catch {
    return fallback;
  }
}
