import type { OrganisationRecord } from '../../repositories/ports/organisation.port.js';

export type PharmacyWorkspaceMode = 'training' | 'live' | 'paused';

function isTrainingGphc(organisation: Pick<OrganisationRecord, 'gphcNumber'>): boolean {
  return /^TRAINING-[A-Z0-9_-]+$/i.test(organisation.gphcNumber ?? '');
}

/** Public eligibility token and HHH intake queue — independent of pharmacy operational access. */
export function canAcceptPublicIntake(organisation: OrganisationRecord | null | undefined): boolean {
  if (!organisation || organisation.archivedAt) return false;
  if (organisation.classification === 'TRAINING') return false;
  if (!organisation.intakeEnabled) return false;
  if (organisation.status === 'PAUSED') return false;
  if (isTrainingGphc(organisation)) return organisation.status === 'LIVE';
  return organisation.status === 'ONBOARDING' || organisation.status === 'INTAKE_LIVE' || organisation.status === 'LIVE';
}

/** HHH may attribute and review enquiries for any pharmacy whose public token is live. */
export function canReceiveReferral(organisation: OrganisationRecord | null | undefined): boolean {
  return canAcceptPublicIntake(organisation);
}

/** Pharmacy CRM, orders, and production writes. Training stays false until LIVE. Paused keeps existing records. */
export function pharmacyOperationalAccess(organisation: OrganisationRecord | null | undefined): boolean {
  return Boolean(
    organisation
    && !organisation.archivedAt
    && organisation.classification !== 'TRAINING'
    && (organisation.status === 'LIVE' || organisation.status === 'PAUSED'),
  );
}

/** New referred patient records — live pharmacies only. Paused workspaces keep CRM but do not accept new activations. */
export function canActivateReferredPatient(organisation: OrganisationRecord | null | undefined): boolean {
  return Boolean(
    organisation
    && !organisation.archivedAt
    && organisation.classification !== 'TRAINING'
    && organisation.status === 'LIVE',
  );
}

export function pharmacyWorkspaceMode(organisation: OrganisationRecord | null | undefined): PharmacyWorkspaceMode {
  if (!organisation || organisation.archivedAt || organisation.status === 'PAUSED') return 'paused';
  if (organisation.classification === 'ALLOCATION_HOLDING') return 'live';
  if (organisation.classification === 'TRAINING') return 'training';
  if (organisation.status === 'LIVE') return 'live';
  return 'training';
}
