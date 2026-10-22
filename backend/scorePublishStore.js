import fs from 'fs';
import path from 'path';
import { supabase } from './supabaseClient.js';
import { getDataDir } from './dataPaths.js';

const FILE_PATH = path.join(getDataDir(), 'score-publish-locks.json');
const memory = new Map();

export function scoreLockKey(term, className) {
  return `${String(term || '').trim()}|${String(className || '').trim()}`;
}

const emptyState = () => ({ locks: {}, updatedAt: null });

const readFileAll = () => {
  try {
    if (fs.existsSync(FILE_PATH)) return JSON.parse(fs.readFileSync(FILE_PATH, 'utf8'));
  } catch {
    /* ignore */
  }
  return {};
};

const writeFileAll = (all) => {
  try {
    fs.mkdirSync(path.dirname(FILE_PATH), { recursive: true });
    fs.writeFileSync(FILE_PATH, JSON.stringify(all));
  } catch {
    /* Render disk may be read-only; memory still works for this instance */
  }
};

export function inspectScoreLock(locks, { term, className, staffId }) {
  const exact = locks?.[scoreLockKey(term, className)] || null;
  const termWide = locks?.[scoreLockKey(term, '*')] || null;
  const published = Boolean(exact?.published || termWide?.published);
  if (!published) return { published: false, canEdit: true, allowStaffIds: [] };
  const allowStaffIds = [
    ...new Set([...(exact?.allowStaffIds || []), ...(termWide?.allowStaffIds || [])].map(String)),
  ];
  return {
    published: true,
    canEdit: staffId ? allowStaffIds.includes(String(staffId)) : false,
    allowStaffIds,
    publishedAt: exact?.publishedAt || termWide?.publishedAt || null,
    publishedBy: exact?.publishedBy || termWide?.publishedBy || null,
  };
}

export async function loadScoreLocks(schoolId) {
  if (!schoolId) return emptyState();
  if (memory.has(schoolId)) return memory.get(schoolId);
  try {
    const { data, error } = await supabase
      .from('student_score_locks')
      .select('locks, updated_at')
      .eq('school_id', schoolId)
      .maybeSingle();
    if (!error && data) {
      const state = { locks: data.locks || {}, updatedAt: data.updated_at || null };
      memory.set(schoolId, state);
      return state;
    }
  } catch {
    /* table may not exist yet */
  }
  const fromFile = readFileAll()[schoolId] || emptyState();
  memory.set(schoolId, fromFile);
  return fromFile;
}

export async function saveScoreLocks(schoolId, next) {
  const state = {
    locks: next.locks || {},
    updatedAt: new Date().toISOString(),
  };
  memory.set(schoolId, state);
  const all = readFileAll();
  all[schoolId] = state;
  writeFileAll(all);
  try {
    const payload = { school_id: schoolId, locks: state.locks, updated_at: state.updatedAt };
    const { error } = await supabase.from('student_score_locks').upsert(payload, { onConflict: 'school_id' });
    if (error && error.code !== '42P01') {
      console.warn('Score publish lock persist:', error.message);
    }
  } catch (error) {
    console.warn('Score publish lock persist:', error.message);
  }
  return state;
}

export async function publishScoreLocks(schoolId, { term, classNames, staffId, staffName }) {
  const current = await loadScoreLocks(schoolId);
  const locks = { ...current.locks };
  const names = (classNames || []).map((name) => String(name || '').trim()).filter(Boolean);
  const targets = names.length ? names : ['*'];
  for (const className of targets) {
    const key = scoreLockKey(term, className);
    locks[key] = {
      ...(locks[key] || {}),
      published: true,
      publishedAt: new Date().toISOString(),
      publishedBy: staffName || staffId || 'Administrator',
      allowStaffIds: locks[key]?.allowStaffIds || [],
    };
  }
  return saveScoreLocks(schoolId, { locks });
}

export async function unpublishScoreLocks(schoolId, { term, classNames }) {
  const current = await loadScoreLocks(schoolId);
  const locks = { ...current.locks };
  const names = (classNames || []).map((name) => String(name || '').trim()).filter(Boolean);
  const targets = names.length ? names : ['*'];
  for (const className of targets) {
    delete locks[scoreLockKey(term, className)];
  }
  if (!names.length) {
    for (const key of Object.keys(locks)) {
      if (key.startsWith(`${String(term).trim()}|`)) delete locks[key];
    }
  }
  return saveScoreLocks(schoolId, { locks });
}

export async function allowTeacherScoreEdit(schoolId, { term, className, staffId, allow }) {
  const current = await loadScoreLocks(schoolId);
  const key = scoreLockKey(term, className || '*');
  const entry = {
    published: true,
    ...(current.locks[key] || {}),
    allowStaffIds: [...new Set([...(current.locks[key]?.allowStaffIds || [])].map(String))],
  };
  const id = String(staffId);
  if (allow === false) {
    entry.allowStaffIds = entry.allowStaffIds.filter((item) => item !== id);
  } else if (!entry.allowStaffIds.includes(id)) {
    entry.allowStaffIds.push(id);
  }
  return saveScoreLocks(schoolId, { locks: { ...current.locks, [key]: entry } });
}
