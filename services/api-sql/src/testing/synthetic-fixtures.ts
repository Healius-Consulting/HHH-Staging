import { sha256 } from '../security/session-utils.js';
import type { StaffSessionRecord, StaffUserRecord } from '../repositories/ports/identity.port.js';

export const SYNTHETIC_PHARMACY_A_ID = '11111111-1111-4111-8111-111111111111';
export const SYNTHETIC_PHARMACY_B_ID = '22222222-2222-4222-8222-222222222222';

export const SYNTHETIC_STAFF_PHARMACY_A: StaffUserRecord = {
  uid: 'staff-pharmacy-a-uid',
  organisationId: SYNTHETIC_PHARMACY_A_ID,
  email: 'pharmacist-a@example.com',
  displayName: 'Pharmacist Alice',
  role: 'PHARMACY_STAFF',
  status: 'ACTIVE',
  disabled: false,
  version: 1,
};

export const SYNTHETIC_STAFF_DISABLED: StaffUserRecord = {
  uid: 'staff-disabled-uid',
  organisationId: SYNTHETIC_PHARMACY_A_ID,
  email: 'disabled@example.com',
  displayName: 'Disabled User',
  role: 'PHARMACY_STAFF',
  status: 'DISABLED',
  disabled: true,
  version: 1,
};

export const SYNTHETIC_STAFF_ADMIN: StaffUserRecord = {
  uid: 'staff-admin-uid',
  organisationId: null,
  email: 'admin@hhh.example.com',
  displayName: 'Admin User',
  role: 'HHH_ADMIN',
  status: 'ACTIVE',
  disabled: false,
  version: 1,
};

export function createSyntheticSession(
  cookieValue: string,
  staff: StaffUserRecord,
  overrides: Partial<StaffSessionRecord> = {}
): StaffSessionRecord {
  const now = Date.now();
  return {
    sessionHash: sha256(cookieValue),
    staffUid: staff.uid,
    organisationId: staff.organisationId,
    surface: staff.role === 'HHH_ADMIN' ? 'admin' : 'pharmacy',
    role: staff.role,
    userAgentHash: sha256('Test-User-Agent'),
    createdAt: new Date(now).toISOString(),
    lastActivityAt: new Date(now).toISOString(),
    idleExpiresAt: new Date(now + 15 * 60 * 1000).toISOString(),
    absoluteExpiresAt: new Date(now + 12 * 60 * 60 * 1000).toISOString(),
    revokedAt: null,
    revokeReason: null,
    ...overrides,
  };
}
