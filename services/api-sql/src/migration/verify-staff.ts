import { dataConnect } from '../bootstrap/firebase.js';

const LIST_ALL_STAFF_GQL = `
  query ListAllStaff {
    staffUsers(limit: 50) {
      uid
      email
      displayName
      role
      organisationId
      status
      disabled
    }
  }
`;

async function verifyAllStaff() {
  const result = await dataConnect.executeGraphql<{ staffUsers: any[] }, any>(LIST_ALL_STAFF_GQL);
  console.log('Current PostgreSQL StaffUser Table Contents:\n');
  for (const staff of result.data.staffUsers || []) {
    console.log(`- [${staff.role}] ${staff.email} (UID: ${staff.uid}, Org: ${staff.organisationId || 'HHH Platform Admin'}, Status: ${staff.status})`);
  }
}

void verifyAllStaff();
