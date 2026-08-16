import assert from 'node:assert/strict';
import test from 'node:test';
import { LEGACY_PHARMACY_DECISION_REASON, isNegativeEligibilityStatus, pharmacyDecisionReason } from '../src/utils/eligibilityPresentation.js';

test('declined and rejected are the only negative eligibility outcomes', () => {
  assert.equal(isNegativeEligibilityStatus('Declined'), true);
  assert.equal(isNegativeEligibilityStatus('Rejected'), true);
  assert.equal(isNegativeEligibilityStatus('Approved'), false);
});

test('negative outcomes use only the dedicated pharmacy reason with a safe legacy fallback', () => {
  assert.equal(pharmacyDecisionReason({ status: 'Declined', pharmacyDecisionReason: 'Approved safe reason.' }), 'Approved safe reason.');
  assert.equal(pharmacyDecisionReason({ status: 'Rejected', pharmacyDecisionReason: null }), LEGACY_PHARMACY_DECISION_REASON);
  assert.equal(pharmacyDecisionReason({ status: 'Approved', pharmacyDecisionReason: 'Must not display.' }), null);
});
