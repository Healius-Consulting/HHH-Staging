import type { OrganisationRecord } from '../../repositories/ports/organisation.port.js';

export function canReceiveReferral(organisation: OrganisationRecord | null | undefined): boolean {
  return Boolean(
    organisation
    && !organisation.archivedAt
    && organisation.classification !== 'TRAINING'
    && ['INTAKE_LIVE', 'LIVE'].includes(organisation.status),
  );
}

export function pharmacyOperationalAccess(organisation: OrganisationRecord | null | undefined): boolean {
  return Boolean(
    organisation
    && !organisation.archivedAt
    && organisation.classification !== 'TRAINING'
    && organisation.status === 'LIVE',
  );
}
