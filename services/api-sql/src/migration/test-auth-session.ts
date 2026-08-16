import { SessionService } from '../application/identity/session.service.js';
import { SqlIdentityRepository } from '../repositories/sql/identity.sql.js';
import { validatePortalAdmission } from '../security/admission.js';

async function testAuth() {
  const repo = new SqlIdentityRepository();
  const sessionService = new SessionService(repo);
  const adminUid = '0kDU33LMi5VSCF8GKegfH8b9E1z1';

  console.log('Testing admission validation for HHH Admin...');
  const staff = await repo.findStaffUser(adminUid);
  console.log('Found staff in SQL:', staff);

  const testHash = 'test-hash-' + Date.now();
  await repo.createSession({
    sessionHash: testHash,
    staffUid: adminUid,
    organisationId: null,
    surface: 'admin',
    role: 'HHH_ADMIN',
    userAgentHash: 'ua-hash',
    lastActivityAt: new Date().toISOString(),
    idleExpiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    absoluteExpiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
  });

  const admission = await repo.findAdmission(testHash, adminUid);
  console.log('Found admission:', admission);

  const failure = validatePortalAdmission({
    claims: { uid: adminUid, role: 'hhh_admin', email_verified: true } as any,
    admission,
    sessionHash: testHash,
    surface: 'any',
  });

  console.log('Validation failure (null means PASS):', failure);
}

void testAuth();
