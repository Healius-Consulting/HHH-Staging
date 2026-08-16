import assert from 'node:assert/strict';
import test from 'node:test';
import { mostRecentlyUpdatedDraftIndex, nextDraftIdAfterDeletion, preferredDraftIndex, preferredDraftPaymentRoute } from '../src/utils/createOrderDraft.ts';

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

test('rehydration selects the most recently saved draft rather than an unrelated empty draft', () => {
  const records = [
    { createdAt: '2026-08-15T20:00:00.000Z', updatedAt: '2026-08-15T21:05:00.000Z' },
    { createdAt: '2026-08-15T20:30:00.000Z', updatedAt: '2026-08-15T20:30:00.000Z' },
  ];
  assert.equal(mostRecentlyUpdatedDraftIndex(records), 0);
  assert.equal(mostRecentlyUpdatedDraftIndex([]), -1);
});

test('rehydration prefers a draft with a verified attachment over newer empty drafts', () => {
  const records = [
    {
      createdAt: '2026-08-15T20:00:00.000Z',
      updatedAt: '2026-08-15T20:05:00.000Z',
      payload: { prescriptions: [{ fileId: 'verified-file-id', copyFileName: 'prescription.pdf' }] },
    },
    {
      createdAt: '2026-08-15T20:30:00.000Z',
      updatedAt: '2026-08-15T21:30:00.000Z',
      payload: { prescriptions: [] },
    },
  ];
  assert.equal(preferredDraftIndex(records), 0);
  assert.equal(preferredDraftIndex(records.slice(1)), 0);
});
