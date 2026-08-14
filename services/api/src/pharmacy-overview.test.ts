import assert from 'node:assert/strict';
import test from 'node:test';
import { composePharmacyOverview, maskPatientLabel } from './pharmacy-overview.js';

test('overview patient labels disclose only initials and bounded masks', () => {
  assert.equal(maskPatientLabel('Rebecca Allen'), 'R••••• A••••');
  assert.equal(maskPatientLabel('A'), 'A••');
  assert.equal(maskPatientLabel(''), 'Patient record');
  assert.equal(maskPatientLabel('Long Given Middle Family'), 'L••• G••••');
});

test('overview aggregates fixed tenant fixtures without exposing contact data', () => {
  const now = Date.parse('2026-08-14T12:00:00.000Z');
  const overview = composePharmacyOverview({
    organisationId: 'pharmacy-a',
    organisation: { tradingName: 'Example Pharmacy', status: 'live', testAccount: false },
    submissions: [{ id: 'submission-1', organisationId: 'pharmacy-a', name: 'Rebecca Allen', email: 'private@example.test', mobile: '07000000000', status: 'new', submittedAt: '2026-08-10T10:00:00.000Z' }],
    patients: [{ id: 'patient-1', organisationId: 'pharmacy-a', name: 'Rebecca Allen', email: 'private@example.test', mobile: '07000000000' }],
    orders: [
      { id: 'payment-order', organisationId: 'pharmacy-a', patientId: 'patient-1', lifecycleStatus: 'active', payment: { status: 'pending', sentAt: '2026-08-09T09:00:00.000Z' }, prescriptions: [], updatedAt: '2026-08-12T09:00:00.000Z' },
      { id: 'supplier-order', organisationId: 'pharmacy-a', patientId: 'patient-1', lifecycleStatus: 'active', payment: { status: 'paid' }, fulfilmentStatus: 'supplier_processing', prescriptions: [{ status: 'processing' }], updatedAt: '2026-08-13T09:00:00.000Z' },
      { id: 'collection-order', organisationId: 'pharmacy-a', patientId: 'patient-1', lifecycleStatus: 'active', payment: { status: 'paid' }, fulfilmentStatus: 'ready_for_collection', prescriptions: [{ status: 'ready', readyAt: '2026-08-01T09:00:00.000Z' }], updatedAt: '2026-08-13T10:00:00.000Z' },
    ],
    integrations: [{ id: 'pharmacy-a--curaleaf', data: { status: 'connected', updatedAt: '2026-08-14T11:00:00.000Z' } }],
  }, now);

  assert.deepEqual(overview.summary, { patientReview: 1, awaitingPayment: 1, supplierFulfilment: 1, readyForCollection: 1, urgentTotal: 3 });
  assert.equal(overview.organisation.trainingMode, false);
  assert.equal(overview.integrations[0]?.state, 'connected');
  assert.equal(overview.integrations[1]?.state, 'not-configured');
  const serialised = JSON.stringify(overview);
  assert.equal(serialised.includes('private@example.test'), false);
  assert.equal(serialised.includes('07000000000'), false);
  assert.equal(serialised.includes('Rebecca Allen'), false);
});
