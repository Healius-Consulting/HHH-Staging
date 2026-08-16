import { dataConnect } from '../bootstrap/firebase.js';

const GET_STAFF_USER_BY_UID_1 = `
  query GetStaffUserByUid($uid: String!) {
    staffUser(uid: $uid) {
      uid
      email
      displayName
      role
      status
      disabled
    }
  }
`;

const GET_STAFF_USER_BY_UID_KEY = `
  query GetStaffUserByUidKey($uid: String!) {
    staffUser(key: { uid: $uid }) {
      uid
      email
      displayName
      role
      status
      disabled
    }
  }
`;

async function testQuery() {
  const adminUid = '0kDU33LMi5VSCF8GKegfH8b9E1z1';

  console.log('Testing staffUser(uid: $uid)...');
  try {
    const res1 = await dataConnect.executeGraphql<any, any>(GET_STAFF_USER_BY_UID_1, {
      variables: { uid: adminUid },
    });
    console.log('Result (uid: $uid):', JSON.stringify(res1, null, 2));
  } catch (e: any) {
    console.error('Error (uid: $uid):', e?.message);
  }

  console.log('\nTesting staffUser(key: { uid: $uid })...');
  try {
    const resKey = await dataConnect.executeGraphql<any, any>(GET_STAFF_USER_BY_UID_KEY, {
      variables: { uid: adminUid },
    });
    console.log('Result (key: { uid: $uid }):', JSON.stringify(resKey, null, 2));
  } catch (e: any) {
    console.error('Error (key: { uid: $uid }):', e?.message);
  }
}

void testQuery();
