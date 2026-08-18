import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { maskWorldpayIdentifier, worldpaySecretPayload } from './worldpay.service.js';

describe('Worldpay credential helpers', () => {
  it('omits customisationId unless a value is present', () => {
    assert.deepEqual(worldpaySecretPayload({
      username: 'merchant',
      password: 'secret-pass',
      entityId: 'PO1234567890',
    }), {
      username: 'merchant',
      password: 'secret-pass',
      entityId: 'PO1234567890',
    });
  });

  it('stores customisationId beside merchant credentials', () => {
    assert.deepEqual(worldpaySecretPayload({
      username: 'merchant',
      password: 'secret-pass',
      entityId: 'PO1234567890',
      customisationId: 'hpp-channel-123',
    }), {
      username: 'merchant',
      password: 'secret-pass',
      entityId: 'PO1234567890',
      customisationId: 'hpp-channel-123',
    });
  });

  it('masks the merchant entity without returning the full identifier', () => {
    const masked = maskWorldpayIdentifier('PO4098149633');
    assert.equal(masked.endsWith('9633'), true);
    assert.equal(masked.includes('PO4098'), false);
  });
});
