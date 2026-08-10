import assert from 'node:assert/strict';
import test from 'node:test';
import { enrichOrderRecord, evaluateOrderCycle } from './order-cycle.js';

test('unpaid order past createdAt + 28 days is unresolved expired with cancel_and_redo', () => {
  const now = new Date('2026-08-08T12:00:00.000Z');
  const evaluation = evaluateOrderCycle({
    createdAt: '2026-06-01T10:00:00.000Z',
    paymentStatus: 'pending',
    fulfilmentStatus: 'supplier_pending',
  }, now);
  assert.equal(evaluation.unresolvedReason, 'expired');
  assert.equal(evaluation.redoEligible, true);
  assert.equal(evaluation.recommendation, 'cancel_and_redo');
  assert.equal(evaluation.isPaid, false);
});

test('paid dispatched cycle recommends awaiting_delivery_redo when expired', () => {
  const now = new Date('2026-08-08T12:00:00.000Z');
  const evaluation = evaluateOrderCycle({
    createdAt: '2026-06-01T10:00:00.000Z',
    paymentStatus: 'paid',
    fulfilmentStatus: 'dispatched_to_pharmacy',
    curaleafPoState: 'DISPATCHED',
  }, now);
  assert.equal(evaluation.unresolvedReason, 'expired');
  assert.equal(evaluation.recommendation, 'awaiting_delivery_redo');
});

test('quote recreate_required is unresolved rejected even inside 28 days', () => {
  const now = new Date('2026-08-08T12:00:00.000Z');
  const evaluation = evaluateOrderCycle({
    createdAt: '2026-08-01T10:00:00.000Z',
    paymentStatus: 'paid',
    fulfilmentStatus: 'supplier_pending',
    quoteReview: { status: 'recreate_required' },
  }, now);
  assert.equal(evaluation.unresolvedReason, 'rejected');
  assert.equal(evaluation.redoEligible, true);
});

test('already redone orders are not unresolved', () => {
  const now = new Date('2026-08-08T12:00:00.000Z');
  const evaluation = evaluateOrderCycle({
    createdAt: '2026-06-01T10:00:00.000Z',
    paymentStatus: 'paid',
    fulfilmentStatus: 'collected',
    isExpired: true,
    status: 'archived',
    redoneByOrderId: 'order-new',
  }, now);
  assert.equal(evaluation.unresolvedReason, null);
  assert.equal(evaluation.redoEligible, false);
});

test('collected orders do not become unresolved when the prescription window later expires', () => {
  const evaluation = evaluateOrderCycle({
    createdAt: '2026-01-01T00:00:00.000Z',
    paymentStatus: 'paid',
    fulfilmentStatus: 'collected',
  }, new Date('2026-03-01T00:00:00.000Z'));
  assert.equal(evaluation.unresolvedReason, null);
  assert.equal(evaluation.redoEligible, false);
});

test('enrichOrderRecord exposes stable platform fields', () => {
  const enriched = enrichOrderRecord({
    id: 'ord-1',
    createdAt: '2026-06-01T10:00:00.000Z',
    paymentStatus: 'paid',
    fulfilmentStatus: 'ready_for_collection',
    prescriptions: [{ issueDate: '2026-06-01', expiryDate: '2026-06-29' }],
  }, new Date('2026-08-08T12:00:00.000Z'));
  assert.equal(enriched.unresolvedReason, 'expired');
  assert.equal(enriched.redoEligible, true);
  assert.equal(enriched.isExpired, true);
  assert.equal(enriched.expiryCheck.recommendation, 'ready_to_collect_redo');
});
