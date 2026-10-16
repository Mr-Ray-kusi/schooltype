/**
 * Read Ghana-style class names and rank them so the last class in a track
 * is the completing class (KG → Primary → JHS → SHS, or Class 1…N).
 */

const TRACK_ORDER = {
  creche: 1,
  nursery: 2,
  kg: 3,
  primary: 4,
  jhs: 5,
  shs: 6,
  other: 7,
};

function digitsIn(text) {
  const match = String(text || '').match(/(\d{1,2})/);
  return match ? Number(match[1]) : 0;
}

export function parseClassName(name, form) {
  const raw = String(name || '').trim();
  const n = raw.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
  const formLevel = Number(form);

  if (/(creche|crèche|daycare|day care)/.test(n)) {
    return { name: raw, track: 'creche', level: digitsIn(n) || 1 };
  }
  if (/(nursery|pre school|preschool|playgroup|play group)/.test(n)) {
    return { name: raw, track: 'nursery', level: digitsIn(n) || 1 };
  }
  if (/(kindergarten|\bkg\b|k\.g)/.test(n)) {
    return { name: raw, track: 'kg', level: digitsIn(n) || 1 };
  }
  if (/\b(jhs|jss|jh|j h s|junior(?: high)?)\b/.test(n) || /\bbasic\s*(7|8|9)\b/.test(n)) {
    const basic = n.match(/basic\s*(7|8|9)/);
    const level = basic ? Number(basic[1]) - 6 : digitsIn(n) || 1;
    return { name: raw, track: 'jhs', level };
  }
  if (/\b(shs|sss|sh|s h s|senior(?: high)?)\b/.test(n)) {
    return { name: raw, track: 'shs', level: digitsIn(n) || 1 };
  }
  if (/\bform\s*(\d+)/.test(n)) {
    const level = digitsIn(n) || 1;
    return { name: raw, track: level <= 3 ? 'jhs' : 'shs', level: level <= 3 ? level : level - 3 };
  }
  if (/\b(primary|basic|class|grade|year|p)\s*\d+/.test(n) || /^\d+$/.test(n)) {
    const level = digitsIn(n) || 1;
    if (level >= 7 && level <= 9) return { name: raw, track: 'jhs', level: level - 6 };
    if (level >= 10) return { name: raw, track: 'shs', level: level - 9 };
    return { name: raw, track: 'primary', level };
  }
  if (Number.isFinite(formLevel) && formLevel > 0) {
    return { name: raw, track: 'other', level: formLevel };
  }
  return { name: raw, track: 'other', level: digitsIn(n) || 0 };
}

export function rankClass(parsed) {
  const track = TRACK_ORDER[parsed.track] || TRACK_ORDER.other;
  return track * 100 + Number(parsed.level || 0);
}

export function buildClassHierarchy(classes = []) {
  const parsed = (classes || [])
    .map((row) => {
      const item = parseClassName(row?.name, row?.form);
      return {
        id: row?.id || null,
        name: item.name,
        track: item.track,
        level: item.level,
        rank: rankClass(item),
      };
    })
    .filter((row) => row.name)
    .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));

  const topRank = parsed.reduce((max, row) => Math.max(max, row.rank), 0);
  const completing = parsed.filter((row) => row.rank === topRank).map((row) => row.name);
  return {
    classes: parsed.map((row) => ({
      ...row,
      completing: completing.includes(row.name),
    })),
    completing_classes: completing,
  };
}

export function academicYearFromPeriod(period, fallbackDate = new Date()) {
  const fromPeriod = String(period?.ends_on || period?.starts_on || '').slice(0, 4);
  if (/^\d{4}$/.test(fromPeriod)) return Number(fromPeriod);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Accra',
    year: 'numeric',
  }).formatToParts(fallbackDate);
  return Number(parts.find((part) => part.type === 'year')?.value) || fallbackDate.getFullYear();
}

export function accraYmd(value) {
  if (!value) return null;
  const raw = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  if (/^\d{4}-\d{2}$/.test(raw)) return `${raw}-15`;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Accra',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  return year && month && day ? `${year}-${month}-${day}` : null;
}

/** Map a date onto Ghana academic year + term. Uses Setup term dates when they cover the day. */
export function academicPeriodFromDate(value, terms = []) {
  const day = accraYmd(value);
  if (!day) return null;
  const hit = (terms || []).find(
    (term) => term.starts_on && term.ends_on && term.starts_on <= day && term.ends_on >= day
  );
  if (hit) {
    const startYear = Number(String(hit.starts_on).slice(0, 4));
    const startMonth = Number(String(hit.starts_on).slice(5, 7));
    const academicYear = startMonth >= 8 ? `${startYear}/${startYear + 1}` : `${startYear - 1}/${startYear}`;
    return {
      academicYear,
      term: hit.name,
      sortKey: `${academicYear}-${String(hit.sort_order || hit.name).padStart(2, '0')}`,
    };
  }
  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(5, 7));
  if (month >= 9) {
    return { academicYear: `${year}/${year + 1}`, term: 'First Term', sortKey: `${year}/${year + 1}-1` };
  }
  if (month <= 4) {
    return { academicYear: `${year - 1}/${year}`, term: 'Second Term', sortKey: `${year - 1}/${year}-2` };
  }
  return { academicYear: `${year - 1}/${year}`, term: 'Third Term', sortKey: `${year - 1}/${year}-3` };
}

export function periodFromTermName(termName, dateValue, terms = []) {
  const fromDate = academicPeriodFromDate(dateValue, terms);
  const name = String(termName || '').trim();
  if (fromDate && name) {
    return { ...fromDate, term: name, sortKey: `${fromDate.academicYear}-${name}` };
  }
  if (fromDate) return fromDate;
  if (name) return { academicYear: '—', term: name, sortKey: `0000-${name}` };
  return null;
}
