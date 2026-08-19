import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { OrganisationRecord } from '../../repositories/ports/organisation.port.js';
import { canReceiveReferral, pharmacyOperationalAccess } from './access.js';

const organisation: OrganisationRecord = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', companyId: null, name: 'Eligible Pharmacy',
  tradingName: 'Eligible Pharmacy', gphcNumber: '9012345', superintendentName: 'Test Pharmacist',
  mainContactName: null, mainContactPhone: null, mainContactEmail: null, address: 'Test address',
  addressLine1: null, addressLine2: null, locality: null, county: null, postcode: null, latitude: null, longitude: null,
  primaryColour: '#12372d', logoText: 'EP', status: 'LIVE', classification: 'STANDARD',
  portalName: 'Eligible Pharmacy', intakeEnabled: true, prescriptionEnabled: true, paymentsEnabled: true,
  supplierOrdersEnabled: true, patientsEnabled: true, resourcesEnabled: true, worldpayEnabled: false,
  defaultPaymentRoute: 'MANUAL', autoPlacementEnabled: false, gdprComplianceFlag: true,
  pausedReason: null, pausedAt: null, version: 1, archivedAt: null,
};

describe('pharmacy intake access', () => {
  it('lets HHH assign to live and intake-live destinations, including hidden allocation pharmacies', () => {
    assert.equal(canReceiveReferral(organisation), true);
    assert.equal(canReceiveReferral({ ...organisation, status: 'INTAKE_LIVE' }), true);
    assert.equal(canReceiveReferral({ ...organisation, classification: 'ALLOCATION_HOLDING' }), true);
    assert.equal(canReceiveReferral({ ...organisation, classification: 'TRAINING' }), false);
    assert.equal(canReceiveReferral({ ...organisation, status: 'ONBOARDING' }), false);
    assert.equal(canReceiveReferral({ ...organisation, status: 'PAUSED' }), false);
  });

  it('withholds pharmacy workspace data and referral email until go-live', () => {
    assert.equal(pharmacyOperationalAccess(organisation), true);
    assert.equal(pharmacyOperationalAccess({ ...organisation, classification: 'ALLOCATION_HOLDING' }), true);
    assert.equal(pharmacyOperationalAccess({ ...organisation, status: 'INTAKE_LIVE' }), false);
    assert.equal(pharmacyOperationalAccess({ ...organisation, status: 'ONBOARDING' }), false);
    assert.equal(pharmacyOperationalAccess({ ...organisation, classification: 'TRAINING' }), false);
  });
});
