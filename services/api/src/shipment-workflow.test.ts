import assert from 'node:assert/strict';
import test from 'node:test';
import { canMarkShipmentReady, shipmentReceiptStatus } from './shipment-workflow.js';

test('a short pharmacy delivery remains partially received', () => {
  assert.equal(shipmentReceiptStatus([
    { expectedQuantity: 2, receivedQuantity: 1, issue: 'short' },
  ]), 'partially_received');
});

test('a complete pharmacy delivery stops at received until RTC is selected', () => {
  assert.equal(shipmentReceiptStatus([
    { expectedQuantity: 2, receivedQuantity: 2, issue: 'none' },
  ]), 'received');
});

test('ready to collect is locked until a complete receipt exists', () => {
  assert.equal(canMarkShipmentReady('partially_received'), false);
  assert.equal(canMarkShipmentReady('received'), true);
});
