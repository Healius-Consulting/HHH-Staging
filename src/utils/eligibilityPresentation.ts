export const PHARMACY_REVIEWER_DISPLAY = 'HHH eligibility team';
export const LEGACY_PHARMACY_DECISION_REASON = 'HHH could not progress this eligibility submission following review.';

export function isNegativeEligibilityStatus(status: string): status is 'Declined' | 'Rejected' {
  return status === 'Declined' || status === 'Rejected';
}

export function pharmacyDecisionReason(submission: { status: string; pharmacyDecisionReason?: string | null }) {
  if (!isNegativeEligibilityStatus(submission.status)) return null;
  return submission.pharmacyDecisionReason?.trim() || LEGACY_PHARMACY_DECISION_REASON;
}
