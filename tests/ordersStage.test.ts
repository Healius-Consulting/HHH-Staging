import assert from 'node:assert/strict';
import test from 'node:test';
import { orderStage, stageMatchesFilter, type OrderStage, type StageFilter } from '../src/utils/orderStage.ts';
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
  ['cancelled', 'archived'],
  ['collected', 'completed'],
];

test('every internal stage belongs to exactly one consolidated non-All filter', () => {
  const filters: StageFilter[] = ['awaiting-payment', 'awaiting-fulfilment', 'ready', 'rejected', 'archived', 'completed'];
  taxonomy.forEach(([stage, expected]) => {
    const matches = filters.filter(filter => stageMatchesFilter(stage, filter));
    assert.deepEqual(matches, [expected]);
  });
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
