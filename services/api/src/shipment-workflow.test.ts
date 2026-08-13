import assert from 'node:assert/strict';
import test from 'node:test';
import { canMarkShipmentReady, prescriptionCollectionRollup, receivedLinesHaveBatchDetails, shipmentReceiptStatus } from './shipment-workflow.js';

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

test('every received medicine requires batch number and expiry', () => {
  assert.equal(receivedLinesHaveBatchDetails([{ receivedQuantity: 1, batchNumber: 'LOT-1', expiryDate: '2027-01-31' }]), true);
  assert.equal(receivedLinesHaveBatchDetails([{ receivedQuantity: 1, batchNumber: '', expiryDate: '2027-01-31' }]), false);
  assert.equal(receivedLinesHaveBatchDetails([{ receivedQuantity: 0 }]), true);
});

test('split handouts remain open until all non-returned quantities are collected', () => {
  assert.equal(prescriptionCollectionRollup([{ ordered: 3, returned: 0, received: 3, collected: 1 }]), 'received');
  assert.equal(prescriptionCollectionRollup([{ ordered: 3, returned: 1, received: 2, collected: 2 }]), 'collected');
});
