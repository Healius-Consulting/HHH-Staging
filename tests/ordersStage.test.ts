import assert from 'node:assert/strict';
import test from 'node:test';
import { orderCancellationResolution, orderStage, stageMatchesFilter, type OrderStage, type StageFilter } from '../src/utils/orderStage.ts';
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
    prescriptions: [{ status: 'ready' }, { status: 'dispatched' }],
  } as PatientOrder;
  assert.equal(orderStage(order).stage, 'dispatched');
});

test('ready and already-collected prescriptions classify the remaining order as ready', () => {
  const order = {
    date: new Date(),
    payment: { status: 'paid' },
    prescriptions: [{ status: 'ready' }, { status: 'collected' }],
  } as PatientOrder;
  assert.equal(orderStage(order).stage, 'ready');
});
