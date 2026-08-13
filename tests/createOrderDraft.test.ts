import assert from 'node:assert/strict';
import test from 'node:test';
import { nextDraftIdAfterDeletion, preferredDraftPaymentRoute } from '../src/utils/createOrderDraft.ts';

test('Worldpay is preferred only while the pharmacy connection is available', () => {
  assert.equal(preferredDraftPaymentRoute(true, 'connected'), 'worldpay');
  assert.equal(preferredDraftPaymentRoute(true, 'attention'), 'manual');
  assert.equal(preferredDraftPaymentRoute(false, 'connected'), 'manual');
});

test('deleting a draft selects the nearest remaining draft in the same tenant', () => {
  const draft = (id: number, organisationId = 'pharmacy-a', status = 'none') => ({ id, organisationId, payment: { status } });
  const orders = [draft(1), draft(2), draft(3), draft(4, 'pharmacy-b'), draft(5, 'pharmacy-a', 'sent')];
  assert.equal(nextDraftIdAfterDeletion(orders, 2, 'pharmacy-a'), 3);
  assert.equal(nextDraftIdAfterDeletion(orders, 3, 'pharmacy-a'), 2);
  assert.equal(nextDraftIdAfterDeletion([draft(1)], 1, 'pharmacy-a'), null);
});
