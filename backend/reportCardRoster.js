import { supabase } from './supabaseClient.js';
import { fetchAllRows } from './pagedQuery.js';

function missingColumn(error, column) {
  const msg = String(error?.message || error?.details || '').toLowerCase();
  const name = String(column || '').toLowerCase();
  return (
    error?.code === '42703' ||
    (msg.includes(name) &&
      (msg.includes('does not exist') || msg.includes('could not find') || msg.includes('schema cache')))
  );
}

async function loadReportClassRows(schoolId) {
  const load = (enrolledOnly) =>
    fetchAllRows(() => {
      let query = supabase.from('students').select('class').eq('school_id', schoolId).order('id', { ascending: true });
      if (enrolledOnly) query = query.is('alumni_year', null);
      return query;
    });
  try {
    return await load(true);
  } catch (error) {
    if (!missingColumn(error, 'alumni_year')) throw error;
    return load(false);
  }
}

export async function listReportClasses(schoolId) {
  const classQuery = supabase.from('classes').select('name').eq('school_id', schoolId);
  const [{ data: classRows, error: classError }, studentRows] = await Promise.all([
    classQuery,
    loadReportClassRows(schoolId),
  ]);
  if (classError) throw classError;

  const classCounts = {};
  for (const row of studentRows || []) {
    const name = String(row.class || '').trim();
    if (!name) continue;
    classCounts[name] = (classCounts[name] || 0) + 1;
  }

  const classes = [
    ...new Set(
      [...(classRows || []).map((row) => String(row.name || '').trim()), ...Object.keys(classCounts)].filter(Boolean)
    ),
  ];
  return { classes, classCounts };
}

export async function listClassRoster(schoolId, className) {
  const wanted = String(className || '').trim();
  if (!wanted || wanted === 'all') return [];
  const columns = 'id, name, class, roll_number';
  const load = (enrolledOnly) =>
    fetchAllRows(() => {
      let query = supabase
        .from('students')
        .select(columns)
        .eq('school_id', schoolId)
        .eq('class', wanted)
        .order('name', { ascending: true })
        .order('id', { ascending: true });
      if (enrolledOnly) query = query.is('alumni_year', null);
      return query;
    });
  try {
    return await load(true);
  } catch (error) {
    if (!missingColumn(error, 'alumni_year')) throw error;
    return load(false);
  }
}
