import assert from 'node:assert/strict';
import { test } from 'node:test';
import { listStudentFeeCharges, parseExtraFees, resolveStudentFeeAmount } from '../feePayments.js';
import { attachFeePayLink, toE164 } from '../smsProvider.js';
import { buildOwingFeeSmsBodies, groupOwingParents } from '../feeReminderSms.js';

test('owing fee SMS groups each parent phone with that child pay link', () => {
  const origin = 'https://schooltype.vercel.app';
  const groups = groupOwingParents(
    [
      { name: 'Kofi Mensah', parent_phone: '0244000001', barcode: 'sch-kofi', school_id: 'school-1' },
      { name: 'Ama Mensah', parent_phone: '0244000001', barcode: 'sch-ama', school_id: 'school-1' },
      { name: 'Yaw Boateng', parent_phone: '0244000002', barcode: 'sch-yaw', school_id: 'school-1' },
      { name: 'No Phone', parent_phone: '', barcode: 'sch-none', school_id: 'school-1' },
    ],
    origin
  );

  assert.equal(groups.length, 2);
  const kofiPhone = toE164('0244000001');
  const family = groups.find((row) => row.phone === kofiPhone);
  assert.equal(family.links.length, 2);
  assert.ok(family.links.some((link) => link.url.includes('/pay/sch-kofi?school=school-1')));
  assert.ok(family.links.some((link) => link.url.includes('/pay/sch-ama?school=school-1')));

  const bodies = buildOwingFeeSmsBodies(
    'Dear Parent, please settle outstanding school fees. Pay here: {pay_link}',
    groups
  );
  assert.match(bodies[kofiPhone], /\/pay\/sch-kofi\?school=school-1/);
  assert.match(bodies[kofiPhone], /\/pay\/sch-ama\?school=school-1/);
  assert.doesNotMatch(bodies[kofiPhone], /\{pay_link\}/);
});

test('extra student charges sit on top of the class school fee', () => {
  assert.equal(resolveStudentFeeAmount({ extra_fees: [{ label: 'School bus', amount: 150 }] }, 800), 950);
  assert.equal(resolveStudentFeeAmount({ monthly_fee: 1200 }, 800), 1200);
  assert.equal(resolveStudentFeeAmount({}, 800), 800);
});

test('term fee charges list the class fee and each extra on its own line', () => {
  assert.deepEqual(listStudentFeeCharges({ extra_fees: [{ label: 'School bus', amount: 150 }] }, 800), [
    { label: 'Term fee', amount: 800 },
    { label: 'School bus', amount: 150 },
  ]);
  assert.deepEqual(listStudentFeeCharges({ extra_fees: [{ amount: 40 }, { amount: 20 }] }, 500), [
    { label: 'Term fee', amount: 500 },
    { label: 'Extra 1', amount: 40 },
    { label: 'Extra 2', amount: 20 },
  ]);
  assert.deepEqual(listStudentFeeCharges({ monthly_fee: 1200 }, 800), [{ label: 'Term fee', amount: 1200 }]);
});


test('an extra charge counts with or without a reason saved beside it', () => {
  assert.equal(resolveStudentFeeAmount({ extra_fees: [{ amount: 150 }] }, 800), 950);
  assert.deepEqual(parseExtraFees([{ amount: 150 }]), [{ label: 'Extra', amount: 150 }]);
  assert.deepEqual(parseExtraFees([{ label: 'School bus', amount: 150 }]), [
    { label: 'School bus', amount: 150 },
  ]);
  assert.deepEqual(parseExtraFees([{ label: 'School bus' }, { amount: 0 }, { amount: -5 }]), []);
});

test('fee reminder copy drops the generic /fees page when a student link is added', () => {
  const next = attachFeePayLink(
    'Please pay using https://schooltype.vercel.app/fees today.',
    'https://schooltype.vercel.app/pay/sch-kofi'
  );
  assert.match(next, /\/pay\/sch-kofi/);
  assert.doesNotMatch(next, /\/fees\b/);
});
