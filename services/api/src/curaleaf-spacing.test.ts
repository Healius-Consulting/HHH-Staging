import assert from 'node:assert/strict';
import test from 'node:test';
import { TENANT_REQUEST_SPACING_MS } from './curaleaf.js';

test('Curaleaf tenant request spacing matches soft 1 req/s guidance', () => {
  assert.equal(TENANT_REQUEST_SPACING_MS, 1000);
});
