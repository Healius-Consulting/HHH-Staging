import assert from 'node:assert/strict';
import test from 'node:test';
import type { Request } from 'express';
import { tenantFor } from './auth.js';
import { HttpError } from './http.js';

function requestFor(role: 'pharmacy_staff' | 'hhh_admin', pharmacyId: string | null) {
  return {
    identity: {
      uid: `${role}-uid`,
      email: `${role}@example.test`,
      role,
      pharmacyId,
      organisationId: pharmacyId,
      token: {},
    },
  } as unknown as Request;
}

test('pharmacy staff remain fixed to their authenticated tenant', () => {
  const request = requestFor('pharmacy_staff', 'pharmacy-a');
  assert.equal(tenantFor(request), 'pharmacy-a');
  assert.equal(tenantFor(request, 'pharmacy-a'), 'pharmacy-a');
  assert.throws(
    () => tenantFor(request, 'pharmacy-b'),
    (error: unknown) => error instanceof HttpError && error.status === 403 && error.code === 'TENANT_MISMATCH',
  );
});

test('HHH admins may select an explicit authorised organisation scope', () => {
  const request = requestFor('hhh_admin', null);
  assert.equal(tenantFor(request, 'pharmacy-b'), 'pharmacy-b');
  assert.throws(
    () => tenantFor(request),
    (error: unknown) => error instanceof HttpError && error.status === 400 && error.code === 'TENANT_REQUIRED',
  );
});
