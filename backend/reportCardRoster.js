import { supabase } from './supabaseClient.js';

function missingColumn(error, column) {
  const msg = String(error?.message || error?.details || '').toLowerCase();
  const name = String(column || '').toLowerCase();
  return (
    error?.code === '42703' ||
    (msg.includes(name) &&
      (msg.includes('does not exist') || msg.includes('could not find') || msg.includes('schema cache')))
  );
}

export async function listReportClasses(schoolId) {
  const classQuery = supabase.from('classes').select('name').eq('school_id', schoolId);
  const studentsQuery = async () => {
    let { data, error } = await supabase
      .from('students')
      .select('class')
      .eq('school_id', schoolId)
      .is('alumni_year', null)
      .limit(8000);
    if (error && missingColumn(error, 'alumni_year')) {
      ({ data, error } = await supabase
        .from('students')
        .select('class')
        .eq('school_id', schoolId)
        .limit(8000));
    }
    return { data, error };
  };

  const [{ data: classRows, error: classError }, studentRes] = await Promise.all([classQuery, studentsQuery()]);
  if (classError) throw classError;
  if (studentRes.error) throw studentRes.error;

  const classCounts = {};
  for (const row of studentRes.data || []) {
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
  let { data, error } = await supabase
    .from('students')
    .select(columns)
    .eq('school_id', schoolId)
    .eq('class', wanted)
    .is('alumni_year', null)
    .order('name', { ascending: true })
    .limit(800);
  if (error && missingColumn(error, 'alumni_year')) {
    ({ data, error } = await supabase
      .from('students')
      .select(columns)
      .eq('school_id', schoolId)
      .eq('class', wanted)
      .order('name', { ascending: true })
      .limit(800));
  }
  if (error) throw error;
  return data || [];
}
