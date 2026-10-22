import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isSchoolHeadRole } from '../staffAdminRoutes.js';

test('the administrator role is the head of school in the staff portal', () => {
  assert.equal(isSchoolHeadRole('Administrator'), true);
  assert.equal(isSchoolHeadRole('headteacher'), true);
  assert.equal(isSchoolHeadRole('Teacher'), false);
  assert.equal(isSchoolHeadRole('Accountant'), false);
});
