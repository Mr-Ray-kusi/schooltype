import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import { openLocalDb } from './localDb.js';
import { getDataDir } from './dataPaths.js';
import { useLocalDiskStore } from './runtime.js';
import { platformSupabase, supabase } from './supabaseClient.js';
import { ensureSharedRuntimeTables } from './dbPooler.js';
import { clearStudentPortalSession } from './sessionStore.js';

const DB_PATH = path.join(getDataDir(), 'school-extras.db');
const FAIL_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 5;
const BLOCKED_PASSWORDS = new Set(['0000', '1111', '1234', '1212', '2222', '2580']);

const fails = new Map();
let dbPromise = null;

function cloudDb() {
  return platformSupabase || supabase;
}

function cipherKey() {
  const secret = String(process.env.JWT_SECRET || '');
  if (!secret || secret === 'your-secret-key-change-this' || secret.length < 32) {
    const error = new Error('JWT_SECRET is required to protect student portal passwords');
    error.status = 503;
    throw error;
  }
  return crypto.createHash('sha256').update(secret).digest();
}

export function encryptPortalPassword(password) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', cipherKey(), iv);
  const enc = Buffer.concat([cipher.update(String(password), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

export function decryptPortalPassword(payload) {
  try {
    const buf = Buffer.from(String(payload || ''), 'base64');
    if (buf.length < 29) return null;
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const enc = buf.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', cipherKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

export function portalSecretMatchesSchool(secret, schoolId) {
  if (!secret || schoolId == null || schoolId === '') return false;
  return String(secret.school_id) === String(schoolId);
}

export function generatePortalPassword(used = []) {
  const taken = new Set((Array.isArray(used) ? used : []).map((value) => String(value)));
  for (const blocked of BLOCKED_PASSWORDS) taken.add(blocked);
  if (taken.size >= 10000) {
    const error = new Error('Could not issue a unique student password. Reset one and try again.');
    error.status = 409;
    throw error;
  }
  const start = crypto.randomInt(0, 10000);
  for (let offset = 0; offset < 10000; offset += 1) {
    const password = String((start + offset) % 10000).padStart(4, '0');
    if (!taken.has(password)) return password;
  }
  const error = new Error('Could not issue a unique student password. Reset one and try again.');
  error.status = 409;
  throw error;
}

export function studentPortalLocked(key) {
  const row = fails.get(String(key || 'unknown'));
  if (!row) return false;
  if (Date.now() - row.start > FAIL_WINDOW_MS) {
    fails.delete(String(key));
    return false;
  }
  return row.count >= MAX_FAILS;
}

export function recordStudentPortalFailure(key) {
  const id = String(key || 'unknown');
  const now = Date.now();
  const row = fails.get(id);
  if (!row || now - row.start > FAIL_WINDOW_MS) {
    fails.set(id, { count: 1, start: now });
    return 1;
  }
  row.count += 1;
  return row.count;
}

export function clearStudentPortalFailures(key) {
  fails.delete(String(key || 'unknown'));
}

async function localDb() {
  if (!useLocalDiskStore()) return null;
  if (!dbPromise) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    dbPromise = Promise.resolve(openLocalDb(DB_PATH)).then(async (db) => {
      await db.exec(`
        CREATE TABLE IF NOT EXISTS school_student_portals (
          school_id TEXT PRIMARY KEY,
          enabled INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS student_portal_secrets (
          student_id TEXT PRIMARY KEY,
          school_id TEXT NOT NULL,
          password_hash TEXT NOT NULL,
          password_enc TEXT NOT NULL
        );
      `);
      return db;
    });
  }
  return dbPromise;
}

function missingTable(error) {
  const msg = String(error?.message || error?.details || '').toLowerCase();
  return error?.code === '42P01' || msg.includes('does not exist') || msg.includes('could not find the table');
}

async function usedPasswords(schoolId) {
  const passwords = [];
  const db = cloudDb();
  if (db) {
    const { data, error } = await db
      .from('student_portal_secrets')
      .select('password_enc')
      .eq('school_id', schoolId);
    if (!error) {
      for (const row of data || []) {
        const password = decryptPortalPassword(row.password_enc);
        if (password) passwords.push(password);
      }
    }
  }
  const local = await localDb();
  if (local) {
    const rows = await local.all('SELECT password_enc FROM student_portal_secrets WHERE school_id = ?', [
      String(schoolId),
    ]);
    for (const row of rows || []) {
      const password = decryptPortalPassword(row.password_enc);
      if (password) passwords.push(password);
    }
  }
  return passwords;
}

async function writeSecret(schoolId, studentId, password) {
  const row = {
    student_id: studentId,
    school_id: schoolId,
    password_hash: await bcrypt.hash(password, 10),
    password_enc: encryptPortalPassword(password),
    updated_at: new Date().toISOString(),
  };
  const db = cloudDb();
  let saved = false;
  let cloudMessage = '';
  if (db) {
    let { error } = await db.from('student_portal_secrets').upsert(row, { onConflict: 'student_id' });
    if (error && missingTable(error)) {
      await ensureSharedRuntimeTables().catch(() => {});
      ({ error } = await db.from('student_portal_secrets').upsert(row, { onConflict: 'student_id' }));
    }
    if (error && /updated_at/i.test(String(error.message || error.details || ''))) {
      const { updated_at: _updated, ...withoutStamp } = row;
      ({ error } = await db.from('student_portal_secrets').upsert(withoutStamp, { onConflict: 'student_id' }));
    }
    if (!error) saved = true;
    else cloudMessage = error.message || 'Could not save the portal password';
  }
  const local = await localDb();
  if (local) {
    await local.run(
      `INSERT INTO student_portal_secrets (student_id, school_id, password_hash, password_enc)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(student_id) DO UPDATE SET
         school_id = excluded.school_id,
         password_hash = excluded.password_hash,
         password_enc = excluded.password_enc`,
      [String(studentId), String(schoolId), row.password_hash, row.password_enc]
    );
    saved = true;
  }
  if (!saved) {
    const error = new Error(cloudMessage || 'Could not save the portal password');
    error.status = 500;
    throw error;
  }
  return row;
}

export async function issueStudentPortalPassword(schoolId, studentId) {
  if (!schoolId || !studentId) return null;
  const password = generatePortalPassword(await usedPasswords(schoolId));
  await writeSecret(schoolId, studentId, password);
  clearStudentPortalSession(studentId);
  return { password };
}

async function readSecret(studentId) {
  const db = cloudDb();
  if (db) {
    const { data, error } = await db
      .from('student_portal_secrets')
      .select('student_id, school_id, password_hash, password_enc')
      .eq('student_id', studentId)
      .maybeSingle();
    if (!error && data) return data;
  }
  const local = await localDb();
  if (!local) return null;
  return local.get(
    'SELECT student_id, school_id, password_hash, password_enc FROM student_portal_secrets WHERE student_id = ?',
    [String(studentId)]
  );
}

export async function revealStudentPortalPassword(schoolId, studentId) {
  const row = await readSecret(studentId);
  if (!portalSecretMatchesSchool(row, schoolId)) return null;
  return decryptPortalPassword(row.password_enc);
}

export async function verifyStudentPortalPassword(schoolId, studentId, password) {
  const row = await readSecret(studentId);
  if (!portalSecretMatchesSchool(row, schoolId) || !row.password_hash) return false;
  return bcrypt.compare(String(password || ''), row.password_hash);
}

export async function deleteStudentPortalPassword(studentId) {
  if (!studentId) return;
  const db = cloudDb();
  if (db) {
    const { error } = await db.from('student_portal_secrets').delete().eq('student_id', studentId);
    if (error && !missingTable(error)) console.warn('Student portal password delete:', error.message);
  }
  const local = await localDb();
  if (local) {
    await local.run('DELETE FROM student_portal_secrets WHERE student_id = ?', [String(studentId)]);
  }
}
