import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatPublicSupportBody, parsePublicSupportContact } from '../platformNotifications.js';

test('parses the email from a public support request', () => {
  const body = formatPublicSupportBody({
    fullName: 'Ama Mensah',
    email: 'ama@example.com',
    contact: '0551234567',
    country: 'Ghana',
    location: 'Kumasi',
    message: 'I need help paying fees.',
  });
  const contact = parsePublicSupportContact(body);
  assert.equal(contact.email, 'ama@example.com');
  assert.equal(contact.fullName, 'Ama Mensah');
});
