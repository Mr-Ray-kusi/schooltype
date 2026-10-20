import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.AUTH_STORE = 'local';

const {
  createAuthSession,
  getAuthSession,
  trimSchoolAdminSessions,
  setStaffSession,
  isStaffSessionActive,
  claimScannerSlot,
  releaseScannerSlot,
} = await import('../sessionStore.js');

test('a school admin can keep only two live devices', async () => {
  const schoolId = `school-admin-${Date.now()}`;
  await createAuthSession({ schoolId, token: 'admin-1', expiresAt: Date.now() + 60_000 });
  await createAuthSession({ schoolId, token: 'admin-2', expiresAt: Date.now() + 60_000 });
  await createAuthSession({ schoolId, token: 'admin-3', expiresAt: Date.now() + 60_000 });
  await trimSchoolAdminSessions(schoolId, 'admin-3');

  assert.equal((await getAuthSession('admin-1')).status, 'revoked');
  assert.equal((await getAuthSession('admin-2')).status, 'ok');
  assert.equal((await getAuthSession('admin-3')).status, 'ok');
});

test('each staff login replaces the previous device', () => {
  const staffId = `staff-${Date.now()}`;
  setStaffSession(staffId, 'staff-token-a');
  assert.equal(isStaffSessionActive(staffId, 'staff-token-a'), true);
  setStaffSession(staffId, 'staff-token-b');
  assert.equal(isStaffSessionActive(staffId, 'staff-token-a'), false);
  assert.equal(isStaffSessionActive(staffId, 'staff-token-b'), true);
  assert.equal(isStaffSessionActive(`other-${staffId}`, 'staff-token-a'), true);
});

test('attendance scanner allows two devices and blocks a third', () => {
  const schoolId = `scan-school-${Date.now()}`;
  assert.equal(claimScannerSlot(schoolId, 'phone-a').allowed, true);
  assert.equal(claimScannerSlot(schoolId, 'phone-b').allowed, true);
  assert.equal(claimScannerSlot(schoolId, 'phone-a').allowed, true);
  const third = claimScannerSlot(schoolId, 'phone-c');
  assert.equal(third.allowed, false);
  releaseScannerSlot(schoolId, 'phone-a');
  assert.equal(claimScannerSlot(schoolId, 'phone-c').allowed, true);
});
