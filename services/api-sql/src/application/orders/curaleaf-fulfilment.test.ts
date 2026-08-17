import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  advanceFulfilmentStatus,
  customerReferenceMatchesOrder,
  dispatchStatusFromLines,
  latestShipmentCreatedAt,
  matchPurchaseOrder,
  matchShipments,
  normalisedFulfilmentLines,
  supplierFulfilmentStatus,
} from './curaleaf-fulfilment.js';

const beachWeddingPo = {
  id: '99f4bc42-4312-45c5-b659-21583b5eb364',
  state: 'PROCESSING',
  courier: 'POLAR_SPEED',
  customerReference: 'HHH-5a8b4ac3-236c-41f7-a37b-0132b7892637-a9386eac93',
  issuedDate: '2026-08-13',
  createdAt: '2026-08-13T10:29:08.933558Z',
  items: [{
    productId: '9f2d6958-2d76-4338-9e5f-6fd383dfff36',
    formulaId: 'f74f63de-dc89-4074-9d8c-be35f5398963',
    packsOrderedCount: 4,
    packsAllocatedCount: 2,
    packsReturnedCount: 0,
  }],
};

const beachWeddingShipment = {
  id: 'b13179c4-9515-4181-abd8-d1b87b50faa4',
  purchaseOrderId: '99f4bc42-4312-45c5-b659-21583b5eb364',
  purchaseOrderCustomerReference: 'HHH-5a8b4ac3-236c-41f7-a37b-0132b7892637-a9386eac93',
  createdAt: '2026-08-17T14:29:05.973745Z',
  items: [{
    productId: '9f2d6958-2d76-4338-9e5f-6fd383dfff36',
    packCount: 2,
    packsReturnedCount: 0,
    batchNumber: 'A409003',
    batchExpiryDate: '2027-02-06',
  }],
};

const order = {
  id: '5a8b4ac3-236c-41f7-a37b-0132b7892637',
  orderNumber: 'ORD-BEACH',
};

const fullyAllocatedPo = {
  id: '6e5e3d6e-5b14-4b8a-bb0e-d6d60ed6f69f',
  state: 'FULLY_ALLOCATED',
  courier: 'POLAR_SPEED',
  customerReference: 'HHH-93eea688-3a39-4b1d-b998-e43cc16acf4b-c10dbf6885',
  issuedDate: '2026-08-13',
  createdAt: '2026-08-13T10:31:34.825350Z',
  items: [{
    productId: '9f2d6958-2d76-4338-9e5f-6fd383dfff36',
    formulaId: 'f74f63de-dc89-4074-9d8c-be35f5398963',
    packsOrderedCount: 2,
    packsAllocatedCount: 2,
    packsReturnedCount: 0,
  }],
};

const fullyAllocatedShipment = {
  id: 'f46d4159-f0dc-49fe-9189-4f0a59ea18e2',
  purchaseOrderId: '6e5e3d6e-5b14-4b8a-bb0e-d6d60ed6f69f',
  purchaseOrderCustomerReference: 'HHH-93eea688-3a39-4b1d-b998-e43cc16acf4b-c10dbf6885',
  createdAt: '2026-08-17T14:30:05.319618Z',
  items: [{
    productId: '9f2d6958-2d76-4338-9e5f-6fd383dfff36',
    packCount: 2,
    packsReturnedCount: 0,
    batchNumber: 'A409003',
    batchExpiryDate: '2027-02-06',
  }],
};

const tenPackPo = {
  id: '65ba3fdd-4507-4e39-a8ed-2d383b04e1d8',
  state: 'PROCESSING',
  courier: 'POLAR_SPEED',
  customerReference: 'HHH-a55ee7d4-6466-4e95-bf7f-88a95241e60f-383b50e0f9',
  issuedDate: '2026-08-13',
  createdAt: '2026-08-13T09:23:29.241487Z',
  items: [{
    productId: '9f2d6958-2d76-4338-9e5f-6fd383dfff36',
    formulaId: 'f74f63de-dc89-4074-9d8c-be35f5398963',
    packsOrderedCount: 10,
    packsAllocatedCount: 1,
    packsReturnedCount: 0,
  }],
};

