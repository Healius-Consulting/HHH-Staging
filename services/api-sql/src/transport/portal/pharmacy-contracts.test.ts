import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { OrderRecord } from '../../repositories/ports/order.port.js';
import type { OrganisationRecord } from '../../repositories/ports/organisation.port.js';
import type { PatientRecord } from '../../repositories/ports/patient.port.js';
import {
  buildPharmacyPatientDirectory,
  buildSqlPharmacyOverview,
  toPortalOrder,
  toPortalOrganisation,
  toPortalPatient,
  toPortalPendingEnquiry,
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
  addressLine1: '1 High Street',
  addressLine2: null,
  locality: 'Nottingham',
  county: null,
  postcode: 'NG16 3AA',
  latitude: 52.95,
  longitude: -1.15,
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
  sourceSubmissionId: '00000000-0000-4000-a000-000000000099',
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
  conditions: [],
  sourceSubmission: null,
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
  it('maps SQL organisation enums to the portal contract', () => {
    const mapped = toPortalOrganisation(organisation);
    assert.equal(mapped.status, 'live');
    assert.equal(mapped.workspaceClassification, 'standard');
    assert.equal(mapped.defaultPaymentRoute, 'manual');
    assert.equal('platformFeeMonthly' in mapped, false);
    assert.equal('modules' in mapped, false);
  });

  it('maps a tenant patient without exposing another tenant selector', () => {
    const mapped = toPortalPatient(patient);
    assert.equal(mapped.organisationId, organisation.id);
    assert.equal(mapped.status, 'active');
    assert.equal(mapped.address, '');
    assert.deepEqual(mapped.conditions, []);
  });

  it('maps referred patient eligibility from conditions and source submission', () => {
    const mapped = toPortalPatient({
      ...patient,
      status: 'REFERRED',
      conditions: [
        { conditionCode: 'chronic-pain', primary: true },
        { conditionCode: 'anxiety', primary: false },
      ],
      sourceSubmission: {
        sourceType: 'PHARMACY_QR',
        triedTwoTreatments: true,
        psychiatricExclusion: false,
        heardAbout: 'Pharmacy poster',
        marketingConsent: true,
      },
    });
    assert.equal(mapped.status, 'referred');
    assert.deepEqual(mapped.conditions, ['chronic-pain', 'anxiety']);
    assert.equal(mapped.primaryCondition, 'chronic-pain');
    assert.equal(mapped.referralSource, 'future_pharmacy_qr');
    assert.equal(mapped.triedTwoTreatments, true);
    assert.equal(mapped.psychiatricExclusion, false);
    assert.equal(mapped.heardAbout, 'Pharmacy poster');
    assert.equal(mapped.marketingConsent, true);
  });

  it('maps a migrated SQL order to the rich list contract', () => {
    const mapped = toPortalOrder(order);
    assert.equal(mapped.organisationId, organisation.id);
    assert.equal(mapped.paymentStatus, 'pending');
    assert.equal(mapped.fulfilmentStatus, 'supplier_processing');
    assert.equal(mapped.curaleaf, undefined);
    assert.deepEqual(mapped.lineItems, []);
  });

  it('maps a split Curaleaf shipment onto the portal contract without inventing a full dispatch', () => {
    const mapped = toPortalOrder({
      ...order,
      paymentStatus: 'PAID',
      paidAt: '2026-08-13T10:30:00.000Z',
      fulfilmentStatus: 'SUPPLIER_PROCESSING',
      quoteSnapshot: {
        lineItems: [{
          packId: '9f2d6958-2d76-4338-9e5f-6fd383dfff36',
          productId: '9f2d6958-2d76-4338-9e5f-6fd383dfff36',
          formulaId: 'f74f63de-dc89-4074-9d8c-be35f5398963',
          name: '4C Labs BWD T30 Beach Wedding, 30% THC <1% CBD',
          quantity: 4,
          unitPricePence: 8500,
        }],
        prescriptions: [{
          id: 'rx-beach',
          fileId: 'rx-beach',
          serialNumber: 'RX-BEACH',
          issueDate: '2026-08-13',
          prescriber: { name: 'Dr Test', pin: '123', gmcNumber: null, gphcNumber: null, initials: 'DT' },
          items: [],
        }],
      },
      curaleaf: {
        id: '99f4bc42-4312-45c5-b659-21583b5eb364',
        state: 'PROCESSING',
        courier: 'POLAR_SPEED',
        customerReference: 'HHH-5a8b4ac3-236c-41f7-a37b-0132b7892637-a9386eac93',
        issuedDate: '2026-08-13',
        createdAt: '2026-08-13T10:29:08.933558Z',
        items: [{
          productId: '9f2d6958-2d76-4338-9e5f-6fd383dfff36',
          packsOrderedCount: 4,
          packsAllocatedCount: 2,
          packsReturnedCount: 0,
        }],
        shipments: [{
          id: 'b13179c4-9515-4181-abd8-d1b87b50faa4',
          purchaseOrderId: '99f4bc42-4312-45c5-b659-21583b5eb364',
          createdAt: '2026-08-17T14:29:05.973745Z',
          items: [{ productId: '9f2d6958-2d76-4338-9e5f-6fd383dfff36', packCount: 2 }],
        }],
      },
    } as OrderRecord & { curaleaf: unknown });

    assert.equal(mapped.fulfilmentStatus, 'partially_dispatched_to_pharmacy');
    assert.equal(mapped.curaleaf?.dispatchStatus, 'partial');
    assert.equal(mapped.curaleaf?.customerReference, 'HHH-5a8b4ac3-236c-41f7-a37b-0132b7892637-a9386eac93');
    assert.deepEqual(mapped.curaleaf?.shipmentIds, ['b13179c4-9515-4181-abd8-d1b87b50faa4']);
    const line = mapped.prescriptionFlow?.['rx-beach']?.lines[0];
    assert.equal(line?.ordered, 4);
    assert.equal(line?.allocated, 2);
    assert.equal(line?.shipped, 2);
    assert.equal(line?.remaining, 2);
    assert.equal(line?.received, 0);
    assert.equal(mapped.lineItems[0]?.name, '4C Labs BWD T30 Beach Wedding, 30% THC <1% CBD');
    assert.equal(mapped.prescriptionFlow?.['rx-beach']?.latestShipmentAt, '2026-08-17T14:29:05.973745Z');
    assert.equal(mapped.prescriptionFlow?.['rx-beach']?.state, 'PLACED');
  });

  it('downgrades stale goods-in fulfilment when a partial consignment is still in transit', () => {
    const mapped = toPortalOrder({
      ...order,
      id: '5a8b4ac3-236c-41f7-a37b-0132b7892637',
      paymentStatus: 'PAID',
      paidAt: '2026-08-13T10:30:00.000Z',
      fulfilmentStatus: 'READY_FOR_COLLECTION',
      quoteSnapshot: {
        lineItems: [{
          packId: '9f2d6958-2d76-4338-9e5f-6fd383dfff36',
          productId: '9f2d6958-2d76-4338-9e5f-6fd383dfff36',
          formulaId: 'f74f63de-dc89-4074-9d8c-be35f5398963',
          name: '4C Labs BWD T30 Beach Wedding, 30% THC <1% CBD',
          quantity: 4,
          unitPricePence: 8500,
        }],
        prescriptions: [{
          id: 'rx-beach',
          fileId: 'rx-beach',
          serialNumber: 'RX-BEACH',
          issueDate: '2026-08-13',
          prescriber: { name: 'Dr Test', pin: '123', gmcNumber: null, gphcNumber: null, initials: 'DT' },
          items: [],
        }],
        curaleaf: {
          shipmentStates: { 'b13179c4-9515-4181-abd8-d1b87b50faa4': 'ready_for_collection' },
        },
      },
      curaleaf: {
        id: '99f4bc42-4312-45c5-b659-21583b5eb364',
        state: 'PROCESSING',
        courier: 'POLAR_SPEED',
        customerReference: 'HHH-5a8b4ac3-236c-41f7-a37b-0132b7892637-a9386eac93',
        issuedDate: '2026-08-13',
        createdAt: '2026-08-13T10:29:08.933558Z',
        items: [{
          productId: '9f2d6958-2d76-4338-9e5f-6fd383dfff36',
          packsOrderedCount: 4,
          packsAllocatedCount: 2,
          packsReturnedCount: 0,
        }],
        shipments: [{
          id: 'b13179c4-9515-4181-abd8-d1b87b50faa4',
          purchaseOrderId: '99f4bc42-4312-45c5-b659-21583b5eb364',
          createdAt: '2026-08-17T14:29:05.973745Z',
          items: [{ productId: '9f2d6958-2d76-4338-9e5f-6fd383dfff36', packCount: 2 }],
        }],
        shipmentStates: { 'b13179c4-9515-4181-abd8-d1b87b50faa4': 'ready_for_collection' },
      },
    } as OrderRecord & { curaleaf: unknown });

    assert.equal(mapped.fulfilmentStatus, 'partially_dispatched_to_pharmacy');
    assert.equal(mapped.prescriptionFlow?.['rx-beach']?.state, 'PLACED');
    const line = mapped.prescriptionFlow?.['rx-beach']?.lines[0];
    assert.equal(line?.received, 0);
    assert.equal(line?.shipped, 2);
  });

  it('maps a fully allocated Curaleaf consignment as complete dispatch without inventing goods-in', () => {
    const mapped = toPortalOrder({
      ...order,
      id: '93eea688-3a39-4b1d-b998-e43cc16acf4b',
      paymentStatus: 'PAID',
      paidAt: '2026-08-13T10:32:00.000Z',
      fulfilmentStatus: 'SUPPLIER_PROCESSING',
      quoteSnapshot: {
        lineItems: [{
          packId: '9f2d6958-2d76-4338-9e5f-6fd383dfff36',
          productId: '9f2d6958-2d76-4338-9e5f-6fd383dfff36',
          formulaId: 'f74f63de-dc89-4074-9d8c-be35f5398963',
          name: '4C Labs BWD T30 Beach Wedding, 30% THC <1% CBD',
          quantity: 2,
          unitPricePence: 8500,
        }],
        prescriptions: [{
          id: 'rx-full',
          fileId: 'rx-full',
          serialNumber: 'RX-FULL',
          issueDate: '2026-08-13',
          prescriber: { name: 'Dr Test', pin: '123', gmcNumber: null, gphcNumber: null, initials: 'DT' },
          items: [],
        }],
      },
      curaleaf: {
        id: '6e5e3d6e-5b14-4b8a-bb0e-d6d60ed6f69f',
        state: 'FULLY_ALLOCATED',
        courier: 'POLAR_SPEED',
        customerReference: 'HHH-93eea688-3a39-4b1d-b998-e43cc16acf4b-c10dbf6885',
        issuedDate: '2026-08-13',
        createdAt: '2026-08-13T10:31:34.825350Z',
        items: [{
          productId: '9f2d6958-2d76-4338-9e5f-6fd383dfff36',
          packsOrderedCount: 2,
          packsAllocatedCount: 2,
          packsReturnedCount: 0,
        }],
        shipments: [{
          id: 'f46d4159-f0dc-49fe-9189-4f0a59ea18e2',
          purchaseOrderId: '6e5e3d6e-5b14-4b8a-bb0e-d6d60ed6f69f',
          createdAt: '2026-08-17T14:30:05.319618Z',
          items: [{
            productId: '9f2d6958-2d76-4338-9e5f-6fd383dfff36',
            packCount: 2,
            batchNumber: 'A409003',
            batchExpiryDate: '2027-02-06',
          }],
        }],
      },
    } as OrderRecord & { curaleaf: unknown });

    assert.equal(mapped.fulfilmentStatus, 'dispatched_to_pharmacy');
    assert.equal(mapped.curaleaf?.dispatchStatus, 'complete');
    const line = mapped.prescriptionFlow?.['rx-full']?.lines[0];
    assert.equal(line?.ordered, 2);
    assert.equal(line?.allocated, 2);
    assert.equal(line?.shipped, 2);
    assert.equal(line?.remaining, 0);
    assert.equal(line?.received, 0);
    assert.equal(mapped.prescriptionFlow?.['rx-full']?.latestShipmentAt, '2026-08-17T14:30:05.319618Z');
    assert.equal(mapped.lineItems[0]?.name, '4C Labs BWD T30 Beach Wedding, 30% THC <1% CBD');
  });

  it('maps a 1-of-10 Curaleaf consignment as a split shipment and keeps pharmacy goods-in', () => {
    const mapped = toPortalOrder({
      ...order,
      id: 'a55ee7d4-6466-4e95-bf7f-88a95241e60f',
      paymentStatus: 'PAID',
      paidAt: '2026-08-13T09:24:00.000Z',
      fulfilmentStatus: 'PARTIALLY_RECEIVED',
      quoteSnapshot: {
        lineItems: [{
          packId: '9f2d6958-2d76-4338-9e5f-6fd383dfff36',
          productId: '9f2d6958-2d76-4338-9e5f-6fd383dfff36',
          formulaId: 'f74f63de-dc89-4074-9d8c-be35f5398963',
          name: '4C Labs BWD T30 Beach Wedding, 30% THC <1% CBD',
          quantity: 10,
          unitPricePence: 8500,
        }],
        prescriptions: [{
          id: 'rx-ten',
          fileId: 'rx-ten',
          serialNumber: 'RX-TEN',
          issueDate: '2026-08-13',
          prescriber: { name: 'Dr Test', pin: '123', gmcNumber: null, gphcNumber: null, initials: 'DT' },
          items: [],
        }],
        curaleaf: {
          lines: [{ productId: '9f2d6958-2d76-4338-9e5f-6fd383dfff36', received: 1, collected: 0 }],
        },
      },
      curaleaf: {
        id: '65ba3fdd-4507-4e39-a8ed-2d383b04e1d8',
        state: 'PROCESSING',
        courier: 'POLAR_SPEED',
        customerReference: 'HHH-a55ee7d4-6466-4e95-bf7f-88a95241e60f-383b50e0f9',
        issuedDate: '2026-08-13',
        createdAt: '2026-08-13T09:23:29.241487Z',
        items: [{
          productId: '9f2d6958-2d76-4338-9e5f-6fd383dfff36',
          packsOrderedCount: 10,
          packsAllocatedCount: 1,
          packsReturnedCount: 0,
        }],
        lines: [{ productId: '9f2d6958-2d76-4338-9e5f-6fd383dfff36', received: 1, collected: 0 }],
        shipments: [{
          id: '796adea9-f2d9-43b2-ad5c-ccfc4184ee62',
          purchaseOrderId: '65ba3fdd-4507-4e39-a8ed-2d383b04e1d8',
          createdAt: '2026-08-17T08:50:45.621344Z',
          items: [{
            productId: '9f2d6958-2d76-4338-9e5f-6fd383dfff36',
            packCount: 1,
            batchNumber: 'A409003',
            batchExpiryDate: '2027-02-06',
          }],
        }],
      },
    } as OrderRecord & { curaleaf: unknown });

    assert.equal(mapped.fulfilmentStatus, 'partially_received');
    assert.equal(mapped.curaleaf?.dispatchStatus, 'partial');
    const line = mapped.prescriptionFlow?.['rx-ten']?.lines[0];
    assert.equal(line?.ordered, 10);
    assert.equal(line?.allocated, 1);
    assert.equal(line?.shipped, 1);
    assert.equal(line?.remaining, 9);
    assert.equal(line?.received, 1);
    assert.equal(mapped.prescriptionFlow?.['rx-ten']?.latestShipmentAt, '2026-08-17T08:50:45.621344Z');
    assert.equal(mapped.lineItems[0]?.name, '4C Labs BWD T30 Beach Wedding, 30% THC <1% CBD');
  });

  it('keeps Beach Wedding 2-of-4 check-in after a Curaleaf re-sync', () => {
    const mapped = toPortalOrder({
      ...order,
      id: '5a8b4ac3-236c-41f7-a37b-0132b7892637',
      paymentStatus: 'PAID',
      paidAt: '2026-08-13T10:30:00.000Z',
      fulfilmentStatus: 'PARTIALLY_RECEIVED',
      quoteSnapshot: {
        lineItems: [{
          packId: '9f2d6958-2d76-4338-9e5f-6fd383dfff36',
          productId: '9f2d6958-2d76-4338-9e5f-6fd383dfff36',
          formulaId: 'f74f63de-dc89-4074-9d8c-be35f5398963',
          name: '4C Labs BWD T30 Beach Wedding, 30% THC <1% CBD',
          quantity: 4,
          unitPricePence: 8500,
        }],
        prescriptions: [{
          id: 'rx-beach',
          fileId: 'rx-beach',
          serialNumber: 'RX-BEACH',
          issueDate: '2026-08-13',
          prescriber: { name: 'Dr Test', pin: '123', gmcNumber: null, gphcNumber: null, initials: 'DT' },
          items: [],
        }],
        curaleaf: {
          lines: [{ productId: '9f2d6958-2d76-4338-9e5f-6fd383dfff36', received: 2, collected: 0 }],
          shipmentStates: { 'b13179c4-9515-4181-abd8-d1b87b50faa4': 'received' },
        },
      },
      curaleaf: {
        id: '99f4bc42-4312-45c5-b659-21583b5eb364',
        state: 'PROCESSING',
        courier: 'POLAR_SPEED',
        customerReference: 'HHH-5a8b4ac3-236c-41f7-a37b-0132b7892637-a9386eac93',
        issuedDate: '2026-08-13',
        createdAt: '2026-08-13T10:29:08.933558Z',
        items: [{
          productId: '9f2d6958-2d76-4338-9e5f-6fd383dfff36',
          packsOrderedCount: 4,
          packsAllocatedCount: 2,
          packsReturnedCount: 0,
        }],
        shipments: [{
          id: 'b13179c4-9515-4181-abd8-d1b87b50faa4',
          purchaseOrderId: '99f4bc42-4312-45c5-b659-21583b5eb364',
          createdAt: '2026-08-17T14:29:05.973745Z',
          items: [{ productId: '9f2d6958-2d76-4338-9e5f-6fd383dfff36', packCount: 2 }],
        }],
        lines: [{ productId: '9f2d6958-2d76-4338-9e5f-6fd383dfff36', received: 2, collected: 0 }],
        shipmentStates: { 'b13179c4-9515-4181-abd8-d1b87b50faa4': 'received' },
      },
    } as OrderRecord & { curaleaf: unknown });

    assert.equal(mapped.fulfilmentStatus, 'partially_received');
    const line = mapped.prescriptionFlow?.['rx-beach']?.lines[0];
    assert.equal(line?.received, 2);
    assert.equal(line?.remaining, 2);
    assert.equal(mapped.prescriptionFlow?.['rx-beach']?.state, 'PARTIALLY_RECEIVED');
    assert.equal(mapped.prescriptionFlow?.['rx-beach']?.shipmentStates?.['b13179c4-9515-4181-abd8-d1b87b50faa4'], 'received');
  });

  it('maps a pending tenant enquiry without patient PII', () => {
    const mapped = toPortalPendingEnquiry({
      id: '12345678-1234-4123-8123-123456789012',
      submittedAt: '2026-08-17T09:15:00.000Z',
      followUpStatus: 'NOT_STARTED',
      sourceType: 'PHARMACY_QR',
    });
    assert.equal(mapped.caseReference, 'HHH-20260817-12345678');
    assert.equal(mapped.displayStatus, 'New enquiry');
    assert.equal(mapped.sourceType, 'future_pharmacy_qr');
    assert.equal(JSON.stringify(mapped).includes('firstName'), false);
  });

  it('maps an in-progress HHH review enquiry', () => {
    const mapped = toPortalPendingEnquiry({
      id: '12345678-1234-4123-8123-123456789012',
      submittedAt: '2026-08-17T09:15:00.000Z',
      followUpStatus: 'IN_PROGRESS',
      sourceType: 'GENERAL_HHH_WEBSITE',
    });
    assert.equal(mapped.displayStatus, 'Under HHH review');
    assert.equal(mapped.sourceType, 'general_hhh_website');
  });

  it('builds a combined pharmacy patient directory payload', () => {
    const directory = buildPharmacyPatientDirectory({
      patients: [{
        ...({
          id: 'patient-1',
          organisationId: organisation.id,
          sourceSubmissionId: 'sub-1',
          firstName: 'Avery',
          surname: 'Taylor',
          dob: '1990-01-01',
          email: 'avery@example.com',
          mobile: '07000000000',
          address: null,
          postcode: 'SW1A 1AA',
          status: 'REFERRED',
          activatedAt: null,
          statusChangedAt: null,
          version: 1,
          createdAt: '2026-08-17T10:00:00.000Z',
          updatedAt: '2026-08-17T10:00:00.000Z',
        }),
        conditions: [{ conditionCode: 'chronic_pain', primary: true }],
        sourceSubmission: {
          sourceType: 'PHARMACY_QR',
          triedTwoTreatments: true,
          psychiatricExclusion: false,
          heardAbout: 'Friend',
          marketingConsent: false,
        },
      }],
      pendingEnquiries: [{
        id: '12345678-1234-4123-8123-123456789012',
        submittedAt: '2026-08-17T09:15:00.000Z',
        followUpStatus: 'NOT_STARTED',
        sourceType: 'PHARMACY_QR',
      }],
    });
    assert.equal(directory.counts.patients, 1);
    assert.equal(directory.counts.pendingEnquiries, 1);
    assert.equal(directory.patients[0]?.conditions[0], 'chronic_pain');
    assert.equal(directory.enquiries[0]?.displayStatus, 'New enquiry');
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
    assert.equal(overview.priorityItems[0]?.maskedPatientLabel, 'Patient, A');
    assert.equal(overview.priorityItems[0]?.orderReference, '#ORD-1001');
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
