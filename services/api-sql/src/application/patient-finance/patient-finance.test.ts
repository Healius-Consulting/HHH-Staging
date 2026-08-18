import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  activatePatientForOrder,
  assertPatientEligibleForOrder,
  recordCollectedDispense,
  REFERRAL_FEE_PENCE,
} from './patient-finance.js';
import type { PatientFinanceRepositoryPort } from '../../repositories/ports/patient-finance.port.js';
import type { PatientRecord, PatientRepositoryPort } from '../../repositories/ports/patient.port.js';

function patient(overrides: Partial<PatientRecord> = {}): PatientRecord {
  return {
    id: 'patient-1',
    organisationId: 'org-1',
    sourceSubmissionId: null,
    firstName: 'Avery',
    surname: 'Testpatient',
    dob: '1988-04-12',
    email: 'avery@example.com',
    mobile: '07000000000',
    address: null,
    postcode: 'SW1A 1AA',
    status: 'REFERRED',
    activatedAt: null,
    statusChangedAt: null,
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    conditions: [],
    sourceSubmission: null,
    ...overrides,
  };
}

describe('patient finance', () => {
  it('rejects inactive patients for new orders', () => {
    assert.throws(
      () => assertPatientEligibleForOrder(patient({ status: 'INACTIVE' })),
      /not eligible/i,
    );
  });

  it('allows referred and active patients for new orders', () => {
    assert.doesNotThrow(() => assertPatientEligibleForOrder(patient({ status: 'REFERRED' })));
    assert.doesNotThrow(() => assertPatientEligibleForOrder(patient({ status: 'ACTIVE' })));
  });

  it('activates referred patients once on Curaleaf placement', async () => {
    let status: PatientRecord['status'] = 'REFERRED';
    const updates: Array<{ status: PatientRecord['status'] }> = [];
    const patientRepo: PatientRepositoryPort = {
      listTenantPatients: async () => [],
      listPlatformPatients: async () => [],
      findPatientById: async () => patient({ status }),
      updatePatientStatus: async data => {
        status = data.status;
        updates.push({ status: data.status });
      },
    };
    const patientFinanceRepo: PatientFinanceRepositoryPort = {
      findDispenseEvent: async () => null,
      insertDispenseEvent: async () => undefined,
      hasNewReferralFee: async () => false,
      insertReferralFeeEvent: async () => undefined,
    };

    const first = await activatePatientForOrder(
      { patientRepo, patientFinanceRepo },
      { organisationId: 'org-1', patientId: 'patient-1', orderId: 'order-1' },
    );
    const second = await activatePatientForOrder(
      { patientRepo, patientFinanceRepo },
      { organisationId: 'org-1', patientId: 'patient-1', orderId: 'order-2' },
    );

    assert.equal(first.activated, true);
    assert.equal(second.activated, false);
    assert.deepEqual(updates, [{ status: 'ACTIVE' }]);
  });

  it('records first collected dispense fee idempotently', async () => {
    const fees: Array<{ amountPence: number; kind: string }> = [];
    const dispenses: string[] = [];
    let hasFee = false;
    const patientRepo: PatientRepositoryPort = {
      listTenantPatients: async () => [],
      listPlatformPatients: async () => [],
      findPatientById: async () => patient({ status: 'ACTIVE' }),
      updatePatientStatus: async () => undefined,
    };
    const patientFinanceRepo: PatientFinanceRepositoryPort = {
      findDispenseEvent: async (_orderId, dispenseKey) => dispenses.includes(dispenseKey) ? { id: 'd1', orderId: 'order-1', dispenseKey } : null,
      insertDispenseEvent: async data => { dispenses.push(data.dispenseKey); },
      hasNewReferralFee: async () => hasFee,
      insertReferralFeeEvent: async data => {
        hasFee = true;
        fees.push({ amountPence: data.amountPence, kind: data.kind });
      },
    };

    const first = await recordCollectedDispense(
      { patientRepo, patientFinanceRepo },
      {
        organisationId: 'org-1',
        patientId: 'patient-1',
        orderId: 'order-1',
        actorUid: 'staff-1',
        dispenseKey: 'shipment-1',
        collectedAt: '2026-08-18T00:00:00.000Z',
      },
    );
    const second = await recordCollectedDispense(
      { patientRepo, patientFinanceRepo },
      {
        organisationId: 'org-1',
        patientId: 'patient-1',
        orderId: 'order-1',
        actorUid: 'staff-1',
        dispenseKey: 'shipment-1',
        collectedAt: '2026-08-18T00:00:00.000Z',
      },
    );

    assert.equal(first.feeCreated, true);
    assert.equal(first.idempotent, false);
    assert.equal(second.idempotent, true);
    assert.equal(fees.length, 1);
    assert.equal(fees[0]?.amountPence, REFERRAL_FEE_PENCE);
    assert.equal(fees[0]?.kind, 'NEW_REFERRAL');
  });
});
