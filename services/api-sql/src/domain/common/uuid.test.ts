import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { asUuid, sameUuid, uuidKey } from './uuid.js';

describe('uuid helpers', () => {
  it('normalises compact UUIDs for GraphQL UUID fields', () => {
    assert.equal(asUuid('aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa'), 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    assert.equal(asUuid('AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA'), 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  });

  it('treats dashed and compact organisation IDs as the same destination', () => {
    assert.equal(uuidKey('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 'aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa');
    assert.equal(sameUuid('aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), true);
    assert.equal(sameUuid('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), false);
    assert.equal(sameUuid(null, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), false);
  });
});
