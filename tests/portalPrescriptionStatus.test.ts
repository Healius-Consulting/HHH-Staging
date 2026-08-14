import assert from 'node:assert/strict';
import test from 'node:test';
import { portalPrescriptionStatus } from '../src/utils/portalPrescriptionStatus.ts';

test('a paid backend order is still draft until a Curaleaf result exists', () => {
  assert.equal(portalPrescriptionStatus({ fulfilmentStatus: 'supplier_pending' }), 'draft');
});

test('a Curaleaf-pending prescription is shown as awaiting approval', () => {
  assert.equal(portalPrescriptionStatus({
    fulfilmentStatus: 'supplier_pending',
    curaleaf: {
      status: 'prescription_pending',
      customerReference: 'HHH-order-rx',
    },
  }), 'awaiting-approval');
});

test('a pending sub-order remains awaiting approval when another sub-order is processing', () => {
  assert.equal(portalPrescriptionStatus({
    fulfilmentStatus: 'supplier_processing',
    curaleaf: {
      status: 'prescription_pending',
      customerReference: 'HHH-order-pending-rx',
    },
  }), 'awaiting-approval');
});

test('a submitted Curaleaf purchase order follows its fulfilment state', () => {
  assert.equal(portalPrescriptionStatus({
    fulfilmentStatus: 'supplier_processing',
    curaleaf: {
      status: 'purchase_order_submitted',
      customerReference: 'HHH-order-rx',
    },
  }), 'processing');
  assert.equal(portalPrescriptionStatus({
    fulfilmentStatus: 'partially_dispatched_to_pharmacy',
    curaleaf: {
      status: 'purchase_order_submitted',
      customerReference: 'HHH-order-rx',
      purchaseOrderState: 'PROCESSING',
    },
  }), 'dispatched');
});

test('a supplier-cancelled purchase order has an explicit cancelled status', () => {
  assert.equal(portalPrescriptionStatus({
    fulfilmentStatus: 'exception',
    curaleaf: {
      status: 'purchase_order_submitted',
      customerReference: 'HHH-order-rx',
      purchaseOrderState: 'CANCELLED',
    },
  }), 'cancelled');
});
