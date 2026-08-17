import assert from 'node:assert/strict';
import test from 'node:test';
import { CONTENT_SECURITY_POLICY } from '../platform/vercel/security-headers.ts';
import {
  REQUIRED_FIREBASE_CLIENT_VARIABLES,
  assertSurfaceBuildEnvironment,
  invalidSurfaceBuildVariables,
  missingSurfaceBuildVariables,
} from '../platform/vercel/surface-build-environment.mjs';

const configuredEnvironment = Object.fromEntries(REQUIRED_FIREBASE_CLIENT_VARIABLES.map(name => [name, `${name}-value`]));

test('deployment builds require App Check whenever the API security boundary enables it', () => {
  assert.deepEqual(missingSurfaceBuildVariables('portal', configuredEnvironment), []);
  assert.deepEqual(
    missingSurfaceBuildVariables('portal', { ...configuredEnvironment, VITE_REQUIRE_APP_CHECK: 'true' }),
    ['VITE_FIREBASE_APP_CHECK_SITE_KEY'],
  );
  assert.throws(
    () => assertSurfaceBuildEnvironment('portal', { ...configuredEnvironment, VITE_REQUIRE_APP_CHECK: 'true' }),
    /VITE_FIREBASE_APP_CHECK_SITE_KEY/,
  );
});

test('only the public site and combined portal are deployable surfaces', () => {
  assert.deepEqual(missingSurfaceBuildVariables('admin', {}), []);
  assert.deepEqual(missingSurfaceBuildVariables('pharmacy', {}), []);
  assert.deepEqual(missingSurfaceBuildVariables('portal', {}), REQUIRED_FIREBASE_CLIENT_VARIABLES);
});

test('portal builds reject malformed eligibility form URLs before Settings can render', () => {
  assert.deepEqual(invalidSurfaceBuildVariables('portal', { VITE_ELIGIBILITY_FORM_URL: 'not-a-url' }), ['VITE_ELIGIBILITY_FORM_URL']);
  assert.deepEqual(invalidSurfaceBuildVariables('portal', { VITE_ELIGIBILITY_FORM_URL: 'http://example.test/eligibility' }), ['VITE_ELIGIBILITY_FORM_URL']);
  assert.deepEqual(invalidSurfaceBuildVariables('portal', { VITE_ELIGIBILITY_FORM_URL: 'https://holistichealthhub.live/eligibility' }), []);
  assert.throws(
    () => assertSurfaceBuildEnvironment('portal', { ...configuredEnvironment, VITE_ELIGIBILITY_FORM_URL: 'broken-url' }),
    /VITE_ELIGIBILITY_FORM_URL/,
  );
});

test('the protected CSP permits only the signed Storage origin needed for uploads', () => {
  const connectDirective = CONTENT_SECURITY_POLICY.split(';').map(value => value.trim()).find(value => value.startsWith('connect-src '));
  assert.ok(connectDirective?.includes('https://storage.googleapis.com'));
  assert.equal(connectDirective?.includes('https://*'), false);
});

test('the protected CSP permits the documented reCAPTCHA Enterprise browser endpoints', () => {
  const directives = CONTENT_SECURITY_POLICY.split(';').map(value => value.trim());
  assert.ok(directives.find(value => value.startsWith('script-src '))?.includes('https://www.gstatic.com/recaptcha/'));
  assert.ok(directives.find(value => value.startsWith('connect-src '))?.includes('https://www.google.com/recaptcha/'));
  assert.ok(directives.find(value => value.startsWith('frame-src '))?.includes('https://recaptcha.google.com/recaptcha/'));
});
