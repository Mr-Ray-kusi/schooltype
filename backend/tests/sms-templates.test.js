import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fillSmsTemplate, requireSmsTemplate } from '../smsTemplates.js';

test('fee and absence placeholders are filled from the edited message', () => {
  assert.equal(
    fillSmsTemplate('{student_name} missed {school_name}.', {
      student_name: 'Ama Mensah',
      school_name: 'Bright Future',
    }),
    'Ama Mensah missed Bright Future.'
  );
  assert.equal(
    fillSmsTemplate('Pay here: {pay_link}', { pay_link: 'https://school.test/pay/ama' }),
    'Pay here: https://school.test/pay/ama'
  );
});

test('a blank or oversized SMS template is rejected', () => {
  assert.throws(() => requireSmsTemplate('   '), /Enter a message/);
  assert.throws(() => requireSmsTemplate('x'.repeat(481)), /480/);
  assert.equal(requireSmsTemplate('  Fees are due.  '), 'Fees are due.');
});
