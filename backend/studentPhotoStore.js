import path from 'path';
import fs from 'fs';
import { openLocalDb } from './localDb.js';
import { getDataDir } from './dataPaths.js';
import { platformSupabase } from './supabaseClient.js';

const DATA_DIR = getDataDir();
const DB_PATH = path.join(DATA_DIR, 'school-extras.db');
const useMemory = Boolean(process.env.VERCEL);

let dbPromise = null;
const cache = new Map();

async function getDb() {
  if (useMemory) return null;
  if (!dbPromise) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    dbPromise = Promise.resolve(openLocalDb(DB_PATH)).then(async (db) => {
      await db.exec(`
        CREATE TABLE IF NOT EXISTS person_photos (
          person_id TEXT PRIMARY KEY,
          school_id TEXT NOT NULL,
          photo_url TEXT NOT NULL
        )
      `);
      await db.exec(
        'CREATE INDEX IF NOT EXISTS idx_person_photos_school ON person_photos(school_id)'
      );

      try {
        await db.exec(`
          INSERT OR IGNORE INTO person_photos (person_id, school_id, photo_url)
          SELECT student_id, school_id, photo_url FROM student_photos
        `);
      } catch {
        // student_photos table may not exist
      }
      return db;
    });
  }
  return dbPromise;
}

export async function initPersonPhotoStore() {
  if (platformSupabase) {
    const { data, error } = await platformSupabase
      .from('person_photos')
      .select('person_id, school_id, photo_url')
      .limit(5000);
    if (!error) {
      cache.clear();
      (data || []).forEach((row) => cache.set(row.person_id, row));
      if (useMemory) return;
    }
  }
  if (useMemory) {
    cache.clear();
    return;
  }
  const db = await getDb();
  const rows = await db.all('SELECT person_id, school_id, photo_url FROM person_photos');
  cache.clear();
  rows.forEach((row) => cache.set(row.person_id, row));
}

export const initStudentPhotoStore = initPersonPhotoStore;

export function getPersonPhotoSync(personId) {
  return cache.get(personId)?.photo_url || null;
}

export const getStudentPhotoSync = getPersonPhotoSync;

export async function setPersonPhoto(personId, schoolId, photoUrl) {
  if (!personId || !schoolId || !photoUrl) return;

  cache.set(personId, { person_id: personId, school_id: schoolId, photo_url: photoUrl });

  if (platformSupabase) {
    const { error } = await platformSupabase.from('person_photos').upsert(
      {
        person_id: personId,
        school_id: schoolId,
        photo_url: photoUrl,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'person_id' }
    );
    if (error && error.code !== '42P01') {
      console.warn('Failed to persist person photo:', error.message);
    }
  }

  const db = await getDb();
  if (!db) return;

  await db.run(
    `INSERT INTO person_photos (person_id, school_id, photo_url)
     VALUES (?, ?, ?)
     ON CONFLICT(person_id) DO UPDATE SET
       school_id = excluded.school_id,
       photo_url = excluded.photo_url`,
    [personId, schoolId, photoUrl]
  );
}

export const setStudentPhoto = setPersonPhoto;

export async function deletePersonPhoto(personId) {
  if (!personId) return;

  cache.delete(personId);
  if (platformSupabase) {
    await platformSupabase.from('person_photos').delete().eq('person_id', personId);
  }
  const db = await getDb();
  if (!db) return;

  await db.run('DELETE FROM person_photos WHERE person_id = ?', [personId]);
}

export const deleteStudentPhoto = deletePersonPhoto;

export function mergePersonPhoto(record) {
  if (!record?.id) return record;

  // Prefer durable Supabase photo_url; local/memory cache is only a fallback.
  const localPhoto = getPersonPhotoSync(record.id);
  const photoUrl = record.photo_url || localPhoto || null;
  if (photoUrl === record.photo_url) return record;
  return { ...record, photo_url: photoUrl };
}

export const mergeStudentPhoto = mergePersonPhoto;

export function mergePersonPhotos(records) {
  return (records || []).map(mergePersonPhoto);
}

export const mergeStudentPhotos = mergePersonPhotos;
