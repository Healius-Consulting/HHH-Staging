import assert from 'node:assert/strict';
import test from 'node:test';
import { curaleafDeliveryExpectation, curaleafDeliveryWindowState } from '@hhh/domain/delivery';

test('approval before 14:30 aims for the next working day', () => {
  assert.deepEqual(curaleafDeliveryExpectation('2026-08-13T12:00:00Z'), {
    approvedDate: '2026-08-13',
    approvedWeekday: 'Thu',
    beforeCutoff: true,
    windowStart: '2026-08-14',
    windowEnd: '2026-08-14',
    serviceLevel: 'next-working-day',
  });
});

test('Thursday after 14:30 produces a Monday to Wednesday delivery window', () => {
  assert.deepEqual(curaleafDeliveryExpectation('2026-08-13T14:00:00Z'), {
    approvedDate: '2026-08-13',
    approvedWeekday: 'Thu',
    beforeCutoff: false,
    windowStart: '2026-08-17',
    windowEnd: '2026-08-19',
    serviceLevel: 'two-to-four-working-days',
  });
});

test('Friday before the cut-off skips the weekend', () => {
  const expectation = curaleafDeliveryExpectation('2026-08-14T12:00:00Z');
  assert.equal(expectation?.windowStart, '2026-08-17');
  assert.equal(expectation?.windowEnd, '2026-08-17');
});

test('14:30 London time is treated as after the cut-off', () => {
  assert.equal(curaleafDeliveryExpectation('2026-08-13T13:30:00Z')?.beforeCutoff, false);
});

test('delivery window warns once the final working-day estimate has passed', () => {
  const expectation = curaleafDeliveryExpectation('2026-08-13T14:00:00Z');
  assert.ok(expectation);
  assert.equal(curaleafDeliveryWindowState(expectation, '2026-08-18T10:00:00Z'), 'due');
  assert.equal(curaleafDeliveryWindowState(expectation, '2026-08-20T10:00:00Z'), 'overdue');
});
