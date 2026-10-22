import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isSchoolHeadRole } from '../staffAdminRoutes.js';
import { inspectScoreLock, scoreLockKey } from '../scorePublishStore.js';

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
