import assert from 'node:assert/strict';
import { test } from 'node:test';
import { absenceMessage, buildAbsentSmsBodies, groupAbsentParents } from '../absentNotify.js';

test('absent parent SMS groups siblings on one phone', () => {
  const groups = groupAbsentParents([
    { name: 'Kofi Mensah', class: 'JHS 1', parent_phone: '0244000001' },
    { name: 'Ama Mensah', class: 'JHS 2', parent_phone: '0244000001' },
    { name: 'Yaw Boateng', class: 'JHS 1', parent_phone: '0244000002' },
  ]);
  assert.equal(groups.length, 2);
  const first = groups.find((group) => group.students.length === 2);
  assert.equal(first.students.length, 2);
});

test('the built-in absence message names the child and the school', () => {
  assert.match(absenceMessage('Kofi Mensah', 'JHS 1', 'Bright Future'), /Kofi Mensah/);
  assert.match(absenceMessage('Kofi Mensah', 'JHS 1', 'Bright Future'), /Bright Future/);
  const bodies = buildAbsentSmsBodies(
    [
      {
        phone: '233244000001',
        students: [
          { name: 'Kofi Mensah', class: 'JHS 1' },
          { name: 'Ama Mensah', class: 'JHS 2' },
        ],
      },
    ],
    'Bright Future'
  );
  assert.match(bodies['233244000001'], /Kofi Mensah/);
  assert.match(bodies['233244000001'], /Ama Mensah/);
  assert.match(bodies['233244000001'], /did not come to school today/);
});
