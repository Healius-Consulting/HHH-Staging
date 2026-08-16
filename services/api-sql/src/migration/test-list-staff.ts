import { dataConnect } from '../bootstrap/firebase.js';

const LIST_ALL_STAFF_GQL = `
  query ListAllStaffUsers {
    staffUsers {
      uid
      email
      displayName
      role
      status
      disabled
      organisationId
    }
  }
`;

async function listStaff() {
  const result = await dataConnect.executeGraphql<any, any>(LIST_ALL_STAFF_GQL);
  console.log('PostgreSQL Staff Users:', JSON.stringify(result.data?.staffUsers, null, 2));
}

void listStaff();
