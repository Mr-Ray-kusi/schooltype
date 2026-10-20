import path from 'path';
import fs from 'fs';
import { openLocalDb } from './localDb.js';
import { getDataDir } from './dataPaths.js';
import { platformSupabase } from './supabaseClient.js';
import { useLocalDiskStore } from './runtime.js';

const DATA_DIR = getDataDir();
const DB_PATH = path.join(DATA_DIR, 'school-extras.db');
const MAX_CACHED_PHOTOS = 40;

let dbPromise = null;
const cache = new Map();

function rememberPhoto(personId, row) {
  if (cache.has(personId)) cache.delete(personId);
  cache.set(personId, row);
  while (cache.size > MAX_CACHED_PHOTOS) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
}

async function getDb() {
  if (!useLocalDiskStore()) return null;
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

export async function purgePersonPhotos() {
  cache.clear();

  if (platformSupabase) {
    const { error: deleteError } = await platformSupabase.from('person_photos').delete().neq('person_id', '');
    if (deleteError && deleteError.code !== '42P01') {
      console.warn('Could not empty person_photos:', deleteError.message);
    }

    for (const table of ['students', 'staffs', 'nonstaffs']) {
      const { error } = await platformSupabase.from(table).update({ photo_url: null }).not('photo_url', 'is', null);
      if (error && error.code !== '42P01' && !String(error.message || '').includes('photo_url')) {
        console.warn(`Could not clear ${table} photos:`, error.message);
      }
    }
  }

  const db = await getDb();
  if (db) {
    try {
      await db.run('DELETE FROM person_photos');
    } catch {
      // local table may not exist
    }
    try {
      await db.run('DELETE FROM student_photos');
    } catch {
      // older local table may not exist
    }
  }

  console.log('Removed student, staff, and non-staff photos. School logos were kept.');
}

export async function initPersonPhotoStore() {
  cache.clear();
  await purgePersonPhotos();
}

export const initStudentPhotoStore = initPersonPhotoStore;

export function getPersonPhotoSync(personId) {
  return cache.get(personId)?.photo_url || null;
}

export const getStudentPhotoSync = getPersonPhotoSync;

export async function setPersonPhoto(personId) {
  if (personId) await deletePersonPhoto(personId);
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
  if (!record || typeof record !== 'object') return record;
  if (!('photo_url' in record) && !record.photoUrl) return record;
  const next = { ...record, photo_url: null };
  if ('photoUrl' in next) next.photoUrl = null;
  return next;
}

export const mergeStudentPhoto = mergePersonPhoto;

export function mergePersonPhotos(records) {
  return (records || []).map(mergePersonPhoto);
}

export const mergeStudentPhotos = mergePersonPhotos;
