import assert from 'node:assert/strict';
import test from 'node:test';
import {
  allowedHosts,
  parseCookieHeader,
  safeReturnTo,
  shouldTouchSession,
  validateGateSession,
  type SessionClaims,
  type SessionRecord,
  type StaffRecord,
} from '../platform/vercel/page-gate-utils.ts';

const now = Date.parse('2026-08-14T10:00:00.000Z');
const sessionHash = 'a'.repeat(64);
const claims: SessionClaims = {
  uid: 'staff-1',
  role: 'pharmacy_staff',
  organisationId: 'pharmacy-1',
  email_verified: true,
  firebase: { sign_in_second_factor: 'totp' },
};
const record: SessionRecord = {
  sessionHash,
  uid: 'staff-1',
  surface: 'pharmacy',
  role: 'pharmacy_staff',
  organisationId: 'pharmacy-1',
  revokedAt: null,
  lastActivityAt: '2026-08-14T09:58:00.000Z',
  idleExpiresAt: '2026-08-14T10:13:00.000Z',
  absoluteExpiresAt: '2026-08-14T17:58:00.000Z',
};
const staff: StaffRecord = {
  role: 'pharmacy_staff',
  organisationId: 'pharmacy-1',
  status: 'active',
  disabled: false,
};

test('return targets accept only same-origin relative paths', () => {
  assert.equal(safeReturnTo('/orders?status=paid#queue'), '/orders?status=paid#queue');
  assert.equal(safeReturnTo('//evil.example/path'), '/');
  assert.equal(safeReturnTo('/%255c%255cevil.example/path'), '/');
  assert.equal(safeReturnTo('https://evil.example/path'), '/');
  assert.equal(safeReturnTo('/orders%250d%250aLocation:evil'), '/');
});

test('host allow-list is exact and includes only the current Vercel deployment hosts', () => {
  const hosts = allowedHosts({
    HHH_ALLOWED_HOSTS: 'pharmacy.example.test, pharmacy-staging.example.test',
    VERCEL_URL: 'deployment-123.vercel.app',
  });
  assert.equal(hosts.has('pharmacy.example.test'), true);
  assert.equal(hosts.has('deployment-123.vercel.app'), true);
  assert.equal(hosts.has('attacker.vercel.app'), false);
});

test('cookie parsing keeps host-only session values opaque', () => {
  assert.deepEqual(parseCookieHeader('__Host-hhh_session=abc%2E123; theme=dark'), {
    '__Host-hhh_session': 'abc.123',
    theme: 'dark',
  });
});

test('a valid pharmacy session passes the protected page gate', () => {
  assert.equal(validateGateSession({ claims, record, staff, sessionHash, surface: 'pharmacy', now }), null);
});

test('cross-surface and cross-tenant sessions are denied with 403', () => {
  assert.deepEqual(
    validateGateSession({ claims, record, staff, sessionHash, surface: 'admin', now }),
    { status: 403, event: 'auth.role_denied', code: 'SURFACE_FORBIDDEN' },
  );
  assert.deepEqual(
    validateGateSession({ claims, record: { ...record, organisationId: 'pharmacy-2' }, staff, sessionHash, surface: 'pharmacy', now }),
    { status: 403, event: 'auth.tenant_mismatch', code: 'SESSION_TENANT_MISMATCH' },
  );
});

test('missing TOTP, idle expiry, revocation, and disabled staff fail closed', () => {
  assert.equal(validateGateSession({ claims: { ...claims, firebase: {} }, record, staff, sessionHash, surface: 'pharmacy', now })?.code, 'MFA_TOTP_REQUIRED');
  assert.equal(validateGateSession({ claims, record: { ...record, idleExpiresAt: '2026-08-14T10:00:00.000Z' }, staff, sessionHash, surface: 'pharmacy', now })?.code, 'SESSION_IDLE_EXPIRED');
  assert.equal(validateGateSession({ claims, record: { ...record, revokedAt: '2026-08-14T09:59:00.000Z' }, staff, sessionHash, surface: 'pharmacy', now })?.code, 'SESSION_REVOKED');
  assert.equal(validateGateSession({ claims, record, staff: { ...staff, disabled: true }, sessionHash, surface: 'pharmacy', now })?.code, 'ACCOUNT_DISABLED');
});

test('only successful activity after one minute should touch the idle deadline', () => {
  assert.equal(shouldTouchSession('2026-08-14T09:59:01.000Z', now), false);
  assert.equal(shouldTouchSession('2026-08-14T09:59:00.000Z', now), true);
  assert.equal(shouldTouchSession('invalid', now), false);
});
