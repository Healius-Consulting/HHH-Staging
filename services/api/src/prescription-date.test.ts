import assert from 'node:assert/strict';
import test from 'node:test';
import { calculatePrescriptionExpiryDate, prescriptionDateIsCurrent, prescriptionDateWindowStatus, prescriptionIssueDateBounds } from '@hhh/domain/prescription-date';

const NOW = new Date('2026-08-12T12:00:00.000Z');

test('issue date bounds cover today and the preceding 28 calendar days', () => {
  assert.deepEqual(prescriptionIssueDateBounds(NOW), { min: '2026-07-15', max: '2026-08-12' });
  assert.equal(calculatePrescriptionExpiryDate('2026-07-15'), '2026-08-12');
});

test('the edges of the 28-day prescription window are accepted', () => {
  assert.equal(prescriptionDateIsCurrent('2026-07-15', undefined, NOW), true);
  assert.equal(prescriptionDateIsCurrent('2026-08-12', undefined, NOW), true);
});

test('past and future issue dates are rejected', () => {
  assert.equal(prescriptionDateWindowStatus('2026-07-14', undefined, NOW), 'expired');
  assert.equal(prescriptionDateWindowStatus('2026-08-13', undefined, NOW), 'future');
});

test('a supplied expiry cannot extend a prescription beyond 28 days', () => {
  assert.equal(prescriptionDateWindowStatus('2026-07-15', '2026-08-13', NOW), 'invalid');
  assert.equal(prescriptionDateWindowStatus('2026-07-15', '2026-08-11', NOW), 'expired');
});

test('the current date follows Europe/London around midnight', () => {
  assert.deepEqual(prescriptionIssueDateBounds(new Date('2026-08-11T23:30:00.000Z')), { min: '2026-07-15', max: '2026-08-12' });
});
