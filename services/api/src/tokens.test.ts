import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { protectedLegacyTokenPolicy, referralTokenSchema, secureOpaqueTokenSchema } from './tokens.js';

describe('referral token compatibility', () => {
  it('accepts the legacy pharmacy QR aliases', () => {
    assert.equal(referralTokenSchema.parse('kchem-7x4p9k'), 'kchem-7x4p9k');
    assert.equal(referralTokenSchema.parse('eastwood-3m8q2v'), 'eastwood-3m8q2v');
  });

  it('continues to reject undersized or malformed referral tokens', () => {
    assert.equal(referralTokenSchema.safeParse('too-short').success, false);
    assert.equal(referralTokenSchema.safeParse('eastwood token!').success, false);
  });

  it('does not relax unrelated secure token validation', () => {
    assert.equal(secureOpaqueTokenSchema.safeParse('kchem-7x4p9k').success, false);
    assert.equal(secureOpaqueTokenSchema.safeParse('1234567890abcdef').success, true);
  });

  it('moves every protected link to HHH-first v2 while preserving its fixed source', () => {
    const registry = JSON.parse(readFileSync(new URL('../../../config/protected-legacy-referral-tokens.json', import.meta.url), 'utf8')) as {
      tokens: Array<{ tokenHash: string; organisationId: string; migrationMode: 'v2_fixed_source' }>;
    };
    for (const entry of registry.tokens) {
      assert.deepEqual(protectedLegacyTokenPolicy(entry.tokenHash), {
        organisationId: entry.organisationId,
        migrationMode: entry.migrationMode,
      });
    }
    assert.equal(registry.tokens.filter(entry => entry.migrationMode === 'v2_fixed_source').length, 6);
  });
});
