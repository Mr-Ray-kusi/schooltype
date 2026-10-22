/**
 * Student IDs: school letters, a unique two-letter token, enrollment year,
 * and class position at enrollment — not academic rank.
 * Example: BFA-AS-2026-014
 */

const STOP_WORDS = new Set(['OF', 'THE', 'AND', 'FOR', 'A', 'AT']);

const normalizeClass = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');

export function schoolCodeFromName(name) {
  const words = String(name || '')
    .toUpperCase()
    .replace(/['’]/g, '')
    .replace(/[^A-Z\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word && !STOP_WORDS.has(word));
  if (!words.length) return 'SCH';
  const initials = words.map((word) => word[0]).join('');
  if (initials.length >= 3) return initials.slice(0, 4);
  const fromFirstWord = words[0].slice(0, 3);
  if (fromFirstWord.length >= 3) return fromFirstWord;
  return `${fromFirstWord}${words.slice(1).join('')}`.replace(/[^A-Z]/g, '').slice(0, 3) || 'SCH';
}

export function codeChoices(name) {
  const base = schoolCodeFromName(name);
  const letters = String(name || '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '');
  const choices = [];
  const push = (value) => {
    const code = String(value || '').toUpperCase();
    if (/^[A-Z]{2,4}\d?$/.test(code) && !choices.includes(code)) choices.push(code);
  };
  push(base);
  const stem = base.slice(0, Math.max(2, base.length - 1));
  for (const letter of letters) push(`${stem}${letter}`);
  for (let n = 2; n <= 9; n += 1) push(`${stem}${n}`);
  return choices.length ? choices : ['SCH'];
}

export function parseStudentId(value) {
  const raw = String(value || '')
    .trim()
    .toUpperCase();
  const next = raw.match(/^([A-Z]{2,4}\d?)-([A-Z]{2})-(\d{4})-(\d{1,4})$/);
  if (next) {
    const year = Number(next[3]);
    if (year < 1990 || year > 2100) return null;
    return { code: next[1], token: next[2], year, sequence: Number(next[4]) };
  }
  const legacy = raw.match(/^([A-Z]{2,4}\d?)-(\d{4})-(\d{1,4})$/);
  if (!legacy) return null;
  const year = Number(legacy[2]);
  if (year < 1990 || year > 2100) return null;
  return { code: legacy[1], token: null, year, sequence: Number(legacy[3]) };
}

export function formatStudentId(code, token, year, sequence) {
  return `${String(code).toUpperCase()}-${String(token).toUpperCase()}-${year}-${String(sequence).padStart(3, '0')}`;
}

export function formatParsedStudentId(parsed) {
  if (!parsed?.code || !parsed?.year || !parsed?.sequence) return null;
  if (parsed.token) return formatStudentId(parsed.code, parsed.token, parsed.year, parsed.sequence);
  return `${parsed.code}-${parsed.year}-${String(parsed.sequence).padStart(3, '0')}`;
}

export function enrollmentYear(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const when = Number.isNaN(date.getTime()) ? new Date() : date;
  return Number(
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Accra', year: 'numeric' }).format(when)
  );
}

export function chooseSchoolCode(name, usedCodes = []) {
  const taken = new Set(usedCodes.map((code) => String(code || '').toUpperCase()));
  const choices = codeChoices(name);
  return choices.find((code) => !taken.has(code)) || choices[choices.length - 1];
}

export function letterPairs() {
  const pairs = [];
  for (let a = 65; a <= 90; a += 1) {
    for (let b = 65; b <= 90; b += 1) {
      pairs.push(String.fromCharCode(a) + String.fromCharCode(b));
    }
  }
  return pairs;
}

export function nextUniqueToken(students = []) {
  const used = new Set(
    (students || []).map((row) => parseStudentId(row?.roll_number)?.token).filter(Boolean)
  );
  return letterPairs().find((pair) => !used.has(pair)) || 'ZZ';
}

export function classEnrollmentPosition(students, className, createdAt, excludeId) {
  const key = normalizeClass(className);
  const when = String(createdAt || '');
  const earlier = (students || []).filter((row) => {
    if (excludeId && row.id === excludeId) return false;
    if (row.alumni_year != null && Number(row.alumni_year) > 0) return false;
    if (normalizeClass(row.class) !== key) return false;
    if (when && String(row.created_at || '') > when) return false;
    return true;
  }).length;
  return earlier + 1;
}

export function assignMissingIds(students, code) {
  const assigned = [];
  const working = (students || []).map((row) => ({ ...row }));
  const missing = working
    .filter((row) => row?.id && !String(row.roll_number || '').trim())
    .slice()
    .sort(
      (a, b) =>
        String(a.created_at || '').localeCompare(String(b.created_at || '')) ||
        String(a.id).localeCompare(String(b.id))
    );

  for (const row of missing) {
    const year = enrollmentYear(row.created_at || new Date());
    const token = nextUniqueToken(working);
    const sequence = classEnrollmentPosition(working, row.class, row.created_at, row.id);
    const roll_number = formatStudentId(code, token, year, sequence);
    row.roll_number = roll_number;
    assigned.push({ id: row.id, roll_number });
  }
  return assigned;
}

export function nextIdAfter(students, code, year, className) {
  const token = nextUniqueToken(students);
  const sequence = classEnrollmentPosition(students, className, new Date().toISOString());
  return formatStudentId(code, token, year, sequence);
}

const ID_COLUMNS = 'id, roll_number, created_at, class, alumni_year';
const ID_COLUMNS_FALLBACK = 'id, roll_number, created_at, class';

async function selectStudentIdRows(supabase, schoolId, apply) {
  let query = apply(supabase.from('students').select(ID_COLUMNS).eq('school_id', schoolId));
  let { data, error } = await query;
  if (error && String(error.message || '').includes('alumni_year')) {
    const retry = await apply(supabase.from('students').select(ID_COLUMNS_FALLBACK).eq('school_id', schoolId));
    if (retry.error) throw retry.error;
    return retry.data || [];
  }
  if (error) throw error;
  return data || [];
}

async function loadSchoolStudents(supabase, schoolId) {
  return selectStudentIdRows(supabase, schoolId, (query) => query);
}

async function loadMissingStudents(supabase, schoolId, limit = 80) {
  const [nulls, blanks] = await Promise.all([
    selectStudentIdRows(supabase, schoolId, (query) => query.is('roll_number', null).limit(limit)),
    selectStudentIdRows(supabase, schoolId, (query) => query.eq('roll_number', '').limit(limit)),
  ]);
  const byId = new Map();
  for (const row of [...nulls, ...blanks]) {
    if (row?.id) byId.set(row.id, row);
  }
  return [...byId.values()].slice(0, limit);
}

async function codesUsedByOtherSchools(supabase, schoolId, choices) {
  const used = [];
  for (const code of choices) {
    const { data, error } = await supabase
      .from('students')
      .select('school_id, roll_number')
      .neq('school_id', schoolId)
      .ilike('roll_number', `${code}-%`)
      .limit(12);
    if (error) throw error;
    if ((data || []).some((row) => parseStudentId(row.roll_number)?.code === code)) used.push(code);
  }
  return used;
}

async function resolveSchoolCode(supabase, school, rows) {
  const own = (rows || []).map((row) => parseStudentId(row.roll_number)?.code).find(Boolean);
  if (own) return own;
  const choices = codeChoices(school.name);
  const used = await codesUsedByOtherSchools(supabase, school.id, choices);
  return chooseSchoolCode(school.name, used);
}

async function persistAssigned(supabase, schoolId, assigned) {
  for (const row of assigned) {
    const { error } = await supabase
      .from('students')
      .update({ roll_number: row.roll_number })
      .eq('id', row.id)
      .eq('school_id', schoolId);
    if (error) throw error;
  }
}

/** Fill blank student IDs and return the next ID for a new enrollment. */
export async function syncStudentIds(supabase, school, { className, fillOnly = false } = {}) {
  if (!school?.id) throw new Error('School is required');

  if (fillOnly) {
    const missing = await loadMissingStudents(supabase, school.id);
    if (!missing.length) return { assigned: [], code: null, nextId: null };
    const rows = await loadSchoolStudents(supabase, school.id);
    const code = await resolveSchoolCode(supabase, { ...school, name: school.name || 'School' }, rows);
    const assigned = assignMissingIds(rows, code);
    if (assigned.length) await persistAssigned(supabase, school.id, assigned);
    return { code, assigned, nextId: null };
  }

  const rows = await loadSchoolStudents(supabase, school.id);
  const code = await resolveSchoolCode(supabase, { ...school, name: school.name || 'School' }, rows);
  const assigned = assignMissingIds(rows, code);
  if (assigned.length) await persistAssigned(supabase, school.id, assigned);
  const byId = new Map(assigned.map((row) => [row.id, row.roll_number]));
  const merged = rows.map((row) => (byId.has(row.id) ? { ...row, roll_number: byId.get(row.id) } : row));
  return {
    code,
    assigned,
    nextId: nextIdAfter(merged, code, enrollmentYear(new Date()), className),
  };
}
