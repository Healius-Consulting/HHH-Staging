import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { enquiryDisplayFields, maskEmailAddress, maskPersonName, maskPhoneNumber } from './email-mask.js';

describe('email contact masking', () => {
  it('keeps the first letter of each name part', () => {
    assert.equal(maskPersonName('Avery Patel'), 'A**** P****');
  });

  it('keeps a UK mobile prefix and masks the rest', () => {
    assert.equal(maskPhoneNumber('07700 900000'), '07*********');
  });

  it('keeps the first letter of the local part and domain', () => {
    assert.equal(maskEmailAddress('avery@example.com'), 'a****@e******.com');
  });

  it('masks unmasked payload fields used by older outbox rows', () => {
    const display = enquiryDisplayFields({
      firstName: 'Avery',
      surname: 'Patel',
      mobile: '07700900000',
      email: 'avery@example.com',
    });
    assert.equal(display.name, 'A**** P****');
    assert.equal(display.phone, '07*********');
    assert.equal(display.email, 'a****@e******.com');
  });
});
