import { SqlIdentityRepository } from '../repositories/sql/identity.sql.js';

async function testSession() {
  const repo = new SqlIdentityRepository();
  const adminUid = '0kDU33LMi5VSCF8GKegfH8b9E1z1';

  console.log('1. Testing findStaffUser...');
  try {
    const staff = await repo.findStaffUser(adminUid);
    console.log('findStaffUser result:', staff);
  } catch (e: any) {
    console.error('findStaffUser error:', e);
  }

  console.log('\n2. Testing createSession...');
  const testHash = 'test-session-hash-' + Date.now();
  const now = new Date().toISOString();
  try {
    await repo.createSession({
      sessionHash: testHash,
      staffUid: adminUid,
      organisationId: null,
      surface: 'admin',
      role: 'HHH_ADMIN',
      userAgentHash: 'ua-hash',
      lastActivityAt: now,
      idleExpiresAt: now,
      absoluteExpiresAt: now,
    });
    console.log('createSession succeeded!');
  } catch (e: any) {
    console.error('createSession error:', e);
  }

  console.log('\n3. Testing appendAudit...');
  try {
    await repo.appendAudit({
      organisationId: null,
      actorUid: adminUid,
      actorRole: 'HHH_ADMIN',
      event: 'auth.session_created',
      surface: 'admin',
      sessionHashPrefix: testHash.slice(0, 12),
    });
    console.log('appendAudit succeeded!');
  } catch (e: any) {
    console.error('appendAudit error:', e);
  }
}

void testSession();
