import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MAX_PRESCRIPTION_UPLOAD_BYTES, uploadedObjectMatchesDeclaration } from './upload-constraints.js';

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
