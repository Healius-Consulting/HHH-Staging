import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { firstPartyPasswordResetLink } from './password-reset-link.js';

describe('first-party password reset link', () => {
  it('rewrites Firebase action links onto the portal reset path', () => {
    const firebaseLink = 'https://example.firebaseapp.com/__/auth/action?mode=resetPassword&oobCode=abc123&apiKey=key-1&lang=en';
    const rewritten = firstPartyPasswordResetLink(firebaseLink, 'https://portal.holistichealthhub.cc');
    const url = new URL(rewritten);
    assert.equal(url.origin, 'https://portal.holistichealthhub.cc');
    assert.equal(url.pathname, '/reset-password');
    assert.equal(url.searchParams.get('oobCode'), 'abc123');
    assert.equal(url.searchParams.get('apiKey'), 'key-1');
    assert.equal(url.searchParams.get('lang'), 'en');
  });
});
