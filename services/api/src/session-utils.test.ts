import assert from 'node:assert/strict';
import test from 'node:test';
import type { Request } from 'express';
import { constantTimeEqual, parseCookies, safeReturnTo, surfaceForRequest, surfaceFromPortalApiPath } from './session-utils.js';
import { cookieOptions } from './session-auth.js';

test('safeReturnTo accepts only same-origin relative paths', () => {
  assert.equal(safeReturnTo('/orders?status=open#top'), '/orders?status=open#top');
  for (const value of ['https://attacker.example', '//attacker.example', '/\\attacker', '/%5cattacker', '/%2f%2fattacker.example', '/ok\nSet-Cookie:x', '/ok%0d%0aSet-Cookie:x']) {
    assert.equal(safeReturnTo(value), '/');
  }
});

test('staff cookie options enforce strict host-scoped session semantics', () => {
  const options = cookieOptions(true);
  assert.equal(options.httpOnly, true);
  assert.equal(options.sameSite, 'strict');
  assert.equal(options.path, '/');
  assert.equal(options.maxAge, 8 * 60 * 60 * 1000);
});

test('cookie parsing fails closed on malformed values', () => {
  assert.deepEqual(parseCookies({ headers: { cookie: 'one=1; token=a%20b; broken=%E0%A4%A' } }), { one: '1', token: 'a b' });
  assert.equal(constantTimeEqual('same', 'same'), true);
  assert.equal(constantTimeEqual('same', 'other'), false);
});

test('surface derives from configured host and ignores production override headers', () => {
  const request = {
    get: (name: string) => name === 'host' ? 'admin.example.test' : name === 'x-hhh-surface' ? 'pharmacy' : undefined,
    hostname: 'admin.example.test',
  } as unknown as Pick<Request, 'get' | 'hostname'>;
  assert.equal(surfaceForRequest(request, { pharmacy: 'https://pharmacy.example.test', admin: 'https://admin.example.test' }), 'admin');
});

test('combined portal API namespaces select exactly one protected surface', () => {
  assert.equal(surfaceFromPortalApiPath('/pharmacy/v1/portal/orders'), 'pharmacy');
  assert.equal(surfaceFromPortalApiPath('/admin/v1/portal/admin/organisations'), 'admin');
  assert.equal(surfaceFromPortalApiPath('/pharmacy/v2/portal/eligibility-submissions'), 'pharmacy');
  assert.equal(surfaceFromPortalApiPath('/admin/v2/portal/admin/intake/general'), 'admin');
  assert.equal(surfaceFromPortalApiPath('/pharamcy/v1/portal/orders'), null);
  assert.equal(surfaceFromPortalApiPath('/v1/portal/orders'), null);
});
