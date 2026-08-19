import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { pendingPaymentsToCancel, selectLivePayment } from './live-payment.js';
import type { PaymentRecord } from '../../repositories/ports/payment.port.js';

function payment(partial: Partial<PaymentRecord> & { id: string; status: PaymentRecord['status'] }): PaymentRecord {
  return {
    organisationId: 'org',
    orderId: 'order',
    amountPence: 1000,
    currency: 'GBP',
    route: 'WORLDPAY',
    receiptHash: null,
    version: 1,
    createdAt: '2026-08-19T00:00:00.000Z',
    ...partial,
  };
}

describe('selectLivePayment', () => {
  it('prefers a paid row over later pending links', () => {
    const live = selectLivePayment([
      payment({ id: 'pending-new', status: 'PENDING', createdAt: '2026-08-19T12:00:00.000Z' }),
      payment({ id: 'paid', status: 'PAID', createdAt: '2026-08-19T10:00:00.000Z' }),
      payment({ id: 'cancelled', status: 'CANCELLED', createdAt: '2026-08-19T11:00:00.000Z' }),
    ]);
    assert.equal(live?.id, 'paid');
  });

  it('uses the newest pending row when nothing is paid', () => {
    const live = selectLivePayment([
      payment({ id: 'old', status: 'PENDING', createdAt: '2026-08-19T10:00:00.000Z' }),
      payment({ id: 'new', status: 'PENDING', createdAt: '2026-08-19T12:00:00.000Z' }),
    ]);
    assert.equal(live?.id, 'new');
  });

  it('ignores cancelled and failed siblings instead of treating them as live', () => {
    const live = selectLivePayment([
      payment({ id: 'cancelled', status: 'CANCELLED', createdAt: '2026-08-19T13:00:00.000Z' }),
      payment({ id: 'failed', status: 'FAILED', createdAt: '2026-08-19T12:00:00.000Z' }),
      payment({ id: 'pending', status: 'PENDING', createdAt: '2026-08-19T11:00:00.000Z' }),
    ]);
    assert.equal(live?.id, 'pending');
    assert.equal(selectLivePayment([
      payment({ id: 'cancelled', status: 'CANCELLED' }),
    ]), null);
  });
});

describe('pendingPaymentsToCancel', () => {
  it('drops every pending sibling except the kept id', () => {
    const cancelled = pendingPaymentsToCancel([
      payment({ id: 'keep', status: 'PENDING' }),
      payment({ id: 'old', status: 'PENDING' }),
      payment({ id: 'paid', status: 'PAID' }),
    ], 'keep');
    assert.deepEqual(cancelled.map(row => row.id), ['old']);
  });
});
