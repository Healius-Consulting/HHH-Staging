import assert from 'node:assert/strict';
import test from 'node:test';
import { normaliseWorldpayPaymentQuery, parseWorldpayWebhookEvent, worldpayPaymentStatus } from './worldpay.js';

test('parses the documented nested Worldpay webhook event', () => {
  const event = parseWorldpayWebhookEvent({
    eventId: 'evt-123',
    eventTimestamp: '2026-08-10T10:00:00.000Z',
    eventDetails: {
      type: 'sentForSettlement',
      transactionReference: 'HHH-order-123-abcd1234',
      paymentId: 'payment-456',
      merchant: { entity: 'PO1234567890' },
      amount: { value: 12500, currencyCode: 'GBP' },
    },
  });

  assert.deepEqual(event, {
    eventId: 'evt-123',
    eventTimestamp: '2026-08-10T10:00:00.000Z',
    transactionReference: 'HHH-order-123-abcd1234',
    type: 'sentForSettlement',
    entityId: 'PO1234567890',
    paymentId: 'payment-456',
    amountPence: 12500,
    currency: 'GBP',
  });
});

test('rejects a webhook without the required nested event details', () => {
  assert.throws(() => parseWorldpayWebhookEvent({
    eventId: 'evt-123',
    transactionReference: 'root-level-reference-is-not-valid',
    type: 'sentForSettlement',
  }), /invalid payment event/i);
});

test('normalises the documented Payment Queries result and settlement state', () => {
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
});

test('does not accept a Payment Queries result for another reference', () => {
  const result = normaliseWorldpayPaymentQuery({
    _embedded: {
      payments: [{ transactionReference: 'different', lastEvent: 'settlementRequestSubmitted' }],
    },
  }, 'expected');

  assert.equal(result.found, false);
  assert.equal(result.paymentStatus, 'pending');
});

test('only settlement progress is considered paid', () => {
  assert.equal(worldpayPaymentStatus('authorized'), 'pending');
  assert.equal(worldpayPaymentStatus('authorizationSucceeded'), 'pending');
  assert.equal(worldpayPaymentStatus('sentForSettlement'), 'paid');
  assert.equal(worldpayPaymentStatus('settlementRequestSubmitted'), 'paid');
  assert.equal(worldpayPaymentStatus('saleSucceeded'), 'paid');
  assert.equal(worldpayPaymentStatus('refused'), 'failed');
  assert.equal(worldpayPaymentStatus('authorizationRefused'), 'failed');
  assert.equal(worldpayPaymentStatus('settlementRequestSubmissionFailed'), 'failed');
  assert.equal(worldpayPaymentStatus('settlementFailed'), 'failed');
  assert.equal(worldpayPaymentStatus('cancellationRequestSubmitted'), 'cancelled');
  assert.equal(worldpayPaymentStatus('expired'), 'expired');
  assert.equal(worldpayPaymentStatus('refundRequestSubmitted'), 'refund_required');
  assert.equal(worldpayPaymentStatus('refundFailed'), 'refund_required');
  assert.equal(worldpayPaymentStatus('refunded'), 'refunded');
});
