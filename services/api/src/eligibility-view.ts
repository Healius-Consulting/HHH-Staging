import { z } from 'zod';

export const PHARMACY_REVIEWER_DISPLAY = 'HHH eligibility team';
export const LEGACY_PHARMACY_DECISION_REASON = 'HHH could not progress this eligibility submission following review.';
export const pharmacyDecisionReasonSchema = z.string().trim().min(3).max(500);

export type EligibilityDisplayStatus = 'New' | 'Under HHH review' | 'Approved' | 'Declined' | 'Rejected';

type EligibilityRecord = Record<string, unknown>;

function nullableString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function eligibilityDisplayStatus(value: unknown): EligibilityDisplayStatus {
  const normalised = String(value ?? '').trim().toLowerCase();
  if (normalised === 'reviewing' || normalised === 'under hhh review') return 'Under HHH review';
  if (normalised === 'approved') return 'Approved';
  if (normalised === 'declined') return 'Declined';
  if (normalised === 'rejected') return 'Rejected';
  return 'New';
}

export function negativeEligibilityStatus(value: unknown) {
  const status = eligibilityDisplayStatus(value);
  return status === 'Declined' || status === 'Rejected';
}

export function pharmacyReasonAuditDetails(organisationId: string, recordId: string, pharmacyDecisionReason: string | null) {
  return { organisationId, recordId, redacted: pharmacyDecisionReason === null };
}

function workflowProjection(value: unknown, admin: boolean, fallbackStatus: 'pending' | 'completed' | 'declined') {
  const workflow = value && typeof value === 'object' ? value as EligibilityRecord : {};
  return {
    status: typeof workflow.status === 'string' ? workflow.status : fallbackStatus,
    ...(admin ? { notes: nullableString(workflow.notes) } : {}),
    completedAt: nullableString(workflow.completedAt),
    ...(admin ? { completedBy: nullableString(workflow.completedBy) } : {}),
  };
}

/**
 * Returns the review fields safe for the current portal role. Pharmacy clients
 * never receive internal notes or actor identifiers.
 */
export function eligibilityReviewProjection(record: EligibilityRecord, role: 'hhh_admin' | 'pharmacy_staff') {
  const admin = role === 'hhh_admin';
  const status = eligibilityDisplayStatus(record.status);
  const negative = status === 'Declined' || status === 'Rejected';
  const storedReason = nullableString(record.pharmacyDecisionReason);
  const reviewedAt = nullableString(record.reviewedAt);
  const referralFallback = status === 'Approved' ? 'completed' : negative ? 'declined' : 'pending';

  return {
    status,
    reviewedAt,
    reviewerDisplay: reviewedAt || negative || status === 'Approved' ? PHARMACY_REVIEWER_DISPLAY : null,
    pharmacyDecisionReason: negative ? storedReason ?? LEGACY_PHARMACY_DECISION_REASON : null,
    pharmacyDecisionReasonNeedsReview: negative && !storedReason,
    ...(admin ? {
      reviewedBy: nullableString(record.reviewedBy),
      decisionNote: nullableString(record.decisionNote),
    } : {}),
    recordsCheck: workflowProjection(record.recordsCheck, admin, 'pending'),
    referral: workflowProjection(record.referral, admin, referralFallback),
  };
}
