import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { OrderRecord } from '../../repositories/ports/order.port.js';
import type { OrganisationRecord } from '../../repositories/ports/organisation.port.js';
import type { PatientRecord } from '../../repositories/ports/patient.port.js';
import {
  buildSqlPharmacyOverview,
  toPortalOrder,
  toPortalOrganisation,
  toPortalPatient,
} from './pharmacy-contracts.js';

const organisation: OrganisationRecord = {
  id: '70913a30-71c3-4a41-952e-d532927af58c',
  companyId: null,
  name: 'Example Pharmacy Ltd',
  tradingName: 'Example Pharmacy',
  gphcNumber: '1234567',
  superintendentName: 'Superintendent',
  mainContactName: null,
  mainContactPhone: null,
  mainContactEmail: null,
  address: '1 High Street',
  primaryColour: '#0f766e',
  logoText: 'EP',
  status: 'LIVE',
  classification: 'STANDARD',
  portalName: 'Example Portal',
  intakeEnabled: true,
  prescriptionEnabled: true,
  paymentsEnabled: true,
  supplierOrdersEnabled: true,
  patientsEnabled: true,
  resourcesEnabled: true,
  worldpayEnabled: false,
  defaultPaymentRoute: 'MANUAL',
  autoPlacementEnabled: true,
  gdprComplianceFlag: true,
  pausedReason: null,
  pausedAt: null,
  version: 1,
};

const patient: PatientRecord = {
  id: '00000000-0000-4000-a000-000000000001',
  organisationId: organisation.id,
  sourceSubmissionId: null,
  firstName: 'Alicia',
  surname: 'Patient',
  dob: '1990-01-01',
  email: 'patient@example.test',
  mobile: '07000000000',
  address: null,
  postcode: 'SW1A 1AA',
  status: 'ACTIVE',
  activatedAt: '2026-08-01T09:00:00.000Z',
  statusChangedAt: null,
  version: 1,
  createdAt: '2026-08-01T09:00:00.000Z',
  updatedAt: '2026-08-01T09:00:00.000Z',
};

const order: OrderRecord = {
  id: '00000000-0000-4000-a000-000000000002',
  organisationId: organisation.id,
  patientId: patient.id,
  draftId: null,
  orderNumber: 'ORD-1001',
  status: 'SUBMITTED',
  paymentStatus: 'PENDING',
  fulfilmentStatus: 'SUPPLIER_PROCESSING',
  paymentRoute: 'MANUAL',
  currency: 'GBP',
  medicineTotalPence: 10000,
  dispensingFeePence: 500,
  deliveryPence: 0,
  taxPence: 0,
  totalPence: 10500,
  quoteSnapshot: null,
  version: 1,
  submittedAt: '2026-08-01T10:00:00.000Z',
  paidAt: null,
  collectedAt: null,
  cancelledAt: null,
  createdAt: '2026-08-01T10:00:00.000Z',
  updatedAt: '2026-08-01T10:00:00.000Z',
};

describe('SQL pharmacy compatibility contracts', () => {
  it('maps SQL organisation enums and module flags to the portal contract', () => {
    const mapped = toPortalOrganisation(organisation);
    assert.equal(mapped.status, 'live');
    assert.equal(mapped.workspaceClassification, 'standard');
    assert.equal(mapped.defaultPaymentRoute, 'manual');
    assert.equal('platformFeeMonthly' in mapped, false);
    assert.equal(mapped.modules.patients, true);
  });

  it('maps a tenant patient without exposing another tenant selector', () => {
    const mapped = toPortalPatient(patient);
    assert.equal(mapped.organisationId, organisation.id);
    assert.equal(mapped.status, 'active');
    assert.equal(mapped.address, '');
    assert.deepEqual(mapped.conditions, []);
  });

  it('maps a migrated SQL order to the rich list contract', () => {
    const mapped = toPortalOrder(order);
    assert.equal(mapped.organisationId, organisation.id);
    assert.equal(mapped.paymentStatus, 'pending');
    assert.equal(mapped.fulfilmentStatus, 'supplier_processing');
    assert.equal(mapped.curaleaf?.status, 'purchase_order_submitted');
    assert.deepEqual(mapped.lineItems, []);
  });

  it('builds a PII-masked tenant overview from SQL rows', () => {
    const overview = buildSqlPharmacyOverview({
      organisation,
      patients: [patient],
      orders: [order],
      pendingEnquiries: [{ submittedAt: '2026-08-16T09:30:00.000Z' }],
      now: Date.parse('2026-08-16T10:00:00.000Z'),
    });
    assert.equal(overview.summary.activePatients, 1);
    assert.equal(overview.summary.awaitingPayment, 1);
    assert.equal(overview.summary.supplierFulfilment, 1);
    assert.equal(overview.priorityItems.length, 1);
    assert.equal(overview.priorityItems[0]?.maskedPatientLabel.includes('Alicia'), false);
    assert.equal(overview.priorityItems[0]?.recordTarget.id, order.id);
    assert.deepEqual(overview.enquiries, {
      pendingCount: 1,
      latestSubmittedAt: '2026-08-16T09:30:00.000Z',
      state: 'hhh_reviewing',
    });
    assert.equal(JSON.stringify(overview.enquiries).includes(patient.email), false);
    assert.equal('platformFeeMonthly' in overview.organisation, false);
  });
});
