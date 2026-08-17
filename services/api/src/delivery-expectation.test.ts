import assert from 'node:assert/strict';
import test from 'node:test';
import { curaleafDeliveryExpectation, curaleafDeliveryGuidance, curaleafDeliveryWindowState } from '@hhh/domain/delivery';

// DT-1: Mon-Thu before 14:30 -> 1-2 working days

test('Thursday before 14:30 gets 1-2 working day window (Fri to Mon)', () => {
  assert.deepEqual(curaleafDeliveryExpectation('2026-08-13T12:00:00Z'), {
    approvedDate: '2026-08-13',
    approvedWeekday: 'Thu',
    beforeCutoff: true,
    windowStart: '2026-08-14', // +1 working day (Friday)
    windowEnd: '2026-08-17',   // +2 working days (Monday, skipping weekend)
    serviceLevel: 'next-to-fourth-working-day',
  });
});

test('Monday before 14:30 gets 1-2 working day window (Tue to Wed)', () => {
  const result = curaleafDeliveryGuidance('2026-08-10T10:00:00Z');
  assert.equal(result?.scenario, 'DT-1');
  assert.equal(result?.windowStart, '2026-08-11');
  assert.equal(result?.windowEnd, '2026-08-12');
});

// DT-2: Mon-Thu at/after 14:30 -> 2-4 working days

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

// DT-4: Friday (any time), Sat, Sun -> 2-4 working days from Monday batch

test('Friday before 14:30 is DT-4 - no next-day on Fridays', () => {
  const guidance = curaleafDeliveryGuidance('2026-08-14T10:00:00Z');
  assert.equal(guidance?.scenario, 'DT-4');
  assert.equal(guidance?.beforeCutoff, false);
  assert.equal(guidance?.windowStart, '2026-08-18'); // +1 wd from Monday (Tuesday)
  assert.equal(guidance?.windowEnd, '2026-08-21');   // +4 wd from Monday (Friday)
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

// Cutoff boundary

test('14:30 London time is treated as after the cut-off', () => {
  assert.equal(curaleafDeliveryExpectation('2026-08-13T13:30:00Z')?.beforeCutoff, false);
});

test('London daylight-saving cut-off treats 14:29 as before and 14:30 as after', () => {
  assert.equal(curaleafDeliveryGuidance('2026-08-13T13:29:00Z')?.scenario, 'DT-1');
  assert.equal(curaleafDeliveryGuidance('2026-08-13T13:30:00Z')?.scenario, 'DT-2');
  assert.equal(curaleafDeliveryGuidance('2026-01-15T14:29:00Z')?.scenario, 'DT-1');
  assert.equal(curaleafDeliveryGuidance('2026-01-15T14:30:00Z')?.scenario, 'DT-2');
});

test('Monday after 14:30 London uses Wed to the following Monday for the current shipment', () => {
  const guidance = curaleafDeliveryGuidance('2026-08-17T14:29:05.973745Z');
  assert.equal(guidance?.scenario, 'DT-2');
  assert.equal(guidance?.windowStart, '2026-08-19');
  assert.equal(guidance?.windowEnd, '2026-08-24');
});

test('fully allocated Monday 15:30 London shipment uses the same DT-2 window', () => {
  const guidance = curaleafDeliveryGuidance('2026-08-17T14:30:05.319618Z');
  assert.equal(guidance?.scenario, 'DT-2');
  assert.equal(guidance?.beforeCutoff, false);
  assert.equal(guidance?.windowStart, '2026-08-19');
  assert.equal(guidance?.windowEnd, '2026-08-24');
});

test('Monday before cutoff shipment uses DT-1 Tuesday to Wednesday', () => {
  const guidance = curaleafDeliveryGuidance('2026-08-17T08:50:45.621344Z');
  assert.equal(guidance?.scenario, 'DT-1');
  assert.equal(guidance?.beforeCutoff, true);
  assert.equal(guidance?.windowStart, '2026-08-18');
  assert.equal(guidance?.windowEnd, '2026-08-19');
});

test('countdown reports whole remaining minutes to the London cut-off', () => {
  assert.equal(curaleafDeliveryGuidance('2026-08-13T12:00:00Z')?.countdownMinutes, 90);
  assert.equal(curaleafDeliveryGuidance('2026-08-13T13:29:00Z')?.countdownMinutes, 1);
  assert.equal(curaleafDeliveryGuidance('2026-08-13T13:30:00Z')?.countdownMinutes, 0);
});

test('delivery window warns once the final working-day estimate has passed', () => {
  const expectation = curaleafDeliveryExpectation('2026-08-13T14:00:00Z');
  assert.ok(expectation);
  assert.equal(curaleafDeliveryWindowState(expectation, '2026-08-18T10:00:00Z'), 'due');
  assert.equal(curaleafDeliveryWindowState(expectation, '2026-08-21T10:00:00Z'), 'overdue');
});

test('DT-1 overdue detection uses the 2-working-day window end', () => {
  const expectation = curaleafDeliveryExpectation('2026-08-13T12:00:00Z');
  assert.ok(expectation);
  assert.equal(expectation.windowEnd, '2026-08-17');
  assert.equal(curaleafDeliveryWindowState(expectation, '2026-08-17T10:00:00Z'), 'due');
  assert.equal(curaleafDeliveryWindowState(expectation, '2026-08-18T10:00:00Z'), 'overdue');
});

