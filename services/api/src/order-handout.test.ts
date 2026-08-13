import assert from 'node:assert/strict';
import test from 'node:test';
import { planOrderHandout, shipmentsReadyForHandout } from './order-handout.js';

test('order handout requires every active prescription to be ready', () => {
  const plan = planOrderHandout({
    rx1: { state: 'READY_FOR_COLLECTION', shipmentIds: ['shipment-1'] },
    rx2: { state: 'PLACED', shipmentIds: ['shipment-2'] },
  });
  assert.equal(plan.ready, false);
  assert.equal(plan.code, 'ORDER_NOT_READY_FOR_HANDOUT');
});

test('cancelled sub-orders do not block a ready handout', () => {
  const plan = planOrderHandout({
    rx1: { state: 'READY_FOR_COLLECTION', shipmentIds: ['shipment-1'] },
    rx2: { state: 'CANCELLED_REFUNDED', shipmentIds: [] },
  });
  assert.equal(plan.ready, true);
  assert.deepEqual(plan.shipmentIds, ['shipment-1']);
});

test('every linked shipment must be ready or already collected', () => {
  assert.equal(shipmentsReadyForHandout(['one', 'two'], { one: 'ready_for_collection', two: 'collected' }), true);
  assert.equal(shipmentsReadyForHandout(['one', 'two'], { one: 'ready_for_collection', two: 'received' }), false);
  assert.equal(shipmentsReadyForHandout([], {}), false);
});
