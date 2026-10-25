import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assignMissingIds,
  chooseSchoolCode,
  classEnrollmentPosition,
  displayStudentId,
  enrollmentYear,
  formatStudentId,
  isInternalAttendanceCode,
  nextIdAfter,
  parseStudentId,
  schoolCodeFromName,
} from '../studentId.js';

test('a school code is short letters from the school name', () => {
  assert.equal(schoolCodeFromName('Bright Future Academy'), 'BFA');
  assert.equal(schoolCodeFromName('Sunrise School'), 'SUN');
  assert.equal(schoolCodeFromName("St. Mary's Basic"), 'SMB');
});

test('a student ID is school, unique letters, enrollment year, and class position', () => {
  const id = formatStudentId('BFA', 'AS', 2026, 14);
  assert.equal(id, 'BFA-AS-2026-014');
  assert.equal(parseStudentId(id)?.code, 'BFA');
  assert.equal(parseStudentId(id)?.token, 'AS');
  assert.equal(parseStudentId(id)?.year, 2026);
  assert.equal(parseStudentId(id)?.sequence, 14);
  assert.equal(parseStudentId('BFA-2026-014')?.token, null);
  assert.equal(parseStudentId('12'), null);
  assert.equal(parseStudentId('2026-001'), null);
});

test('each school keeps its own code when another school already uses the first choice', () => {
  assert.equal(chooseSchoolCode('Bright Future Academy', ['BFA']), 'BFB');
});

test('class position is how many people were already in that class', () => {
  const rows = [
    { id: 'a', class: 'JHS 2', created_at: '2026-01-01' },
    { id: 'b', class: 'JHS 2', created_at: '2026-02-01' },
    { id: 'c', class: 'JHS 1', created_at: '2026-02-01' },
  ];
  assert.equal(classEnrollmentPosition(rows, 'JHS 2', '2026-03-01'), 3);
  assert.equal(classEnrollmentPosition(rows, 'JHS 1', '2026-03-01'), 2);
});

test('blank students get a unique pair and a class position, not a school-wide rank', () => {
  const rows = [
    { id: 'a', class: 'JHS 2', roll_number: 'BFA-AA-2026-001', created_at: '2026-01-02' },
    { id: 'b', class: 'JHS 2', roll_number: null, created_at: '2026-03-01' },
    { id: 'c', class: 'JHS 1', roll_number: '', created_at: '2025-09-01' },
    { id: 'd', class: 'JHS 2', roll_number: '12', created_at: '2024-01-01' },
    {
      id: 'e',
      class: 'JHS 2',
      roll_number: 'f45151f7-cba8-46dc-865c-5e32e22d0228-STU-1792620267070-49a5dd15',
      created_at: '2026-04-01',
    },
  ];
  const assigned = assignMissingIds(rows, 'BFA');
  assert.equal(assigned.find((row) => row.id === 'c').roll_number, 'BFA-AB-2025-001');
  assert.equal(assigned.find((row) => row.id === 'b').roll_number, 'BFA-AC-2026-003');
  assert.equal(rows.find((row) => row.id === 'd').roll_number, '12');
  assert.match(assigned.find((row) => row.id === 'e').roll_number, /^BFA-[A-Z]{2}-2026-\d{3}$/);
  assert.equal(
    displayStudentId({
      roll_number: 'f45151f7-cba8-46dc-865c-5e32e22d0228-STU-1792620267070-49a5dd15',
    }),
    ''
  );
  assert.equal(isInternalAttendanceCode('school-STU-1-abc'), true);
});

test('the next enrollment continues with a new unique pair in that class', () => {
  assert.equal(
    nextIdAfter(
      [
        { class: 'JHS 2', roll_number: 'SUN-AA-2026-001' },
        { class: 'JHS 2', roll_number: 'SUN-AB-2026-002' },
      ],
      'SUN',
      2026,
      'JHS 2'
    ),
    'SUN-AC-2026-003'
  );
});

test('enrollment year follows the Accra calendar year', () => {
  assert.equal(enrollmentYear(new Date('2026-01-01T00:30:00.000Z')), 2026);
});
