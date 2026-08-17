import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  derivePatientJourneyStage,
  mapPortalPatientRecord,
  patientClinicalProfile,
  portalSourceLabel,
} from '../src/utils/pharmacyPatientDirectory.ts';

describe('pharmacyPatientDirectory', () => {
  it('maps portal patients into pharmacy CRM rows', () => {
    const mapped = mapPortalPatientRecord({
      id: 'p1',
      organisationId: 'org1',
      firstName: 'Avery',
      surname: 'Taylor',
      dob: '1990-01-01',
      email: 'avery@example.com',
      mobile: '07000000000',
      address: '1 High Street',
      postcode: 'SW1A 1AA',
      status: 'referred',
      conditions: ['chronic_pain'],
      primaryCondition: 'chronic_pain',
      referralSource: 'future_pharmacy_qr',
      triedTwoTreatments: true,
      psychiatricExclusion: false,
      heardAbout: 'Friend',
      marketingConsent: false,
      createdAt: '2026-08-17T10:00:00.000Z',
      updatedAt: '2026-08-17T10:00:00.000Z',
    });
    assert.equal(mapped.status, 'Referred');
    assert.equal(mapped.conditions?.[0], 'chronic_pain');
  });

  it('builds a unified clinical profile from CRM data', () => {
    const profile = patientClinicalProfile({
      crmPatient: {
        id: 'p1',
        organisationId: 'org1',
        name: 'Avery Taylor',
        email: 'avery@example.com',
        mobile: '07000000000',
        status: 'Referred',
        conditions: ['chronic_pain'],
        primaryCondition: 'chronic_pain',
        referralSource: 'future_pharmacy_qr',
        triedTwoTreatments: true,
        psychiatricExclusion: false,
        heardAbout: 'Friend',
        marketingConsent: false,
      },
      submission: null,
    });
    assert.equal(profile.triedTwoTreatments, true);
    assert.equal(profile.onboardingPillStatus, 'Approved');
  });

  it('marks referred patients before they enter active care', () => {
    assert.equal(
      derivePatientJourneyStage({
        crmPatient: { id: 'p1', organisationId: 'org1', name: 'A', email: 'a@b.c', mobile: '1', status: 'Referred' },
        submission: null,
        orderCount: 0,
        isNegativeEligibility: () => false,
      }),
      'referred',
    );
  });

  it('labels referral sources for display', () => {
    assert.equal(portalSourceLabel('future_pharmacy_qr'), 'Pharmacy QR link');
  });
});
