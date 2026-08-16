import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LEGACY_PHARMACY_DECISION_REASON,
  eligibilityDisplayStatus,
  eligibilityReviewProjection,
  negativeEligibilityStatus,
  pharmacyDecisionReasonSchema,
  pharmacyReasonAuditDetails,
} from './eligibility-view.js';

test('eligibility status mapping preserves legacy rejected outcomes', () => {
  assert.equal(eligibilityDisplayStatus('new'), 'New');
  assert.equal(eligibilityDisplayStatus('reviewing'), 'Under HHH review');
  assert.equal(eligibilityDisplayStatus('approved'), 'Approved');
  assert.equal(eligibilityDisplayStatus('declined'), 'Declined');
  assert.equal(eligibilityDisplayStatus('rejected'), 'Rejected');
  assert.equal(negativeEligibilityStatus('declined'), true);
  assert.equal(negativeEligibilityStatus('rejected'), true);
  assert.equal(negativeEligibilityStatus('approved'), false);
});

test('pharmacy eligibility projection omits internal notes and actor identifiers', () => {
  const result = eligibilityReviewProjection({
    status: 'declined',
    reviewedAt: '2026-08-12T12:00:00.000Z',
    reviewedBy: 'firebase-uid-123',
    decisionNote: 'Internal clinical detail',
    pharmacyDecisionReason: 'The referral could not be progressed.',
    recordsCheck: { status: 'completed', notes: 'Internal records note', completedAt: '2026-08-12T11:00:00.000Z', completedBy: 'firebase-uid-123' },
    referral: { status: 'declined', notes: 'Internal referral note', completedAt: '2026-08-12T12:00:00.000Z', completedBy: 'firebase-uid-123' },
  }, 'pharmacy_staff');

  assert.equal(result.reviewerDisplay, 'HHH eligibility team');
  assert.equal(result.pharmacyDecisionReason, 'The referral could not be progressed.');
  assert.equal('reviewedBy' in result, false);
  assert.equal('decisionNote' in result, false);
  assert.equal('notes' in result.recordsCheck, false);
  assert.equal('completedBy' in result.recordsCheck, false);
  assert.equal('notes' in result.referral, false);
  assert.equal('completedBy' in result.referral, false);
});

test('legacy declined and rejected records receive a safe fallback marked for review', () => {
  for (const status of ['declined', 'rejected']) {
    const result = eligibilityReviewProjection({ status, reviewedBy: 'firebase-uid-123' }, 'pharmacy_staff');
    assert.equal(result.pharmacyDecisionReason, LEGACY_PHARMACY_DECISION_REASON);
    assert.equal(result.pharmacyDecisionReasonNeedsReview, true);
    assert.equal(result.reviewerDisplay, 'HHH eligibility team');
  }
});

test('admin eligibility projection retains audit fields', () => {
  const result = eligibilityReviewProjection({ status: 'approved', reviewedBy: 'firebase-uid-123', decisionNote: 'Internal note' }, 'hhh_admin');
  assert.equal(result.reviewedBy, 'firebase-uid-123');
  assert.equal(result.decisionNote, 'Internal note');
});

test('pharmacy-facing decision reasons enforce the disclosure-safe length contract', () => {
  assert.equal(pharmacyDecisionReasonSchema.safeParse('No').success, false);
  assert.equal(pharmacyDecisionReasonSchema.safeParse('A suitable pharmacy-facing reason.').success, true);
  assert.equal(pharmacyDecisionReasonSchema.safeParse('x'.repeat(501)).success, false);
});

test('reason correction audit details identify the record without copying the reason', () => {
  assert.deepEqual(
    pharmacyReasonAuditDetails('pharmacy-a', 'eligibility-123', 'Disclosure-safe patient reason'),
    { organisationId: 'pharmacy-a', recordId: 'eligibility-123', redacted: false },
  );
  assert.deepEqual(
    pharmacyReasonAuditDetails('pharmacy-a', 'eligibility-123', null),
    { organisationId: 'pharmacy-a', recordId: 'eligibility-123', redacted: true },
  );
});
