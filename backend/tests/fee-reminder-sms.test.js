import assert from 'node:assert/strict';
import { test } from 'node:test';
import { attachFeePayLink, toE164 } from '../smsProvider.js';
import { buildOwingFeeSmsBodies, groupOwingParents } from '../feeReminderSms.js';

test('owing fee SMS groups each parent phone with that child pay link', () => {
  const origin = 'https://schooltype.vercel.app';
  const groups = groupOwingParents(
    [
      { name: 'Kofi Mensah', parent_phone: '0244000001', barcode: 'sch-kofi' },
      { name: 'Ama Mensah', parent_phone: '0244000001', barcode: 'sch-ama' },
      { name: 'Yaw Boateng', parent_phone: '0244000002', barcode: 'sch-yaw' },
      { name: 'No Phone', parent_phone: '', barcode: 'sch-none' },
    ],
    origin
  );

  assert.equal(groups.length, 2);
  const kofiPhone = toE164('0244000001');
  const family = groups.find((row) => row.phone === kofiPhone);
  assert.equal(family.links.length, 2);
  assert.ok(family.links.some((link) => link.url.endsWith('/pay/sch-kofi')));
  assert.ok(family.links.some((link) => link.url.endsWith('/pay/sch-ama')));

  const bodies = buildOwingFeeSmsBodies(
    'Dear Parent, please settle outstanding school fees. Pay here: {pay_link}',
    groups
  );
  assert.match(bodies[kofiPhone], /\/pay\/sch-kofi/);
  assert.match(bodies[kofiPhone], /\/pay\/sch-ama/);
  assert.doesNotMatch(bodies[kofiPhone], /\{pay_link\}/);
});

test('fee reminder copy drops the generic /fees page when a student link is added', () => {
  const next = attachFeePayLink(
    'Please pay using https://schooltype.vercel.app/fees today.',
    'https://schooltype.vercel.app/pay/sch-kofi'
  );
  assert.match(next, /\/pay\/sch-kofi/);
  assert.doesNotMatch(next, /\/fees\b/);
});
