import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createWorldpayTransactionReference } from './worldpay-reference.js';

describe('createWorldpayTransactionReference', () => {
  it('issues a 128-bit hex reference with a stable prefix', () => {
    const reference = createWorldpayTransactionReference();
    assert.match(reference, /^WP-[0-9a-f]{32}$/);
  });

  it('does not reuse values', () => {
    const first = createWorldpayTransactionReference();
    const second = createWorldpayTransactionReference();
    assert.notEqual(first, second);
  });
});