const tenPackShipment = {
  id: '796adea9-f2d9-43b2-ad5c-ccfc4184ee62',
  purchaseOrderId: '65ba3fdd-4507-4e39-a8ed-2d383b04e1d8',
  purchaseOrderCustomerReference: 'HHH-a55ee7d4-6466-4e95-bf7f-88a95241e60f-383b50e0f9',
  createdAt: '2026-08-17T08:50:45.621344Z',
  items: [{
    productId: '9f2d6958-2d76-4338-9e5f-6fd383dfff36',
    packCount: 1,
    packsReturnedCount: 0,
    batchNumber: 'A409003',
    batchExpiryDate: '2027-02-06',
  }],
};

describe('Curaleaf fulfilment mapping', () => {
  it('matches HHH-{orderId}-{hash} customer references to the SQL order id', () => {
    assert.equal(customerReferenceMatchesOrder(beachWeddingPo.customerReference, order), true);
    assert.equal(matchPurchaseOrder(order, [beachWeddingPo])?.id, beachWeddingPo.id);
    assert.equal(matchShipments(order, beachWeddingPo, [beachWeddingShipment]).length, 1);
  });

  it('maps the Beach Wedding consignment as a 2-of-4 split shipment', () => {
    const lines = normalisedFulfilmentLines({
      purchaseOrder: beachWeddingPo,
      shipments: [beachWeddingShipment],
      requestedItems: [{ packId: '9f2d6958-2d76-4338-9e5f-6fd383dfff36', quantity: 4 }],
    });
    assert.equal(lines.length, 1);
    assert.equal(lines[0]?.ordered, 4);
    assert.equal(lines[0]?.allocated, 2);
    assert.equal(lines[0]?.shipped, 2);
    assert.equal(lines[0]?.remaining, 2);
    assert.equal(lines[0]?.received, 0);
    assert.equal(lines[0]?.backordered, true);
    assert.equal(dispatchStatusFromLines([beachWeddingShipment], lines), 'partial');
    assert.equal(supplierFulfilmentStatus({
      purchaseOrder: beachWeddingPo,
      shipments: [beachWeddingShipment],
      lines,
    }), 'PARTIALLY_DISPATCHED_TO_PHARMACY');
    assert.equal(latestShipmentCreatedAt([beachWeddingShipment]), beachWeddingShipment.createdAt);
  });

  it('does not invent a full dispatch when shipment product ids do not match', () => {
    const lines = normalisedFulfilmentLines({
      purchaseOrder: beachWeddingPo,
      shipments: [{ ...beachWeddingShipment, items: [{ productId: 'other-pack', packCount: 2 }] }],
      requestedItems: [{ packId: '9f2d6958-2d76-4338-9e5f-6fd383dfff36', quantity: 4 }],
    });
    assert.equal(lines[0]?.shipped, 0);
    assert.equal(lines[0]?.remaining, 4);
  });

  it('keeps pharmacy goods-in counts when Curaleaf is re-synced', () => {
    const lines = normalisedFulfilmentLines({
      purchaseOrder: beachWeddingPo,
      shipments: [beachWeddingShipment],
      requestedItems: [{ packId: '9f2d6958-2d76-4338-9e5f-6fd383dfff36', quantity: 4 }],
      priorLines: [{ productId: '9f2d6958-2d76-4338-9e5f-6fd383dfff36', received: 2, collected: 0 }],
    });
    assert.equal(lines[0]?.received, 2);
    assert.equal(lines[0]?.shipped, 2);
    assert.equal(supplierFulfilmentStatus({
      purchaseOrder: beachWeddingPo,
      shipments: [beachWeddingShipment],
      lines,
    }), 'PARTIALLY_RECEIVED');
  });

  it('does not regress a goods-in status back to in-transit', () => {
    assert.equal(
      advanceFulfilmentStatus('PARTIALLY_RECEIVED', 'PARTIALLY_DISPATCHED_TO_PHARMACY'),
      'PARTIALLY_RECEIVED',
    );
    assert.equal(
      advanceFulfilmentStatus('SUPPLIER_PROCESSING', 'PARTIALLY_DISPATCHED_TO_PHARMACY'),
      'PARTIALLY_DISPATCHED_TO_PHARMACY',
    );
  });

  it('matches and maps the fully allocated 2-pack consignment as complete dispatch', () => {
    const liveOrder = { id: '93eea688-3a39-4b1d-b998-e43cc16acf4b', orderNumber: 'ORD-OTHER' };
    assert.equal(customerReferenceMatchesOrder(fullyAllocatedPo.customerReference, liveOrder), true);
    assert.equal(matchPurchaseOrder(liveOrder, [fullyAllocatedPo])?.id, fullyAllocatedPo.id);
    assert.equal(matchShipments(liveOrder, fullyAllocatedPo, [fullyAllocatedShipment]).length, 1);
    const lines = normalisedFulfilmentLines({
      purchaseOrder: fullyAllocatedPo,
      shipments: [fullyAllocatedShipment],
      requestedItems: [{ packId: '9f2d6958-2d76-4338-9e5f-6fd383dfff36', quantity: 2 }],
    });
    assert.equal(lines[0]?.ordered, 2);
    assert.equal(lines[0]?.allocated, 2);
    assert.equal(lines[0]?.shipped, 2);
    assert.equal(lines[0]?.remaining, 0);
    assert.equal(lines[0]?.received, 0);
    assert.equal(lines[0]?.backordered, false);
    assert.equal(dispatchStatusFromLines([fullyAllocatedShipment], lines), 'complete');
    assert.equal(supplierFulfilmentStatus({
      purchaseOrder: fullyAllocatedPo,
      shipments: [fullyAllocatedShipment],
      lines,
    }), 'DISPATCHED_TO_PHARMACY');
  });

  it('maps the 1-of-10 PROCESSING consignment as a split shipment, not full dispatch', () => {
    const liveOrder = { id: 'a55ee7d4-6466-4e95-bf7f-88a95241e60f', orderNumber: 'ORD-TEN' };
    assert.equal(matchPurchaseOrder(liveOrder, [tenPackPo])?.id, tenPackPo.id);
    const lines = normalisedFulfilmentLines({
      purchaseOrder: tenPackPo,
      shipments: [tenPackShipment],
      requestedItems: [{ packId: '9f2d6958-2d76-4338-9e5f-6fd383dfff36', quantity: 10 }],
    });
    assert.equal(lines[0]?.ordered, 10);
    assert.equal(lines[0]?.allocated, 1);
    assert.equal(lines[0]?.shipped, 1);
    assert.equal(lines[0]?.remaining, 9);
    assert.equal(lines[0]?.received, 0);
    assert.equal(lines[0]?.backordered, true);
    assert.equal(dispatchStatusFromLines([tenPackShipment], lines), 'partial');
    assert.equal(supplierFulfilmentStatus({
      purchaseOrder: tenPackPo,
      shipments: [tenPackShipment],
      lines,
    }), 'PARTIALLY_DISPATCHED_TO_PHARMACY');
    assert.equal(latestShipmentCreatedAt([tenPackShipment]), tenPackShipment.createdAt);
  });

  it('keeps FULLY_ALLOCATED as supplier allocated when no shipment has been handed to courier', () => {
    const lines = normalisedFulfilmentLines({
      purchaseOrder: fullyAllocatedPo,
      shipments: [],
      requestedItems: [{ packId: '9f2d6958-2d76-4338-9e5f-6fd383dfff36', quantity: 2 }],
    });
    assert.equal(lines[0]?.shipped, 0);
    assert.equal(lines[0]?.remaining, 2);
    assert.equal(dispatchStatusFromLines([], lines), 'not_dispatched');
    assert.equal(supplierFulfilmentStatus({
      purchaseOrder: fullyAllocatedPo,
      shipments: [],
      lines,
    }), 'SUPPLIER_ALLOCATED');
  });
});
