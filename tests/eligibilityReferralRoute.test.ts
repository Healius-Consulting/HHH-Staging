import assert from 'node:assert/strict';
import test from 'node:test';
import { parseEligibilityReferralRoute } from '../apps/eligibility/src/referralRoute.ts';

test('eligibility without a token parameter is the general HHH form', () => {
  assert.deepEqual(parseEligibilityReferralRoute(''), { kind: 'general' });
  assert.deepEqual(parseEligibilityReferralRoute('?utm_source=website'), { kind: 'general' });
});

test('a valid single token selects the pharmacy-specific form', () => {
  assert.deepEqual(parseEligibilityReferralRoute('?token=eastwood-3m8q2v'), {
    kind: 'token',
    token: 'eastwood-3m8q2v',
  });
});

test('present but empty, malformed, or ambiguous token parameters fail closed', () => {
  for (const search of ['?token=', '?token=%20', '?token=short', '?token=valid-token-value.', '?token=one-valid-token&token=another-valid-token']) {
    assert.deepEqual(parseEligibilityReferralRoute(search), { kind: 'invalid-token' });
  }
});
