import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isSchoolHeadRole } from '../staffAdminRoutes.js';
import { inspectScoreLock, scoreLockKey } from '../scorePublishStore.js';
import { parseRequiredGender } from '../peopleCreate.js';
import { isProtectedStaffRole, staffPortalApiAllowed } from '../staffSchoolAuth.js';

test('the administrator role is the head of school in the staff portal', () => {
  assert.equal(isSchoolHeadRole('Administrator'), true);
  assert.equal(isSchoolHeadRole('headteacher'), true);
  assert.equal(isSchoolHeadRole('Teacher'), false);
  assert.equal(isSchoolHeadRole('Accountant'), false);
});

test('published reports lock teachers unless the administrator allows one', () => {
  const key = scoreLockKey('Term 1', 'JHS 2');
  const locks = {
    [key]: { published: true, allowStaffIds: ['teacher-allowed'] },
  };
  const closed = inspectScoreLock(locks, { term: 'Term 1', className: 'JHS 2', staffId: 'teacher-other' });
  const allowed = inspectScoreLock(locks, { term: 'Term 1', className: 'JHS 2', staffId: 'teacher-allowed' });
  const open = inspectScoreLock({}, { term: 'Term 1', className: 'JHS 2', staffId: 'teacher-other' });
  assert.equal(closed.published, true);
  assert.equal(closed.canEdit, false);
  assert.equal(allowed.canEdit, true);
  assert.equal(open.published, false);
  assert.equal(open.canEdit, true);
});

test('student gender must be male or female', () => {
  assert.equal(parseRequiredGender('male'), 'Male');
  assert.equal(parseRequiredGender('Female'), 'Female');
  assert.throws(() => parseRequiredGender(''), /required/i);
});

test('administrator and accountant records are protected from other staff', () => {
  assert.equal(isProtectedStaffRole('Administrator'), true);
  assert.equal(isProtectedStaffRole('Accountant'), true);
  assert.equal(isProtectedStaffRole('Teacher'), false);
});

test('staff administrator can use academic APIs and not wallet transfers', () => {
  const admin = { role: 'Administrator' };
  assert.equal(staffPortalApiAllowed(admin, { method: 'POST', path: '/api/students' }).ok, true);
  assert.equal(staffPortalApiAllowed(admin, { method: 'PUT', path: '/api/classes/1' }).ok, true);
  assert.equal(staffPortalApiAllowed(admin, { method: 'GET', path: '/api/attendance' }).ok, true);
  assert.equal(staffPortalApiAllowed(admin, { method: 'GET', path: '/api/alumni' }).ok, true);
  assert.equal(staffPortalApiAllowed(admin, { method: 'POST', path: '/api/alumni/complete' }).ok, true);
  assert.equal(staffPortalApiAllowed(admin, { method: 'POST', path: '/api/scanner/regenerate' }).ok, true);
  assert.equal(staffPortalApiAllowed(admin, { method: 'GET', path: '/api/staff-portal/link' }).ok, true);
  assert.equal(staffPortalApiAllowed(admin, { method: 'POST', path: '/api/staff-portal/regenerate' }).ok, true);
  assert.equal(staffPortalApiAllowed(admin, { method: 'POST', path: '/api/wallet/deposit' }).ok, false);
});

test('accountant can manage fees and view wallet but cannot deposit or withdraw', () => {
  const accountant = { role: 'Accountant' };
  assert.equal(staffPortalApiAllowed(accountant, { method: 'GET', path: '/api/fees/overview' }).ok, true);
  assert.equal(staffPortalApiAllowed(accountant, { method: 'POST', path: '/api/fees/manual' }).ok, true);
  assert.equal(staffPortalApiAllowed(accountant, { method: 'GET', path: '/api/wallet' }).ok, true);
  assert.equal(staffPortalApiAllowed(accountant, { method: 'POST', path: '/api/wallet/deposit' }).ok, false);
  assert.equal(staffPortalApiAllowed(accountant, { method: 'POST', path: '/api/wallet/withdraw' }).ok, false);
  assert.equal(staffPortalApiAllowed(accountant, { method: 'POST', path: '/api/students' }).ok, false);
});
