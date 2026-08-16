import { z } from 'zod';

const tokenCharacters = /^[A-Za-z0-9_-]+$/;

/**
 * Current referral tokens are long random values. Two pharmacy QR packs were
 * issued before that policy and contain 13- and 15-character tokens. Accept
 * those aliases so the printed material remains usable; lookup still uses a
 * SHA-256 hash and the public endpoint remains rate-limited.
 */
export const referralTokenSchema = z.string().min(12).max(160).regex(tokenCharacters);

/** Tokens that were never issued through the legacy pharmacy QR workflow. */
export const secureOpaqueTokenSchema = z.string().min(16).max(160).regex(tokenCharacters);

export type ProtectedLegacyTokenPolicy = {
  organisationId: string;
  migrationMode: 'v2_fixed_source';
};

/** Runtime mirror of the frozen registry. Raw tokens never appear here. */
const protectedLegacyTokenPolicies = new Map<string, ProtectedLegacyTokenPolicy>([
  ['4bbc90128434dc615429c7157742aee1670e11aef0f43e2363efb45ee11fe4c2', { organisationId: 'f486a221-2236-44a5-b072-f06de399ab0e', migrationMode: 'v2_fixed_source' }],
  ['1ae3847fe37bf19d7a6bda29ee2b599c781c2d76c2697a58a82fb8be1d27e13d', { organisationId: '6d0176bb-89a0-4e32-9bce-c934c9557c42', migrationMode: 'v2_fixed_source' }],
  ['bf090d34c7d94b07e2c27b4a2a84240a48b93ae66f179506a34535ca56837252', { organisationId: '3e9f74ff-4fed-497d-904d-4d3ee3e5e126', migrationMode: 'v2_fixed_source' }],
  ['2866e80d8a85d6d0f8998b619473ede0d8fc719f1eaeba70c06929604d417009', { organisationId: '70913a30-71c3-4a41-952e-d532927af58c', migrationMode: 'v2_fixed_source' }],
  ['70f966e53ad1fab18d70dfd04ad0d702653de099446187c9c173443087e27984', { organisationId: '6d0176bb-89a0-4e32-9bce-c934c9557c42', migrationMode: 'v2_fixed_source' }],
  ['7b1ce5e49fae2dac13db1b326e1fbb9db44a0cd7efcb7ad8113e42aecf4b3ced', { organisationId: '3e9f74ff-4fed-497d-904d-4d3ee3e5e126', migrationMode: 'v2_fixed_source' }],
]);

export function protectedLegacyTokenPolicy(tokenHash: string) {
  return protectedLegacyTokenPolicies.get(tokenHash) ?? null;
}
