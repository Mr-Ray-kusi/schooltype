import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.AUTH_STORE = 'local';

const {
  createAuthSession,
  getAuthSession,
  getAuthSessionById,
  revokeAuthSessionById,
  revokeSchoolSessions,
  rotateAuthSession,
  clearStaffSession,
  isStaffSessionActive,
  setStaffSession,
  setStudentPortalSession,
  clearStudentPortalSession,
  isStudentRefreshActive,
} = await import('../sessionStore.js');

test('refresh rotation keeps one server session and drops the previous token', async () => {
  const schoolId = `school-refresh-${Date.now()}`;
  const row = await createAuthSession({
    schoolId,
    token: 'refresh-a',
    expiresAt: Date.now() + 60_000,
  });
  assert.equal((await getAuthSessionById(row.id)).status, 'ok');
  const rotated = await rotateAuthSession(row.id, 'refresh-a', 'refresh-b');
  assert.equal(rotated?.id, row.id);
  assert.equal((await getAuthSession('refresh-a')).status === 'ok', false);
  assert.equal((await getAuthSession('refresh-b')).status, 'ok');
  assert.equal(await rotateAuthSession(row.id, 'refresh-a', 'refresh-c'), null);
});

test('ending a session on the server rejects that login', async () => {
  const schoolId = `school-end-${Date.now()}`;
  const row = await createAuthSession({
    schoolId,
    token: 'refresh-live',
    expiresAt: Date.now() + 60_000,
  });
  await revokeAuthSessionById(row.id);
  assert.equal((await getAuthSessionById(row.id)).status, 'revoked');
  assert.equal((await getAuthSession('refresh-live')).status, 'revoked');
});

test('a new school password ends every session for that login', async () => {
  const schoolId = `school-password-${Date.now()}`;
  await createAuthSession({ schoolId, token: 'device-1', expiresAt: Date.now() + 60_000 });
  await createAuthSession({ schoolId, token: 'device-2', expiresAt: Date.now() + 60_000 });
  await revokeSchoolSessions(schoolId);
  assert.equal((await getAuthSession('device-1')).status, 'revoked');
  assert.equal((await getAuthSession('device-2')).status, 'revoked');
});

test('a new staff access code signs that staff out', () => {
  const staffId = `staff-password-${Date.now()}`;
  setStaffSession(staffId, 'staff-refresh');
  assert.equal(isStaffSessionActive(staffId, 'staff-refresh'), true);
  clearStaffSession(staffId);
  assert.equal(isStaffSessionActive(staffId, 'staff-refresh'), false);
});

test('a new student portal password signs that student out', () => {
  const studentId = `student-password-${Date.now()}`;
  const refreshHash = setStudentPortalSession(studentId, 'student-refresh');
  assert.equal(isStudentRefreshActive(studentId, refreshHash), true);
  clearStudentPortalSession(studentId);
  assert.equal(isStudentRefreshActive(studentId, refreshHash), false);
});
