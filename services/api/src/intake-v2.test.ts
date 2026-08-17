import assert from 'node:assert/strict';
import test from 'node:test';
import { assignmentEventFields, canPharmacyAccessCase, directoryPublicationIssues, expectedConsentVersion, haversineMiles, isDedicatedSourceType, isNorthernIrelandPostcode, normaliseUkPostcode, pharmacyDisplayStatus, projectDirectoryMapPositions, topFiveNearest } from './intake-v2.js';

test('UK postcodes are normalised without storing them in a URL-shaped value', () => {
  assert.equal(normaliseUkPostcode('sw1a 1aa'), 'SW1A 1AA');
  assert.equal(normaliseUkPostcode(' EC1V-2NX '), 'EC1V 2NX');
  assert.throws(() => normaliseUkPostcode('not a postcode'));
  assert.throws(() => normaliseUkPostcode('12345'));
});

test('Northern Ireland postcodes stay on manual allocation until commercial data use is licensed', () => {
  assert.equal(isNorthernIrelandPostcode('BT1 5GS'), true);
  assert.equal(isNorthernIrelandPostcode('SW1A 1AA'), false);
});

test('Haversine ranking is national, ascending and capped at five', () => {
  const origin = { latitude: 51.5, longitude: -0.1 };
  const candidates = [5, 1, 7, 2, 3, 6, 4].map(distance => ({ id: String(distance), latitude: 51.5 + distance / 10, longitude: -0.1 }));
  const ranked = topFiveNearest(origin, candidates);
  assert.deepEqual(ranked.map(item => item.profile.id), ['1', '2', '3', '4', '5']);
  assert.ok(haversineMiles(origin, candidates[1]!) > 0);
});

test('directory map positions are projected server-side without exposing coordinates', () => {
  const positions = projectDirectoryMapPositions(
    { latitude: 51.5, longitude: -0.1 },
    [{ latitude: 52, longitude: -0.1 }, { latitude: 51.5, longitude: 0.4 }],
  );
  assert.equal(positions.length, 2);
  assert.ok(positions[0]!.yPercent < 50);
  assert.ok(positions[1]!.xPercent > 50);
  assert.deepEqual(Object.keys(positions[0]!).sort(), ['xPercent', 'yPercent']);
});

test('directory publication rejects training and incomplete readiness', () => {
  const profile = { realClassification: 'training', acceptingNewPatients: false, intakeState: 'full', gdprEvidenceState: 'missing', curaleafIntegrationState: 'test_verified' };
  const organisation = { status: 'live', testAccount: true, gdprExempt: true, gphcNumber: 'TRAINING-ONE' };
  const issues = directoryPublicationIssues(profile, organisation);
  assert.ok(issues.includes('TRAINING_OR_NON_REAL_ORGANISATION'));
  assert.ok(issues.includes('GDPR_EVIDENCE_REQUIRED'));
  assert.ok(issues.includes('PRODUCTION_INTEGRATION_REQUIRED'));
});

test('consent and pharmacy status projections are source-specific', () => {
  assert.equal(expectedConsentVersion('general_hhh_website'), 'general-public-v2.1');
  assert.equal(expectedConsentVersion('future_pharmacy_qr'), 'pharmacy-qr-v2.1');
  assert.equal(pharmacyDisplayStatus({ schemaVersion: 2, assignmentStatus: 'confirmed', pharmacyAccessStatus: 'withheld', pharmacyReviewStatus: 'not_opened' }), 'Awaiting HHH referral');
  assert.equal(pharmacyDisplayStatus({ assignmentStatus: 'provisional', pharmacyReviewStatus: 'opened' }), 'Pending HHH allocation review');
  assert.equal(pharmacyDisplayStatus({ assignmentStatus: 'confirmed', pharmacyReviewStatus: 'not_opened' }), 'Assignment confirmed');
  assert.equal(pharmacyDisplayStatus({ assignmentStatus: 'confirmed', pharmacyReviewStatus: 'reviewing' }), 'Under pharmacy review');
});

test('new HHH-first cases never enter the pharmacy eligibility-review queue', () => {
  assert.equal(canPharmacyAccessCase({ assignmentStatus: 'awaiting_hhh_allocation', pharmacyAccessStatus: 'withheld' }), false);
  assert.equal(canPharmacyAccessCase({ assignmentStatus: 'confirmed', pharmacyAccessStatus: 'withheld' }), false);
  assert.equal(canPharmacyAccessCase({ assignmentStatus: 'confirmed', pharmacyAccessStatus: 'activated' }), false);
  assert.equal(canPharmacyAccessCase({}, false), true);
});

test('dedicated-link sources are immutable while main-site preferences remain allocatable', () => {
  assert.equal(isDedicatedSourceType('future_pharmacy_qr'), true);
  assert.equal(isDedicatedSourceType('legacy_pharmacy_qr'), true);
  assert.equal(isDedicatedSourceType('general_hhh_website'), false);
});

test('assignment events cannot carry patient, contact, postcode, clinical or note text', () => {
  const event = assignmentEventFields({ caseId: 'case-id', previousOrganisationId: 'old', newOrganisationId: 'new', action: 'reassigned', reasonCode: 'capacity', actorUid: 'staff-id', occurredAt: '2026-08-16T00:00:00.000Z', pharmacyReviewStarted: true, previousAssignmentVersion: 2, newAssignmentVersion: 3, notePresent: true });
  const keys = Object.keys(event).join(' ').toLowerCase();
  for (const prohibited of ['firstname', 'surname', 'email', 'mobile', 'postcode', 'condition', 'clinical', 'notetext']) assert.equal(keys.includes(prohibited), false);
  assert.equal(event.notePresent, true);
});
