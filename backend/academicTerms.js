import { randomUUID } from 'crypto';
import { withSchoolDb } from './supabaseClient.js';
import { academicPeriodFromDate } from './classHierarchy.js';

function currentFeeMonth() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Accra',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  return `${year}-${month}`;
}

export const DEFAULT_TERM_NAMES = ['First Term', 'Second Term', 'Third Term', 'Fourth Term'];

function isMissingTable(error) {
  const msg = String(error?.message || error?.details || '').toLowerCase();
  return error?.code === '42P01' || msg.includes('does not exist') || msg.includes('could not find the table');
}

function todayAccra() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Accra',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  return `${year}-${month}-${day}`;
}

function monthPeriod() {
  const key = currentFeeMonth();
  return {
    key,
    name: key,
    starts_on: null,
    ends_on: null,
    source: 'month',
  };
}

export function formatPeriodLabel(period) {
  if (!period) return '';
  if (period.source === 'month') return period.key;
  const range =
    period.starts_on && period.ends_on ? ` (${period.starts_on} – ${period.ends_on})` : '';
  return `${period.name || 'Term'}${range}`;
}

export async function listAcademicTerms(schoolId) {
  if (!schoolId) return [];
  const { data, error } = await withSchoolDb((db) =>
    db
      .from('academic_terms')
      .select('*')
      .eq('school_id', schoolId)
      .order('sort_order', { ascending: true })
      .order('starts_on', { ascending: true })
  );
  if (error) {
    if (isMissingTable(error)) return [];
    throw error;
  }
  return data || [];
}

export async function replaceAcademicTerms(schoolId, terms) {
  if (!schoolId) {
    const err = new Error('School is required.');
    err.status = 400;
    throw err;
  }

  const cleaned = (terms || [])
    .map((term, index) => ({
      id: term.id || randomUUID(),
      school_id: schoolId,
      name: String(term.name || DEFAULT_TERM_NAMES[index] || `Term ${index + 1}`).trim(),
      sort_order: index + 1,
      starts_on: term.starts_on || null,
      ends_on: term.ends_on || null,
    }))
    .filter((term) => term.name);

  for (const term of cleaned) {
    if (term.starts_on && term.ends_on && term.starts_on > term.ends_on) {
      const err = new Error(`${term.name} ends before it starts.`);
      err.status = 400;
      throw err;
    }
  }

  const removed = await withSchoolDb((db) => db.from('academic_terms').delete().eq('school_id', schoolId));
  if (removed.error) {
    if (isMissingTable(removed.error)) {
      const err = new Error(
        'academic_terms table is missing. Run database/migrations.sql in the Supabase SQL editor.'
      );
      err.status = 503;
      throw err;
    }
    throw removed.error;
  }

  if (!cleaned.length) return [];
  const { data, error } = await withSchoolDb((db) => db.from('academic_terms').insert(cleaned).select('*'));
  if (error) throw error;
  return data || cleaned;
}

/** Current academic term for teacher score entry. Past terms stay stored for admin records. */
export function pickTeacherScoreTerm(terms = [], onDate = todayAccra()) {
  const today = String(onDate || todayAccra());
  const dated = (terms || []).filter((term) => term?.starts_on && term?.ends_on);
  const current = dated.find((term) => term.starts_on <= today && term.ends_on >= today);
  if (current?.name) {
    return {
      name: String(current.name).trim(),
      starts_on: current.starts_on,
      ends_on: current.ends_on,
      source: 'term',
    };
  }
  const upcoming = dated
    .filter((term) => term.starts_on > today)
    .sort((a, b) => String(a.starts_on).localeCompare(String(b.starts_on)))[0];
  if (upcoming?.name) {
    return {
      name: String(upcoming.name).trim(),
      starts_on: upcoming.starts_on,
      ends_on: upcoming.ends_on,
      source: 'upcoming',
    };
  }
  const fromDate = academicPeriodFromDate(today, terms);
  return {
    name: String(fromDate?.term || 'Term 1').trim(),
    starts_on: null,
    ends_on: null,
    source: 'calendar',
  };
}

export async function resolveTeacherScoreTerm(schoolId, onDate = todayAccra()) {
  const terms = schoolId ? await listAcademicTerms(schoolId).catch(() => []) : [];
  return pickTeacherScoreTerm(terms, onDate);
}

export async function resolveFeePeriod(schoolId, onDate = todayAccra()) {
  const terms = await listAcademicTerms(schoolId);
  if (!terms.length) return monthPeriod();

  const today = String(onDate || todayAccra());
  const current = terms.find(
    (term) => term.starts_on && term.ends_on && term.starts_on <= today && term.ends_on >= today
  );
  const upcoming = terms.find((term) => term.starts_on && term.starts_on > today);
  const chosen = current || upcoming || terms[terms.length - 1];

  return {
    key: chosen.id,
    name: chosen.name,
    starts_on: chosen.starts_on,
    ends_on: chosen.ends_on,
    source: 'term',
  };
}

export async function getFeePeriodByKey(schoolId, key) {
  if (!key) return resolveFeePeriod(schoolId);
  const terms = await listAcademicTerms(schoolId);
  const match = terms.find((term) => term.id === key);
  if (match) {
    return {
      key: match.id,
      name: match.name,
      starts_on: match.starts_on,
      ends_on: match.ends_on,
      source: 'term',
    };
  }
  if (!terms.length) {
    return { key, name: key, starts_on: null, ends_on: null, source: 'month' };
  }
  return resolveFeePeriod(schoolId);
}
