import path from 'path';
import fs from 'fs';
import { openLocalDb } from './localDb.js';
import { getDataDir } from './dataPaths.js';
import { useLocalDiskStore } from './runtime.js';
import { parseExtraFees } from './feePayments.js';
import { platformSupabase, supabase } from './supabaseClient.js';

const DB_PATH = path.join(getDataDir(), 'school-extras.db');
const cache = new Map();
let dbPromise = null;

function profileDb() {
  return platformSupabase || supabase;
}

async function getDb() {
  if (!useLocalDiskStore()) return null;
  if (!dbPromise) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    dbPromise = Promise.resolve(openLocalDb(DB_PATH)).then(async (db) => {
      await db.exec(`
        CREATE TABLE IF NOT EXISTS student_fields (
          student_id TEXT PRIMARY KEY,
          school_id TEXT NOT NULL,
          gender TEXT,
          extra_fees TEXT
        )
      `);
      return db;
    });
  }
  return dbPromise;
}

function remember(studentId, row) {
  if (!studentId || !row) return;
  cache.set(String(studentId), row);
}

export async function upsertStudentFields(schoolId, studentId, fields = {}) {
  if (!schoolId || !studentId) return null;
  const current = cache.get(String(studentId)) || {};
  const next = {
    gender: fields.gender !== undefined ? fields.gender || null : current.gender || null,
    extra_fees:
      fields.extra_fees !== undefined
        ? parseExtraFees(fields.extra_fees)
        : parseExtraFees(current.extra_fees),
  };
  remember(studentId, next);
  const db = await getDb();
  if (db) {
    await db.run(
      `INSERT INTO student_fields (student_id, school_id, gender, extra_fees)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(student_id) DO UPDATE SET
         school_id = excluded.school_id,
         gender = excluded.gender,
         extra_fees = excluded.extra_fees`,
      [String(studentId), String(schoolId), next.gender, JSON.stringify(next.extra_fees)]
    );
  }
  return next;
}

export async function getStudentFields(studentId) {
  if (!studentId) return null;
  const cached = cache.get(String(studentId));
  if (cached) return cached;
  const db = await getDb();
  if (!db) return null;
  const row = await db.get('SELECT gender, extra_fees FROM student_fields WHERE student_id = ?', [
    String(studentId),
  ]);
  if (!row) return null;
  const parsed = { gender: row.gender || null, extra_fees: parseExtraFees(row.extra_fees) };
  remember(studentId, parsed);
  return parsed;
}

export function mergeStudentFieldsSync(record, extra) {
  if (!record || typeof record !== 'object') return record;
  const fromRow = parseExtraFees(record.extra_fees ?? record.extraFees);
  const fromStore = parseExtraFees(extra?.extra_fees);
  const extras = fromRow.length ? fromRow : fromStore;
  return {
    ...record,
    gender: record.gender || extra?.gender || null,
    extra_fees: extras,
    extraFees: extras,
  };
}

export async function writeStudentProfileFields(schoolId, studentId, fields = {}) {
  if (!schoolId || !studentId) return null;
  const stored = await upsertStudentFields(schoolId, studentId, fields);
  const db = profileDb();
  if (!db) return stored;
  const payload = {};
  if (fields.gender !== undefined) payload.gender = fields.gender || null;
  if (fields.extra_fees !== undefined) {
    const rows = parseExtraFees(fields.extra_fees);
    payload.extra_fees = rows.length ? rows : null;
  }
  if (!Object.keys(payload).length) return stored;

  let { error } = await db.from('students').update(payload).eq('id', studentId).eq('school_id', schoolId);
  if (error && Object.prototype.hasOwnProperty.call(payload, 'extra_fees') && Array.isArray(payload.extra_fees)) {
    payload.extra_fees = JSON.stringify(payload.extra_fees);
    ({ error } = await db.from('students').update(payload).eq('id', studentId).eq('school_id', schoolId));
  }
  if (error) {
    console.warn('Student gender/extra charges persist:', error.message || error);
  }
  return stored;
}

export async function mergeStudentFields(record, schoolId) {
  if (!record?.id) return record;
  const db = profileDb();
  let remote = null;
  if (db) {
    const { data } = await db
      .from('students')
      .select('gender, extra_fees')
      .eq('id', record.id)
      .maybeSingle();
    remote = data;
  }
  const stored = await getStudentFields(record.id);
  return mergeStudentFieldsSync(
    { ...record, gender: record.gender || remote?.gender, extra_fees: record.extra_fees ?? remote?.extra_fees },
    stored
  );
}

const FIELD_LOOKUP_CHUNK = 100;

async function getStudentFieldsMap(ids) {
  const wanted = [...new Set((ids || []).map(String).filter(Boolean))];
  const found = new Map();
  const missing = [];
  for (const id of wanted) {
    const cached = cache.get(id);
    if (cached) found.set(id, cached);
    else missing.push(id);
  }
  if (!missing.length) return found;
  const db = await getDb();
  if (!db) return found;
  for (let i = 0; i < missing.length; i += FIELD_LOOKUP_CHUNK) {
    const slice = missing.slice(i, i + FIELD_LOOKUP_CHUNK);
    const placeholders = slice.map(() => '?').join(',');
    const rows = await db.all(
      `SELECT student_id, gender, extra_fees FROM student_fields WHERE student_id IN (${placeholders})`,
      slice
    );
    for (const row of rows || []) {
      const parsed = { gender: row.gender || null, extra_fees: parseExtraFees(row.extra_fees) };
      remember(row.student_id, parsed);
      found.set(String(row.student_id), parsed);
    }
  }
  return found;
}

export async function mergeStudentFieldList(records, schoolId) {
  const list = records || [];
  if (!list.length) return list;
  const ids = list.map((row) => row?.id).filter(Boolean);
  const remoteById = new Map();
  const db = profileDb();
  if (db && ids.length) {
    for (let i = 0; i < ids.length; i += FIELD_LOOKUP_CHUNK) {
      const slice = ids.slice(i, i + FIELD_LOOKUP_CHUNK);
      const { data } = await db.from('students').select('id, gender, extra_fees').in('id', slice);
      for (const row of data || []) remoteById.set(row.id, row);
    }
  }
  const storedById = await getStudentFieldsMap(ids);
  return list.map((row) => {
    const remote = remoteById.get(row.id);
    const stored = storedById.get(String(row.id));
    return mergeStudentFieldsSync(
      { ...row, gender: row.gender || remote?.gender, extra_fees: row.extra_fees ?? remote?.extra_fees },
      stored
    );
  });
}
