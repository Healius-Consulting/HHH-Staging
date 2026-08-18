import assert from 'node:assert/strict';
import test from 'node:test';
import { hasDispatchedRemainder, orderAwaitingSupplierShipmentProductNames, orderCancellationResolution, orderHasInTransitPacks, orderHasPartialCollection, orderHasPartialPharmacyReceipt, orderHasUncollectedReceivedPacks, orderStage, prescriptionStatusLabel, stageMatchesFilter, type OrderStage, type StageFilter } from '../src/utils/orderStage.ts';
import type { PatientOrder } from '../src/context/AppContext.tsx';

const taxonomy: Array<[OrderStage, StageFilter]> = [
  ['awaiting-payment', 'awaiting-payment'],
  ['paid', 'awaiting-fulfilment'],
  ['curaleaf-pending', 'awaiting-fulfilment'],
  ['curaleaf-approved', 'awaiting-fulfilment'],
  ['dispatched', 'awaiting-fulfilment'],
  ['delivered', 'awaiting-fulfilment'],
  ['ready', 'ready'],
  ['rejected', 'rejected'],
  ['archived', 'archived'],
  ['cancelled', 'cancelled'],
  ['collected', 'completed'],
];

test('every internal stage belongs to exactly one consolidated non-All filter', () => {
  const filters: StageFilter[] = ['awaiting-payment', 'awaiting-fulfilment', 'ready', 'rejected', 'archived', 'completed', 'cancelled'];
  taxonomy.forEach(([stage, expected]) => {
    const matches = filters.filter(filter => stageMatchesFilter(stage, filter));
    assert.deepEqual(matches, [expected]);
  });
});

test('current filter keeps operational stages and excludes terminal history', () => {
  assert.equal(stageMatchesFilter('paid', 'current'), true);
  assert.equal(stageMatchesFilter('rejected', 'current'), true);
  assert.equal(stageMatchesFilter('cancelled', 'current'), false);
  assert.equal(stageMatchesFilter('archived', 'current'), false);
  assert.equal(stageMatchesFilter('collected', 'current'), false);
});

test('cancelled orders distinguish outstanding work from closed outcomes', () => {
  const base = {
    lifecycleStatus: 'cancelled',
    date: new Date(),
    prescriptions: [],
    payment: { status: 'cancelled' },
  } as PatientOrder;

  assert.equal(orderCancellationResolution({ ...base, cancellation: { status: 'cancelled' } } as PatientOrder), 'resolved');
  assert.equal(orderCancellationResolution({ ...base, payment: { status: 'paid' }, cancellation: { status: 'refund_required' } } as PatientOrder), 'needs-action');
  assert.equal(orderCancellationResolution({ ...base, payment: { status: 'paid' }, cancellation: { status: 'refund_required' }, refund: { status: 'completed' } } as PatientOrder), 'refunded');
});

test('mixed ready and in-flight prescriptions do not classify the order as ready', () => {
  const order = {
    date: new Date(),
    payment: { status: 'paid' },
    prescriptions: [
      {
        status: 'ready',
        fulfilmentLines: [{ productId: 'p1', ordered: 2, shipped: 2, received: 2, remaining: 0, collected: 0, requested: 2, sent: null, supplierReportedOrdered: 2, allocated: 2, returned: 0, backordered: false, quantityMismatch: false }],
      },
      {
        status: 'dispatched',
        fulfilmentLines: [{ productId: 'p2', ordered: 2, shipped: 1, received: 0, remaining: 1, collected: 0, requested: 2, sent: null, supplierReportedOrdered: 2, allocated: 1, returned: 0, backordered: false, quantityMismatch: false }],
      },
    ],
  } as PatientOrder;
  assert.equal(orderStage(order).stage, 'dispatched');
});

test('partial dispatch with zero check-in stays in transit despite stale ready shipment state', () => {
  const order = {
    date: new Date(),
    payment: { status: 'paid' },
    prescriptions: [{
      status: 'dispatched',
      dispatchStatus: 'partial',
      shipmentStates: { 'ship-1': 'ready_for_collection' },
      fulfilmentLines: [{
        productId: 'p1',
        ordered: 4,
        shipped: 2,
        received: 0,
        remaining: 2,
        collected: 0,
        requested: 4,
        sent: null,
        supplierReportedOrdered: 4,
        allocated: 2,
        returned: 0,
        backordered: true,
        quantityMismatch: false,
      }],
    }],
  } as PatientOrder;
  assert.equal(orderStage(order).stage, 'dispatched');
});

test('ready to collect requires checked-in packs', () => {
  const order = {
    date: new Date(),
    payment: { status: 'paid' },
    prescriptions: [{
      status: 'ready',
      shipmentStates: { 'ship-1': 'ready_for_collection' },
      fulfilmentLines: [{
        productId: 'p1',
        ordered: 4,
        shipped: 2,
        received: 0,
        remaining: 2,
        collected: 0,
        requested: 4,
        sent: null,
        supplierReportedOrdered: 4,
        allocated: 2,
        returned: 0,
        backordered: true,
        quantityMismatch: false,
      }],
    }],
  } as PatientOrder;
  assert.equal(orderStage(order).stage, 'dispatched');
});

test('processing prescriptions stay in the supplier-processing stage until a shipment exists', () => {
  const processing = {
    date: new Date(),
    payment: { status: 'paid' },
    prescriptions: [{ status: 'processing', placed: true }],
  } as PatientOrder;
  const dispatched = {
    ...processing,
    prescriptions: [{ status: 'dispatched', placed: true }],
  } as PatientOrder;
  assert.equal(orderStage(processing).stage, 'curaleaf-approved');
  assert.equal(orderStage(dispatched).stage, 'dispatched');
});

