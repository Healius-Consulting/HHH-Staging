import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_PRESCRIPTION_FILE_BYTES,
  contentTypeFromDeclaredType,
  contentTypeFromFilename,
  contentTypeFromSignature,
  resolvePrescriptionContentType,
} from '../src/utils/prescriptionFile.ts';

test('caps prescription uploads at Curaleaf’s 16 MB limit', () => {
  assert.equal(MAX_PRESCRIPTION_FILE_BYTES, 16_000_000);
});

test('treats empty or aliased MIME types as PDF when the filename says so', () => {
  assert.equal(contentTypeFromDeclaredType(''), null);
  assert.equal(contentTypeFromDeclaredType('application/x-pdf'), 'application/pdf');
  assert.equal(contentTypeFromFilename('clinic-copy.PDF'), 'application/pdf');
});

test('recognises a PDF header after a UTF-8 BOM', () => {
  assert.equal(
    contentTypeFromSignature(Uint8Array.from([0xef, 0xbb, 0xbf, 0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37])),
    'application/pdf',
  );
});

test('uploads a PDF even when the browser leaves File.type empty', async () => {
  const file = new File([Buffer.from('%PDF-1.7\n% prescription')], 'signed-copy.pdf', { type: '' });
  assert.equal(await resolvePrescriptionContentType(file), 'application/pdf');
});

test('rejects a non-PDF that only looks like one by name', async () => {
  const file = new File([Buffer.from('not a prescription')], 'signed-copy.pdf', { type: 'application/pdf' });
  await assert.rejects(
    () => resolvePrescriptionContentType(file),
    /not a valid PDF, JPG or PNG prescription/,
  );
});
