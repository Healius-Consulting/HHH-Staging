import { uuidKey } from '../common/uuid.js';

const HIDDEN_PUBLIC_PHARMACY_IDS = new Set([
  uuidKey('70913a30-71c3-4a41-952e-d532927af58c'), // Primary Branch / Primary Pharmacy
  uuidKey('f486a221-2236-44a5-b072-f06de399ab0e'), // Alternate Branch / Alternate Pharmacy
]);

const HIDDEN_PUBLIC_PHARMACY_NAMES = /^(primary|alternate)\s+(pharmacy|branch)$/i;

export const HOLISTIC_HEALTH_HUB_ALLOCATION_LABEL = 'Holistic Health Hub Allocation';

export type PublicListingOrganisation = {
  id: string;
  name: string;
  tradingName: string;
  classification: 'STANDARD' | 'TRAINING' | 'ALLOCATION_HOLDING';
  status: 'ONBOARDING' | 'INTAKE_LIVE' | 'LIVE' | 'PAUSED';
  archivedAt?: string | null;
};

function normalisedName(value: string | null | undefined) {
  return String(value || '').trim();
}

export function isHiddenPublicPharmacy(organisation: PublicListingOrganisation): boolean {
  if (organisation.classification === 'ALLOCATION_HOLDING') return true;
  if (HIDDEN_PUBLIC_PHARMACY_IDS.has(uuidKey(organisation.id))) return true;
  return [organisation.name, organisation.tradingName]
    .map(normalisedName)
    .some(name => HIDDEN_PUBLIC_PHARMACY_NAMES.test(name));
}

export function isPubliclyListedPharmacy(organisation: PublicListingOrganisation): boolean {
  if (organisation.archivedAt) return false;
  if (organisation.status === 'PAUSED') return false;
  if (!['ONBOARDING', 'INTAKE_LIVE', 'LIVE'].includes(organisation.status)) return false;
  if (organisation.classification !== 'STANDARD') return false;
  return !isHiddenPublicPharmacy(organisation);
}
