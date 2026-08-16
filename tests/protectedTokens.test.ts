import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const registry = JSON.parse(readFileSync(new URL('../config/protected-legacy-referral-tokens.json', import.meta.url), 'utf8')) as {
  tokens: Array<{ tokenHash: string; organisationId: string; alias?: boolean }>;
};
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

test('the frozen token registry retains all four protected production tokens and both short aliases', () => {
  const expected = new Map([
    ['3509a44084ab461aa9aafe603047e9add4e6e7a51e214e40b830753202b7131d', 'f486a221-2236-44a5-b072-f06de399ab0e'],
    ['0a93ebde7ab143cfafd7c2a34329b3587148fb1ff9fb4e6fbf02f517fac05d30', '6d0176bb-89a0-4e32-9bce-c934c9557c42'],
    ['bbd8fc4749934797a49398c0b95e68cf873d4868c33c42a2949d6f65359d44c5', '3e9f74ff-4fed-497d-904d-4d3ee3e5e126'],
    ['68e83b76e7824084997d97b5d2159e1840aefdb4d26f4d5c81b0aed86844f83a', '70913a30-71c3-4a41-952e-d532927af58c'],
    ['eastwood-3m8q2v', '6d0176bb-89a0-4e32-9bce-c934c9557c42'],
    ['kchem-7x4p9k', '3e9f74ff-4fed-497d-904d-4d3ee3e5e126'],
  ]);
  assert.equal(registry.tokens.length, expected.size);
  for (const [token, organisationId] of expected) {
    assert.ok(registry.tokens.some(item => item.tokenHash === hash(token) && item.organisationId === organisationId));
  }
});