test('a remaining quantity is partial only after at least one pack has actually shipped', () => {
  assert.equal(hasDispatchedRemainder({ ordered: 1, shipped: 0 }), false);
  assert.equal(hasDispatchedRemainder({ ordered: 2, shipped: 1 }), true);
  assert.equal(hasDispatchedRemainder({ ordered: 1, shipped: 1 }), false);
});

test('ready and already-collected prescriptions classify the remaining order as ready', () => {
  const order = {
    date: new Date(),
    payment: { status: 'paid' },
    prescriptions: [{ status: 'ready' }, { status: 'collected' }],
  } as PatientOrder;
  assert.equal(orderStage(order).stage, 'ready');
});

test('partial check-in with supplier remainder stays in delivery not delivered', () => {
  const order = {
    date: new Date(),
    payment: { status: 'paid' },
    prescriptions: [{
      status: 'partially-received',
      dispatchStatus: 'partial',
      shipmentStates: { 'ship-1': 'received' },
      fulfilmentLines: [{
        productId: 'p1',
        ordered: 10,
        shipped: 1,
        received: 1,
        remaining: 9,
        collected: 0,
        requested: 10,
        sent: null,
        supplierReportedOrdered: 10,
        allocated: 1,
        returned: 0,
        backordered: true,
        quantityMismatch: false,
      }],
    }],
  } as PatientOrder;
  assert.equal(orderStage(order).stage, 'dispatched');
  assert.equal(orderHasPartialPharmacyReceipt(order), true);
});

test('all ordered packs checked in but not ready classifies as delivered', () => {
  const order = {
    date: new Date(),
    payment: { status: 'paid' },
    prescriptions: [{
      status: 'received',
      shipmentStates: { 'ship-1': 'received' },
      fulfilmentLines: [{
        productId: 'p1',
        ordered: 10,
        shipped: 10,
        received: 10,
        remaining: 0,
        collected: 0,
        requested: 10,
        sent: null,
        supplierReportedOrdered: 10,
        allocated: 10,
        returned: 0,
        backordered: false,
        quantityMismatch: false,
      }],
    }],
  } as PatientOrder;
  assert.equal(orderStage(order).stage, 'delivered');
  assert.equal(orderHasPartialPharmacyReceipt(order), false);
});

test('partial collection with supplier remainder does not keep an in-transit delivery banner state', () => {
  const order = {
    date: new Date(),
    payment: { status: 'paid' },
    prescriptions: [{
      status: 'partially-received',
      dispatchStatus: 'partial',
      items: [{ productId: 'p1', name: 'Beach Wedding', qty: 4 }],
      shipmentStates: { 'ship-1': 'collected' },
      fulfilmentLines: [{
        productId: 'p1',
        ordered: 4,
        shipped: 2,
        received: 2,
        remaining: 2,
        collected: 2,
        requested: 4,
        sent: null,
        supplierReportedOrdered: 4,
        allocated: 2,
        returned: 0,
        backordered: true,
        quantityMismatch: false,
      }],
    }],
  } as PatientOrder;

  assert.equal(orderHasInTransitPacks(order), false);
  assert.equal(orderHasPartialCollection(order), true);
  assert.equal(orderHasUncollectedReceivedPacks(order), false);
  assert.equal(orderAwaitingSupplierShipmentProductNames(order).length, 1);
  assert.equal(prescriptionStatusLabel(order.prescriptions[0]!), 'Part collected');
});

test('quote review required stays paid and is not treated as a Curaleaf rejection', () => {
  const order = {
    date: new Date(),
    payment: { status: 'paid' },
    prescriptions: [{ status: 'draft', placed: false }],
    quoteReview: { status: 'required', type: 'patient_price_changed' },
  } as PatientOrder;
  assert.equal(orderStage(order).stage, 'paid');
  assert.equal(orderStage(order).unresolvedReason, null);
});

test('Curaleaf-cancelled paid orders stay in cancelled unresolved, not as unpaid cancels', () => {
  const order = {
    date: new Date(),
    payment: { status: 'paid' },
    unresolvedReason: 'cancelled',
    cancellation: { status: 'refund_required' },
    curaleafCancellation: { status: 'confirmed' },
    prescriptions: [{ status: 'cancelled', purchaseOrderState: 'CANCELLED', placed: true }],
  } as PatientOrder;
  const staged = orderStage(order);
  assert.equal(staged.stage, 'cancelled');
  assert.equal(staged.unresolvedReason, 'cancelled');
  assert.equal(orderCancellationResolution(order), 'needs-action');
});

test('Curaleaf cancel wins over an expired or archived flag on the same paid order', () => {
  const order = {
    date: new Date('2026-07-01'),
    payment: { status: 'paid' },
    isExpired: true,
    lifecycleStatus: 'archived',
    unresolvedReason: 'expired',
    cancellation: { status: 'refund_required' },
    curaleafCancellation: { status: 'confirmed' },
    prescriptions: [{ status: 'cancelled', purchaseOrderState: 'CANCELLED', placed: true }],
  } as PatientOrder;
  const staged = orderStage(order);
  assert.equal(staged.stage, 'cancelled');
  assert.equal(staged.unresolvedReason, 'cancelled');
});

