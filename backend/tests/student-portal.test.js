import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  clearStudentPortalFailures,
  decryptPortalPassword,
  encryptPortalPassword,
  generatePortalPassword,
  recordStudentPortalFailure,
  studentPortalLocked,
} from '../studentPortalStore.js';

test('a student portal password is four digits and is not reused in that school', () => {
  const password = generatePortalPassword(['1234', '0000', '1111']);
  assert.match(password, /^\d{4}$/);
  assert.notEqual(password, '1234');
  assert.notEqual(password, '0000');
  const again = generatePortalPassword([password]);
  assert.notEqual(again, password);
});

test('the office can read back the password it issued', () => {
  const hidden = encryptPortalPassword('4821');
  assert.equal(decryptPortalPassword(hidden), '4821');
  assert.equal(decryptPortalPassword('not-a-password'), null);
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
