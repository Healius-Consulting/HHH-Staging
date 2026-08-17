import type { StaffUserRecord } from '../../repositories/ports/identity.port.js';

export interface PortalPharmacyStaffAccount {
  uid: string;
  email: string;
  displayName: string;
  role: 'pharmacy_staff';
  pharmacyId: string;
  organisationId: string;
  contactRole: 'owner' | 'staff';
  status: 'invited' | 'active' | 'disabled';
  createdAt: string;
}

export interface PortalPlatformAdminAccount {
  uid: string;
  email: string;
  displayName: string;
  role: 'hhh_admin';
  status: 'invited' | 'active' | 'disabled';
  createdAt: string;
}

function lowerStaffStatus(status: StaffUserRecord['status']): PortalPharmacyStaffAccount['status'] {
  if (status === 'ACTIVE') return 'active';
  if (status === 'DISABLED') return 'disabled';
  return 'invited';
}

export function resolveOwnerUid(staff: StaffUserRecord[]) {
  const sorted = [...staff].sort((left, right) => String(left.createdAt ?? '').localeCompare(String(right.createdAt ?? '')));
  return sorted[0]?.uid ?? null;
}

export function toPortalPharmacyStaffAccounts(
  organisationId: string,
  staff: StaffUserRecord[],
): PortalPharmacyStaffAccount[] {
  const ownerUid = resolveOwnerUid(staff);
  return staff.map(record => ({
    uid: record.uid,
    email: record.email,
    displayName: record.displayName,
    role: 'pharmacy_staff',
    pharmacyId: organisationId,
    organisationId,
    contactRole: record.uid === ownerUid ? 'owner' : 'staff',
    status: lowerStaffStatus(record.status),
    createdAt: record.createdAt ?? new Date(0).toISOString(),
  }));
}

export function toPortalPlatformAdminAccounts(staff: StaffUserRecord[]): PortalPlatformAdminAccount[] {
  return staff.map(record => ({
    uid: record.uid,
    email: record.email,
    displayName: record.displayName,
    role: 'hhh_admin',
    status: lowerStaffStatus(record.status),
    createdAt: record.createdAt ?? new Date(0).toISOString(),
  }));
}
