import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MAX_PRESCRIPTION_UPLOAD_BYTES, matchesDeclaredFileSignature, uploadedObjectMatchesDeclaration } from './upload-constraints.js';

describe('uploadedObjectMatchesDeclaration', () => {
  it('accepts a PDF within the declared size', () => {
    assert.deepEqual(uploadedObjectMatchesDeclaration(
      { exists: true, sizeBytes: 12_000, contentType: 'application/pdf' },
      { sizeBytes: 20_000, contentType: 'application/pdf' },
    ), { ok: true });
  });

  it('rejects a missing object, type mismatch, or oversized upload', () => {
    assert.equal(uploadedObjectMatchesDeclaration(
      { exists: false, sizeBytes: 0, contentType: null },
      { sizeBytes: 20_000, contentType: 'application/pdf' },
    ).ok, false);
    assert.equal(uploadedObjectMatchesDeclaration(
      { exists: true, sizeBytes: 12_000, contentType: 'image/gif' },
      { sizeBytes: 20_000, contentType: 'application/pdf' },
    ).ok, false);
    assert.equal(uploadedObjectMatchesDeclaration(
      { exists: true, sizeBytes: 21_000, contentType: 'application/pdf' },
      { sizeBytes: 20_000, contentType: 'application/pdf' },
    ).ok, false);
    assert.equal(uploadedObjectMatchesDeclaration(
      { exists: true, sizeBytes: 12_000, contentType: 'application/pdf' },
      { sizeBytes: MAX_PRESCRIPTION_UPLOAD_BYTES + 1, contentType: 'application/pdf' },
    ).ok, false);
  });
});

describe('matchesDeclaredFileSignature', () => {
  it('accepts PDF, JPEG, and PNG magic bytes', () => {
    assert.equal(matchesDeclaredFileSignature(Buffer.from('%PDF-1.7'), 'application/pdf'), true);
    assert.equal(matchesDeclaredFileSignature(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), 'image/jpeg'), true);
    assert.equal(matchesDeclaredFileSignature(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'image/png'), true);
  });

  it('rejects a declared PDF that is actually another type', () => {
    assert.equal(matchesDeclaredFileSignature(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), 'application/pdf'), false);
    assert.equal(matchesDeclaredFileSignature(Buffer.from('hello'), 'application/pdf'), false);
  });
});
