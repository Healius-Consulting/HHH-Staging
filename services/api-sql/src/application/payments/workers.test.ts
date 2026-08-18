import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  normaliseWorldpayPaymentQuery,
  worldpayIdentityMatches,
  worldpayPaymentStatus,
  worldpayStatusToSql,
} from './worldpay-query.js';
import { evaluatePendingPaymentLifecycle } from './payment-lifecycle.js';
import { evaluatePrescriptionMaintenance } from '../orders/order-maintenance.js';
import { isAbandonedPrescriptionFile } from '../prescriptions/prescription-file-cleanup.js';
import { eventPollBackoffSeconds, shipmentBelongsToOrder } from '../integrations/curaleaf-events.js';
import { HttpError } from '../../domain/common/errors.js';
import { uuidFromHex } from '../../domain/common/uuid.js';

describe('Worldpay Payment Queries', () => {
  it('normalises the documented Payment Queries result and settlement state', () => {
    const result = normaliseWorldpayPaymentQuery({
      _embedded: {
        payments: [
          {
            transactionReference: 'a-different-payment',
            paymentId: 'wrong-payment',
            lastEvent: 'settlementRequestSubmitted',
          },
          {
            transactionReference: 'HHH-order-123-abcd1234',
            paymentId: 'payment-456',
            lastEvent: 'settlementRequestSubmitted',
            entity: 'PO1234567890',
            value: { amount: 12500, currency: 'GBP' },
          },
        ],
      },
    }, 'HHH-order-123-abcd1234');

    assert.equal(result.found, true);
    assert.equal(result.paymentId, 'payment-456');
    assert.equal(result.providerStatus, 'settlementRequestSubmitted');
    assert.equal(result.paymentStatus, 'paid');
    assert.equal(result.amountPence, 12500);
    assert.equal(result.currency, 'GBP');
    assert.equal(result.entityId, 'PO1234567890');
    assert.equal(worldpayStatusToSql(result.paymentStatus), 'PAID');
  });

  it('does not accept a Payment Queries result for another reference', () => {
    const result = normaliseWorldpayPaymentQuery({
      _embedded: {
        payments: [{ transactionReference: 'different', lastEvent: 'settlementRequestSubmitted' }],
      },
    }, 'expected');
    assert.equal(result.found, false);
    assert.equal(result.paymentStatus, 'pending');
  });

  it('only settlement progress is considered paid', () => {
    assert.equal(worldpayPaymentStatus('authorized'), 'pending');
    assert.equal(worldpayPaymentStatus('authorizationSucceeded'), 'pending');
    assert.equal(worldpayPaymentStatus('sentForSettlement'), 'paid');
    assert.equal(worldpayPaymentStatus('settlementRequestSubmitted'), 'paid');
    assert.equal(worldpayPaymentStatus('saleSucceeded'), 'paid');
    assert.equal(worldpayPaymentStatus('refused'), 'failed');
    assert.equal(worldpayPaymentStatus('expired'), 'expired');
    assert.equal(worldpayPaymentStatus('refundRequestSubmitted'), 'refund_required');
  });

  it('rejects identity mismatches', () => {
    const query = normaliseWorldpayPaymentQuery({
      _embedded: {
        payments: [{
          transactionReference: 'HHH-1',
          lastEvent: 'sentForSettlement',
          entity: 'PO1',
          value: { amount: 100, currency: 'GBP' },
        }],
      },
    }, 'HHH-1');
    assert.equal(worldpayIdentityMatches({
      query,
      transactionReference: 'HHH-1',
      amountPence: 100,
      currency: 'GBP',
      expectedEntityId: 'PO1',
    }), true);
    assert.equal(worldpayIdentityMatches({
      query,
      transactionReference: 'HHH-1',
      amountPence: 999,
      currency: 'GBP',
      expectedEntityId: 'PO1',
    }), false);
  });
});

describe('paid order maintenance', () => {
  it('notifies delay after 48 hours of unfulfilled lines', () => {
    const action = evaluatePrescriptionMaintenance({
      state: 'PLACED',
      lines: [{ ordered: 2, shipped: 0, returned: 0 }],
      delayEpisode: { id: 'ep-1', startedAt: '2026-08-16T07:00:00.000Z' },
      placedAt: '2026-08-16T07:00:00.000Z',
      now: new Date('2026-08-18T08:00:00.000Z'),
    });
    assert.equal(action.type, 'notify_delay');
  });

  it('raises a renewal boundary seven days before expiry', () => {
    const action = evaluatePrescriptionMaintenance({
      state: 'PLACED',
      lines: [{ ordered: 2, shipped: 0, returned: 0 }],
      expiryDate: '2026-08-20',
      now: new Date('2026-08-18T08:00:00.000Z'),
    });
    assert.equal(action.type, 'renewal_boundary');
  });
});

describe('payment lifecycle', () => {
  it('queues a 24 hour reminder for a pending Worldpay link', () => {
    const decision = evaluatePendingPaymentLifecycle({
      payment: {
        status: 'PENDING',
        route: 'WORLDPAY',
        createdAt: '2026-08-17T07:00:00.000Z',
        providerPayload: {},
      },
      quoteSnapshot: { prescriptions: [{ expiryDate: '2026-12-01', items: [] }] },
      now: new Date('2026-08-18T08:00:00.000Z'),
    });
    assert.deepEqual(decision, { action: 'remind', hour: 24 });
  });

  it('voids a pending payment when every prescription has expired', () => {
    const decision = evaluatePendingPaymentLifecycle({
      payment: {
        status: 'PENDING',
        route: 'WORLDPAY',
        createdAt: '2026-08-01T07:00:00.000Z',
        providerPayload: {},
      },
      quoteSnapshot: { prescriptions: [{ expiryDate: '2026-08-10', items: [{ packId: 'p1', quantity: 1 }] }] },
      now: new Date('2026-08-18T08:00:00.000Z'),
    });
    assert.equal(decision.action, 'void_expired');
  });
});

describe('prescription file cleanup', () => {
  it('cleans abandoned pending uploads after 24 hours', () => {
    assert.equal(isAbandonedPrescriptionFile({
      status: 'PENDING_UPLOAD',
      createdAt: '2026-08-16T07:00:00.000Z',
    }, new Date('2026-08-18T07:00:00.000Z')), true);
    assert.equal(isAbandonedPrescriptionFile({
      status: 'UPLOADED',
      createdAt: '2026-08-16T07:00:00.000Z',
    }, new Date('2026-08-18T07:00:00.000Z')), false);
  });
});

describe('Curaleaf poll helpers', () => {
  it('backs off after failures and honours 429 retry-after', () => {
    assert.equal(eventPollBackoffSeconds(new Error('offline'), 10), 300);
    assert.equal(eventPollBackoffSeconds(new HttpError(429, 'limited', 'CURALEAF_REQUEST_FAILED', { retryAfterSeconds: 37 }), 1), 37);
  });

  it('matches shipments to the recorded purchase order', () => {
    const order = {
      id: '5a8b4ac3-236c-41f7-a37b-0132b7892637',
      quoteSnapshot: { curaleaf: { purchaseOrderId: 'po-1' } },
    };
    assert.equal(shipmentBelongsToOrder(order, { purchaseOrderId: 'po-1' }), true);
    assert.equal(shipmentBelongsToOrder(order, { purchaseOrderId: 'other' }), false);
  });
});

describe('worker ids', () => {
  it('builds a UUID from a hex digest', () => {
    assert.equal(uuidFromHex('aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa'), 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  });
});
