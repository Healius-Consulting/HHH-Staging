import { randomBytes } from 'node:crypto';

const WORLDPAY_REFERENCE_BYTES = 16;

export function createWorldpayTransactionReference(): string {
  return `WP-${randomBytes(WORLDPAY_REFERENCE_BYTES).toString('hex')}`;
}
