export const LIST_PAGE_SIZE = 8;

export function parseListResponse(data) {
  if (Array.isArray(data)) {
    return { items: data, total: data.length, page: 1, limit: data.length || 50 };
  }
  const items = data?.items || data?.students || data?.staff || data?.scores || data?.people || [];
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
  const pageLimit = 50;
  while (page <= 200) {
    const params = { ...extraParams, page, limit: pageLimit };
    const { data } = await axios.get(url, { params });
    const parsed = parseListResponse(data);
    if (!parsed.items.length) break;
    items.push(...parsed.items);
    const knownTotal = Number(parsed.total) || 0;
    if (knownTotal > 0 && items.length >= knownTotal) break;
    if (parsed.items.length < pageLimit) break;
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
