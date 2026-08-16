import assert from 'node:assert/strict';
import test from 'node:test';
import { cancellationRequiresAction, composePharmacyOverview, maskPatientLabel } from './pharmacy-overview.js';

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

  assert.deepEqual(overview.summary, { activePatients: 1, awaitingPayment: 1, supplierFulfilment: 1, readyForCollection: 1, urgentTotal: 2 });
  assert.equal(overview.organisation.trainingMode, false);
  assert.equal(overview.organisation.allocationHoldingMode, false);
  assert.equal(overview.integrations[0]?.state, 'connected');
  assert.equal(overview.integrations[1]?.state, 'not-configured');
  const serialised = JSON.stringify(overview);
  assert.equal(serialised.includes('private@example.test'), false);
  assert.equal(serialised.includes('07000000000'), false);
  assert.equal(serialised.includes('Rebecca Allen'), false);
});

test('intake-live overview does not expose HHH eligibility workload or operational data', () => {
  const overview = composePharmacyOverview({
    organisationId: 'pharmacy-intake',
    organisation: { tradingName: 'Intake Pharmacy', status: 'intake_live', testAccount: false },
    submissions: [{ id: 'submission-1', status: 'new', firstName: 'Private', surname: 'Patient', createdAt: '2026-08-01T10:00:00.000Z' }],
    orders: [],
    patients: [],
    integrations: [],
  }, Date.parse('2026-08-16T10:00:00.000Z'));

  assert.equal(overview.organisation.status, 'intake_live');
  assert.equal(overview.organisation.trainingMode, false);
  assert.equal(overview.organisation.allocationHoldingMode, false);
  assert.equal(overview.summary.activePatients, 0);
  assert.equal(overview.summary.awaitingPayment, 0);
  assert.equal(overview.summary.supplierFulfilment, 0);
  assert.equal(overview.recentSessions.length, 0);
});

test('allocation holding is operational without being labelled as training', () => {
  const overview = composePharmacyOverview({
    organisationId: 'primary',
    organisation: { tradingName: 'Primary Branch', status: 'live', testAccount: true, workspaceClassification: 'allocation_holding' },
    submissions: [], patients: [], orders: [], integrations: [],
  }, Date.parse('2026-08-16T10:00:00.000Z'));
  assert.equal(overview.organisation.trainingMode, false);
  assert.equal(overview.organisation.allocationHoldingMode, true);
});

test('v2 applications never enter pharmacy eligibility workload, including after patient activation', () => {
  const base = {
    organisationId: 'pharmacy-a',
    organisation: { tradingName: 'Example Pharmacy', status: 'live', testAccount: false },
    patients: [], orders: [], integrations: [],
  };
  const withheld = composePharmacyOverview({
    ...base,
    submissions: [{ id: 'withheld', schemaVersion: 2, intakeVersion: 'v2', organisationId: 'pharmacy-a', status: 'new', assignmentStatus: 'confirmed', pharmacyAccessStatus: 'withheld', firstName: 'Private', surname: 'Patient' }],
  }, Date.parse('2026-08-16T10:00:00.000Z'));
  const activated = composePharmacyOverview({
    ...base,
    submissions: [{ id: 'activated', schemaVersion: 2, intakeVersion: 'v2', organisationId: 'pharmacy-a', status: 'new', assignmentStatus: 'confirmed', pharmacyAccessStatus: 'activated', firstName: 'Private', surname: 'Patient' }],
  }, Date.parse('2026-08-16T10:00:00.000Z'));
  assert.equal(withheld.summary.activePatients, 0);
  assert.equal(activated.summary.activePatients, 0);
});

test('overview cancellation queue contains only unresolved supplier or refund work', () => {
  assert.equal(cancellationRequiresAction({
    paymentStatus: 'refund_required',
    cancellation: { status: 'refund_required' },
    refund: { status: 'pending_confirmation' },
  }), true);
  assert.equal(cancellationRequiresAction({
    paymentStatus: 'paid',
    cancellation: { status: 'awaiting_curaleaf_confirmation' },
    curaleafCancellation: { status: 'awaiting_confirmation' },
  }), true);
  assert.equal(cancellationRequiresAction({
    paymentStatus: 'refunded',
    cancellation: { status: 'refund_required' },
    refund: { status: 'completed' },
  }), false);
  assert.equal(cancellationRequiresAction({
    paymentStatus: 'expired',
    cancellation: { status: 'cancelled' },
  }), false);

  const overview = composePharmacyOverview({
    organisationId: 'pharmacy-a',
    organisation: { tradingName: 'Example Pharmacy', status: 'live' },
    submissions: [], patients: [], integrations: [],
    orders: [
      { id: 'open-refund', paymentStatus: 'refund_required', cancellation: { status: 'refund_required' }, refund: { status: 'pending_confirmation' } },
      { id: 'completed-refund', paymentStatus: 'refunded', cancellation: { status: 'refund_required' }, refund: { status: 'completed' } },
      { id: 'resolved-cancellation', paymentStatus: 'expired', cancellation: { status: 'cancelled' } },
    ],
  }, Date.parse('2026-08-16T10:00:00.000Z'));

  assert.equal(overview.summary.urgentTotal, 1);
  assert.deepEqual(overview.priorityItems.map(item => item.id), ['cancellation-open-refund']);
});
