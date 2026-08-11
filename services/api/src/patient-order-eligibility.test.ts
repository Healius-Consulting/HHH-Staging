import assert from 'node:assert/strict';
import test from 'node:test';
import { canPatientCreateOrder } from './patient-order-eligibility.js';

test('approved referrals can create their first order before activation', () => {
  assert.equal(canPatientCreateOrder('referred'), true);
});

test('active patients can create subsequent orders', () => {
  assert.equal(canPatientCreateOrder('active'), true);
});

test('inactive and unknown patients cannot create orders', () => {
  assert.equal(canPatientCreateOrder('inactive'), false);
  assert.equal(canPatientCreateOrder('declined'), false);
  assert.equal(canPatientCreateOrder(undefined), false);
});
