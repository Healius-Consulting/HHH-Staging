import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cookieOptions } from './csrf.js';
import { SESSION_ABSOLUTE_MS, SESSION_IDLE_MS } from './session-utils.js';

describe('staff session limits', () => {
  it('keeps the idle limit at 15 minutes and the absolute limit at 8 hours', () => {
    assert.equal(SESSION_IDLE_MS, 15 * 60 * 1000);
    assert.equal(SESSION_ABSOLUTE_MS, 8 * 60 * 60 * 1000);
    assert.equal(cookieOptions(true).maxAge, SESSION_ABSOLUTE_MS);
  });
});
