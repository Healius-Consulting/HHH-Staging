import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { StaffUserRecord } from '../../repositories/ports/identity.port.js';
import { resolveOwnerUid, toPortalPharmacyStaffAccounts } from './admin-staff-contracts.js';

const organisationId = '70913a3071c34a41952ed532927af58c';

const owner: StaffUserRecord = {
  uid: 'owner-uid',
  organisationId,
  email: 'owner@example.test',
  displayName: 'Alex Owner',
  role: 'PHARMACY_STAFF',
  status: 'ACTIVE',
  disabled: false,
  createdAt: '2026-01-01T10:00:00.000Z',
  version: 1,
};

const staffMember: StaffUserRecord = {
  uid: 'staff-uid',
  organisationId,
  email: 'staff@example.test',
  displayName: 'Sam Staff',
  role: 'PHARMACY_STAFF',
  status: 'INVITED',
  disabled: false,
  createdAt: '2026-01-02T10:00:00.000Z',
  version: 1,
};

describe('admin staff contracts', () => {
  it('tags the earliest account as owner', () => {
    assert.equal(resolveOwnerUid([staffMember, owner]), owner.uid);
  });

  it('maps SQL staff records to the portal contract', () => {
    const mapped = toPortalPharmacyStaffAccounts(organisationId, [owner, staffMember]);
    assert.deepEqual(mapped, [
      {
        uid: owner.uid,
        email: owner.email,
        displayName: owner.displayName,
        role: 'pharmacy_staff',
        pharmacyId: organisationId,
        organisationId,
        contactRole: 'owner',
        status: 'active',
        createdAt: owner.createdAt,
      },
      {
        uid: staffMember.uid,
        email: staffMember.email,
        displayName: staffMember.displayName,
        role: 'pharmacy_staff',
        pharmacyId: organisationId,
        organisationId,
        contactRole: 'staff',
        status: 'invited',
        createdAt: staffMember.createdAt,
      },
    ]);
  });
});
