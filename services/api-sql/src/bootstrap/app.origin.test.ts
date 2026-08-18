import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isOriginPermitted } from './app.js';

describe('isOriginPermitted', () => {
  it('allows the live public and portal origins', () => {
    assert.equal(isOriginPermitted('https://holistichealthhub.cc'), true);
    assert.equal(isOriginPermitted('https://portal.holistichealthhub.cc'), true);
  });

  it('allows the printed pharmacy QR host and Hobby public staging', () => {
    assert.equal(isOriginPermitted('https://hhh.thinktimeless.co.uk'), true);
    assert.equal(isOriginPermitted('https://staging.thinktimeless.co.uk'), true);
  });

  it('rejects unrelated thinktimeless hosts and unknown origins', () => {
    assert.equal(isOriginPermitted('https://ha.thinktimeless.co.uk'), false);
    assert.equal(isOriginPermitted('https://thinktimeless.co.uk'), false);
    assert.equal(isOriginPermitted('https://evil.example'), false);
  });
});
