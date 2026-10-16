const TRACK_ORDER = {
  nursery: 1,
  kg: 2,
  primary: 3,
  jhs: 4,
  shs: 5,
  other: 6,
};

function digitsIn(text) {
  const match = String(text || '').match(/(\d{1,2})/);
  return match ? Number(match[1]) : 0;
}

export function parseClassName(name, form) {
  const raw = String(name || '').trim();
  const n = raw.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
  const formLevel = Number(form);

  if (/(creche|crèche|daycare|day care|nurs(?:e|o)ry|nursary|nursory|\bnur\b|pre school|preschool|playgroup|play group)/.test(n)) {
    return { name: raw, track: 'nursery', level: digitsIn(n) || 1 };
  }
  if (/(kindergarten|k\s*\.?\s*g\b)/.test(n)) {
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

export function sortClasses(classes = []) {
  const ranked = (classes || []).map((row, index) => {
    const parsed = parseClassName(row?.name, row?.form);
    return { row, index, rank: rankClass(parsed), name: parsed.name };
  });
  ranked.sort(
    (a, b) => a.rank - b.rank || a.name.localeCompare(b.name) || a.index - b.index
  );
  return ranked.map((item) => item.row);
}
