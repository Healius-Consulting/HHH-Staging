import assert from 'node:assert/strict';
import test from 'node:test';
import { FLOW_CONFIG, validDispensingFeePence } from './flow-config.js';
import { addCalendarMonths, deterministicSubOrderId, messageId, patientRetentionState, paymentLinkExpiryAt, prescriptionIsCurrent } from './order-flow.js';

test('master-flow defaults retain the dated Curaleaf and pricing decisions', () => {
  assert.equal(FLOW_CONFIG.linkExpiryHours, 72);
  assert.equal(FLOW_CONFIG.placementMarginFloor, 0.15);
  assert.equal(FLOW_CONFIG.delayNotifyHours, 48);
  assert.equal(FLOW_CONFIG.stockBoundaryDays, 7);
  assert.equal(FLOW_CONFIG.advisoryMarginPct, 0.25);
  assert.equal(FLOW_CONFIG.eventPollSeconds, 60);
});

test('dispensing charge is absent or inside the five-to-fifteen-pound band', () => {
  assert.equal(validDispensingFeePence(0), true);
  assert.equal(validDispensingFeePence(500), true);
  assert.equal(validDispensingFeePence(1_500), true);
  assert.equal(validDispensingFeePence(499), false);
  assert.equal(validDispensingFeePence(1_501), false);
});

test('payment link expires at 72 hours or the earliest payable prescription', () => {
  const sentAt = new Date('2026-08-01T10:00:00.000Z');
  assert.equal(paymentLinkExpiryAt([{ issueDate: '2026-07-07', expiryDate: '2026-08-04' }], sentAt), '2026-08-04T10:00:00.000Z');
  assert.equal(paymentLinkExpiryAt([{ issueDate: '2026-07-06', expiryDate: '2026-08-03' }], sentAt), '2026-08-03T23:59:59.999Z');
});

test('expired and cancelled prescriptions are excluded from link expiry', () => {
  const sentAt = new Date('2026-08-01T10:00:00.000Z');
  assert.equal(paymentLinkExpiryAt([{ issueDate: '2026-07-01', expiryDate: '2026-08-01', payable: false }], sentAt), '2026-08-04T10:00:00.000Z');
  assert.equal(prescriptionIsCurrent({ issueDate: '2026-07-04', expiryDate: '2026-08-01' }, new Date('2026-08-02T00:00:00Z')), false);
});

test('sub-order and message idempotency keys are deterministic', () => {
  assert.equal(deterministicSubOrderId('order', 'scan', 0), deterministicSubOrderId('order', 'scan', 0));
  assert.equal(messageId(['order', 'shipment', 'ready']), messageId(['order', 'shipment', 'ready']));
});

test('calendar-month anchoring clamps month-end and retention becomes inactive after 28 overdue days', () => {
  assert.equal(addCalendarMonths(new Date('2026-01-31T12:00:00Z'), 1).toISOString(), '2026-02-28T12:00:00.000Z');
  assert.equal(patientRetentionState('2026-08-01T12:00:00.000Z', new Date('2026-08-02T12:00:00Z')), 'at_risk');
  assert.equal(patientRetentionState('2026-08-01T12:00:00.000Z', new Date('2026-08-29T12:00:00Z')), 'inactive');
});
