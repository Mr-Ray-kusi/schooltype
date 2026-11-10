import assert from 'node:assert/strict';
import { test } from 'node:test';
import { academicTermHasEnded, pickFeePeriod } from '../academicTerms.js';
import { shouldHoldPublishedResult } from '../feePayments.js';
import {
  clearStudentPortalFailures,
  decryptPortalPassword,
  encryptPortalPassword,
  generatePortalPassword,
  portalSecretMatchesSchool,
  recordStudentPortalFailure,
  studentPortalLocked,
} from '../studentPortalStore.js';
import { portalDirectorySchools, portalSchoolsSearchTerm, studentPortalDetails } from '../studentPortalRoutes.js';

process.env.JWT_SECRET =
  process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 32
    ? process.env.JWT_SECRET
    : 'test-secret-key-change-this-32chars!!';

test('the student portal lists every school without asking for a search first', () => {
  assert.equal(portalSchoolsSearchTerm(''), '');
  assert.equal(portalSchoolsSearchTerm(' '), '');
  assert.equal(portalSchoolsSearchTerm('a'), '');
  assert.equal(portalSchoolsSearchTerm('  acacia  '), 'acacia');
});

test('registered schools stay on the student portal list before a plan is approved', () => {
  const schools = portalDirectorySchools([
    { id: 'pending', name: 'Achimota School', role: 'admin', plan_status: 'pending' },
    { id: 'plain', name: 'Ridge International', role: 'school' },
    { id: 'admin-only', role: 'super_admin', name: 'Platform', plan_status: 'approved' },
    { id: 'blank', name: '   ', role: 'admin' },
    {
      id: 'logo',
      name: 'East Legon Academy',
      role: 'admin',
      logo_url: `data:image/png;base64,${'a'.repeat(3000)}`,
    },
  ]);
  assert.deepEqual(
    schools.map((school) => school.name),
    ['Achimota School', 'East Legon Academy', 'Ridge International']
  );
  assert.equal(schools.find((school) => school.id === 'logo').logo_url, null);
  assert.equal(schools.find((school) => school.id === 'pending').id, 'pending');
});

test('the student portal shows the same personal details the school keeps on file', () => {
  const details = studentPortalDetails(
    {
      id: 'stu-1',
      name: 'KELVIN KUSI',
      class: 'JHS 3',
      roll_number: 'SCH-AF-2026-001',
      barcode: 'SCH-AF-2026-001',
      gender: 'Male',
      date_of_birth: '2001-10-22',
      parent_name: 'RAYMOND KUSI',
      parent_relationship: 'Father',
      parent_phone: '596149016',
      parent_email: 'KUSIRAYMOND208@GMAIL',
      house_address: 'MAGAZINE',
      extra_fees: [{ label: 'School bus', amount: 30 }],
    },
    '3597'
  );
  assert.equal(details.roll_number, 'SCH-AF-2026-001');
  assert.equal(details.portal_password, '3597');
  assert.equal(details.parent_name, 'RAYMOND KUSI');
  assert.equal(details.parent_phone, '596149016');
  assert.equal(details.gender, 'Male');
  assert.equal(details.date_of_birth, '2001-10-22');
  assert.deepEqual(details.extra_fees, [{ label: 'School bus', amount: 30 }]);
});

test('a student portal password is four digits and is not reused in that school', () => {
  const password = generatePortalPassword(['1234', '0000', '1111']);
  assert.match(password, /^\d{4}$/);
  assert.equal(['0000', '1111', '1234'].includes(password), false);
  const again = generatePortalPassword([password]);
  assert.notEqual(again, password);
});

test('a portal password from one school does not open another school', () => {
  const secret = { student_id: 'stu-1', school_id: 'school-a' };
  assert.equal(portalSecretMatchesSchool(secret, 'school-a'), true);
  assert.equal(portalSecretMatchesSchool(secret, 'school-b'), false);
  assert.equal(portalSecretMatchesSchool(secret, ''), false);
  assert.equal(portalSecretMatchesSchool(null, 'school-a'), false);
});

test('the office can read back the password it issued', () => {
  const hidden = encryptPortalPassword('4821');
  assert.equal(decryptPortalPassword(hidden), '4821');
  assert.equal(decryptPortalPassword('not-a-password'), null);
});

test('a published result stays hidden after the term ends until fees are paid', () => {
  const firstTerm = { id: 'term-1', name: 'First Term', ends_on: '2026-04-10' };
  assert.equal(academicTermHasEnded(firstTerm, '2026-04-10'), false);
  assert.equal(academicTermHasEnded(firstTerm, '2026-04-11'), true);
  assert.equal(academicTermHasEnded({ ends_on: null }, '2026-04-11'), false);

  assert.equal(
    shouldHoldPublishedResult({ published: true, termEnded: true, billed: 800, outstanding: 120 }),
    true
  );
  assert.equal(
    shouldHoldPublishedResult({ published: true, termEnded: true, billed: 800, outstanding: 0 }),
    false
  );
  assert.equal(
    shouldHoldPublishedResult({ published: true, termEnded: false, billed: 800, outstanding: 120 }),
    false
  );
  assert.equal(
    shouldHoldPublishedResult({ published: false, termEnded: true, billed: 800, outstanding: 120 }),
    false
  );
  assert.equal(
    shouldHoldPublishedResult({ published: true, termEnded: true, billed: 0, outstanding: 0 }),
    false
  );
});

test('fee collection stays on the ended term until the next one starts', () => {
  const terms = [
    { id: 't1', name: 'First Term', starts_on: '2026-01-10', ends_on: '2026-04-10' },
    { id: 't2', name: 'Second Term', starts_on: '2026-05-04', ends_on: '2026-08-07' },
  ];
  assert.equal(pickFeePeriod(terms, '2026-03-01').key, 't1');
  assert.equal(pickFeePeriod(terms, '2026-04-20').key, 't1');
  assert.equal(pickFeePeriod(terms, '2026-05-04').key, 't2');
});

test('five wrong portal passwords lock that student ID for the window', () => {
  const key = `school-portal-test-${Date.now()}`;
  clearStudentPortalFailures(key);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    recordStudentPortalFailure(key);
    assert.equal(studentPortalLocked(key), false);
  }
  recordStudentPortalFailure(key);
  assert.equal(studentPortalLocked(key), true);
  clearStudentPortalFailures(key);
  assert.equal(studentPortalLocked(key), false);
});
