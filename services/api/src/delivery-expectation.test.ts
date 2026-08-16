import assert from 'node:assert/strict';
import test from 'node:test';
import { curaleafDeliveryExpectation, curaleafDeliveryGuidance, curaleafDeliveryWindowState } from '@hhh/domain/delivery';

test('Thursday before 14:30 uses Friday through the fourth working day', () => {
  assert.deepEqual(curaleafDeliveryExpectation('2026-08-13T12:00:00Z'), {
    approvedDate: '2026-08-13',
    approvedWeekday: 'Thu',
    beforeCutoff: true,
    windowStart: '2026-08-14',
    windowEnd: '2026-08-19',
    serviceLevel: 'next-to-fourth-working-day',
  });
});

test('Thursday after 14:30 joins Friday processing and uses Monday to Thursday', () => {
  assert.deepEqual(curaleafDeliveryExpectation('2026-08-13T14:00:00Z'), {
    approvedDate: '2026-08-13',
    approvedWeekday: 'Thu',
    beforeCutoff: false,
    windowStart: '2026-08-17',
    windowEnd: '2026-08-20',
    serviceLevel: 'next-to-fourth-working-day',
  });
});

test('Friday before the cut-off skips the weekend', () => {
  const expectation = curaleafDeliveryExpectation('2026-08-14T12:00:00Z');
  assert.equal(expectation?.windowStart, '2026-08-17');
  assert.equal(expectation?.windowEnd, '2026-08-20');
});

test('14:30 London time is treated as after the cut-off', () => {
  assert.equal(curaleafDeliveryExpectation('2026-08-13T13:30:00Z')?.beforeCutoff, false);
});

test('delivery window warns once the final working-day estimate has passed', () => {
  const expectation = curaleafDeliveryExpectation('2026-08-13T14:00:00Z');
  assert.ok(expectation);
  assert.equal(curaleafDeliveryWindowState(expectation, '2026-08-18T10:00:00Z'), 'due');
  assert.equal(curaleafDeliveryWindowState(expectation, '2026-08-21T10:00:00Z'), 'overdue');
});

test('Friday after cut-off and weekends process Monday for Tuesday to Friday delivery', () => {
  for (const value of ['2026-08-14T14:00:00Z', '2026-08-15T10:00:00Z', '2026-08-16T10:00:00Z']) {
    const guidance = curaleafDeliveryGuidance(value);
    assert.equal(guidance?.scenario, 'DT-4');
    assert.equal(guidance?.effectiveProcessingDate, '2026-08-17');
    assert.equal(guidance?.windowStart, '2026-08-18');
    assert.equal(guidance?.windowEnd, '2026-08-21');
  }
});

test('London daylight-saving cut-off treats 14:29 as before and 14:30 as after', () => {
  assert.equal(curaleafDeliveryGuidance('2026-08-13T13:29:00Z')?.scenario, 'DT-1');
  assert.equal(curaleafDeliveryGuidance('2026-08-13T13:30:00Z')?.scenario, 'DT-2');
  assert.equal(curaleafDeliveryGuidance('2026-01-15T14:29:00Z')?.scenario, 'DT-1');
  assert.equal(curaleafDeliveryGuidance('2026-01-15T14:30:00Z')?.scenario, 'DT-2');
});

test('countdown reports whole remaining minutes to the London cut-off', () => {
  assert.equal(curaleafDeliveryGuidance('2026-08-13T12:00:00Z')?.countdownMinutes, 90);
  assert.equal(curaleafDeliveryGuidance('2026-08-13T13:29:00Z')?.countdownMinutes, 1);
  assert.equal(curaleafDeliveryGuidance('2026-08-13T13:30:00Z')?.countdownMinutes, 0);
});
