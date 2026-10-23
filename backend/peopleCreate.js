import crypto from 'crypto';
import { supabase } from './supabaseClient.js';
import { syncStudentIds } from './studentId.js';

const isMissingColumnError = (error, column) => {
  const msg = String(error?.message || error?.details || error?.hint || '').toLowerCase();
  return Boolean(column) && msg.includes(String(column).toLowerCase());
};

const isNotNullColumnError = (error, column) => {
  const msg = String(error?.message || error?.details || error?.hint || '').toLowerCase();
  const col = String(column || '').toLowerCase();
  return Boolean(col) && msg.includes(col) && (msg.includes('not-null') || msg.includes('not null') || error?.code === '23502');
};

const fillIdentityCodes = (payload) => {
  const code = payload.barcode || payload.qr_code;
  if (!code) return payload;
  if (!payload.barcode) payload.barcode = code;
  if (!payload.qr_code) payload.qr_code = code;
  return payload;
};

const insertWithOptionalColumns = async (table, record, optionalColumns) => {
  const payload = fillIdentityCodes({ ...record });
  for (let attempt = 0; attempt <= optionalColumns.length + 4; attempt++) {
    const { data, error } = await supabase.from(table).insert([payload]).select().single();
    if (!error) return { data, error: null };
    const missingColumn = optionalColumns.find(
      (column) => payload[column] !== undefined && isMissingColumnError(error, column)
    );
    if (missingColumn) {
      delete payload[missingColumn];
      continue;
    }
    if (isNotNullColumnError(error, 'qr_code') && payload.barcode && payload.qr_code !== payload.barcode) {
      payload.qr_code = payload.barcode;
      continue;
    }
    if (isNotNullColumnError(error, 'barcode') && payload.qr_code && payload.barcode !== payload.qr_code) {
      payload.barcode = payload.qr_code;
      continue;
    }
    return { data: null, error };
  }
  return { data: null, error: { message: `Failed to create ${table} record` } };
};

export const toCsvField = (value) => {
  if (value == null || value === '') return null;
  const parts = Array.isArray(value)
    ? value.map((item) => String(item || '').trim()).filter(Boolean)
    : String(value)
        .split(/[,;\n]+/)
        .map((item) => item.trim())
        .filter(Boolean);
  return parts.length ? parts.join(', ') : null;
};

export const parseRequiredGender = (value) => {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'male' || raw === 'm' || raw === 'boy') return 'Male';
  if (raw === 'female' || raw === 'f' || raw === 'girl') return 'Female';
  const error = new Error('Student gender is required');
  error.status = 400;
  throw error;
};

export const parseRequiredSalary = (value) => {
  const raw = String(value ?? '').trim().replace(/[,\s]/g, '');
  const amount = Number(raw);
  if (raw === '' || !Number.isFinite(amount) || amount <= 0) {
    const error = new Error('Staff salary is required');
    error.status = 400;
    throw error;
  }
  return Math.round(amount * 100) / 100;
};

export const generateAccessCode = (length = 16) => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(length);
  return Array.from(bytes, (byte) => chars[byte % chars.length]).join('');
};

export async function createStudent(schoolId, body) {
  const name = String(body.name || '').trim();
  const className = String(body.class || body.className || '').trim();
  const parentPhone = String(body.parentPhone || body.parent_phone || '').trim();
  if (!name) {
    const error = new Error('Student name is required');
    error.status = 400;
    throw error;
  }
  if (!className) {
    const error = new Error('Class is required');
    error.status = 400;
    throw error;
  }
  if (!parentPhone) {
    const error = new Error('Parent phone number is required for SMS');
    error.status = 400;
    throw error;
  }
  const gender = parseRequiredGender(body.gender);

  const barcode = `${schoolId}-STU-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const { data: school } = await supabase.from('schools').select('id, name').eq('id', schoolId).maybeSingle();
  const studentId = school?.name
    ? (await syncStudentIds(supabase, school, { className })).nextId
    : null;

  const record = {
    school_id: schoolId,
    name,
    class: className,
    gender,
    parent_name: String(body.parentName || body.parent_name || '').trim() || null,
    parent_relationship: String(body.parentRelationship || body.parent_relationship || '').trim() || null,
    parent_email: String(body.parentEmail || body.parent_email || '').trim() || null,
    parent_phone: parentPhone,
    house_address: String(body.houseAddress || body.house_address || '').trim() || null,
    date_of_birth: body.dateOfBirth || body.date_of_birth || null,
    roll_number: studentId,
    barcode,
    qr_code: barcode,
    created_at: new Date(),
  };

  const { data, error } = await insertWithOptionalColumns('students', record, [
    'photo_url',
    'gender',
    'parent_phone',
    'parent_name',
    'parent_relationship',
    'house_address',
    'date_of_birth',
    'parent_email',
    'roll_number',
    'barcode',
    'qr_code',
  ]);
  if (error) throw error;
  return data;
}

export async function createStaff(schoolId, body) {
  const name = String(body.name || '').trim();
  const role = String(body.role || '').trim();
  if (!name) {
    const error = new Error('Staff name is required');
    error.status = 400;
    throw error;
  }
  if (!role) {
    const error = new Error('Staff role is required');
    error.status = 400;
    throw error;
  }
  const salary = parseRequiredSalary(body.salary);

  const barcode = `${schoolId}-STAFF-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const accessCode = String(body.secretCode || body.secret_code || '').trim() || generateAccessCode(16);

  const record = {
    school_id: schoolId,
    name,
    role,
    salary,
    barcode,
    qr_code: barcode,
    secret_code: accessCode,
    subjects: toCsvField(body.subjects),
    class_names: toCsvField(body.classNames !== undefined ? body.classNames : body.class_names),
    created_at: new Date(),
  };

  const { data, error } = await insertWithOptionalColumns('staffs', record, [
    'secret_code',
    'subjects',
    'class_names',
    'photo_url',
    'barcode',
    'qr_code',
  ]);
  if (error) throw error;
  return { ...data, secret_code: data.secret_code || accessCode, secretCode: data.secret_code || accessCode };
}

export async function createNonStaff(schoolId, body) {
  const name = String(body.name || '').trim();
  if (!name) {
    const error = new Error('Name is required');
    error.status = 400;
    throw error;
  }
  const barcode = `${schoolId}-NONSTAFF-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const record = {
    school_id: schoolId,
    name,
    role: String(body.role || '').trim() || null,
    barcode,
    qr_code: barcode,
    created_at: new Date(),
  };
  const { data, error } = await insertWithOptionalColumns('nonstaffs', record, [
    'photo_url',
    'barcode',
    'qr_code',
  ]);
  if (error) throw error;
  return data;
}
