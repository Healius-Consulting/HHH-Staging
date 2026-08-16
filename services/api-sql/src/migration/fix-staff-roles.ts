import { dataConnect } from '../bootstrap/firebase.js';

const UPDATE_STAFF_ROLE_GQL = `
  mutation UpdateStaffUserRole(
    $uid: String!
    $role: StaffRole!
    $organisationId: UUID
  ) {
    staffUser_update(
      key: { uid: $uid }
      data: {
        role: $role
        organisationId: $organisationId
      }
    )
  }
`;

async function fixStaffRoles() {
  console.log('Fixing staff user roles in PostgreSQL...\n');

  // Set mihir.patel@thinktimeless.co.uk to HHH_ADMIN with null organisationId
  const adminUid = '0kDU33LMi5VSCF8GKegfH8b9E1z1';
  await dataConnect.executeGraphql<any, any>(UPDATE_STAFF_ROLE_GQL, {
    variables: {
      uid: adminUid,
      role: 'HHH_ADMIN',
      organisationId: null,
    },
  });
  console.log(`✔ Updated StaffUser ${adminUid} (mihir.patel@thinktimeless.co.uk) -> Role: HHH_ADMIN, Organisation: null`);

  console.log('\nStaff user roles successfully updated in PostgreSQL!');
}

void fixStaffRoles();
