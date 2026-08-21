export const MAX_PRESCRIPTION_UPLOAD_BYTES = 16_000_000;
export const PRESCRIPTION_SIGNATURE_PREFIX_BYTES = 1024;

export const ALLOWED_PRESCRIPTION_CONTENT_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
] as const;

export type AllowedPrescriptionContentType = typeof ALLOWED_PRESCRIPTION_CONTENT_TYPES[number];

export function normalisedContentType(value: string | null | undefined): string {
  return (value ?? '').split(';')[0]!.trim().toLowerCase();
}

export function isAllowedPrescriptionContentType(value: string | null | undefined): value is AllowedPrescriptionContentType {
  return (ALLOWED_PRESCRIPTION_CONTENT_TYPES as readonly string[]).includes(normalisedContentType(value));
}

export function uploadedObjectMatchesDeclaration(
  object: { exists: boolean; sizeBytes: number; contentType: string | null },
  declared: { sizeBytes: number; contentType: string },
): { ok: true } | { ok: false; code: string; message: string } {
  if (!object.exists) {
    return { ok: false, code: 'UPLOAD_MISSING', message: 'The prescription file was not found in storage.' };
  }

  const actualType = normalisedContentType(object.contentType);
  const declaredType = normalisedContentType(declared.contentType);
  if (!isAllowedPrescriptionContentType(declaredType) || actualType !== declaredType) {
    return { ok: false, code: 'UPLOAD_TYPE_MISMATCH', message: 'The uploaded file type does not match the declared type.' };
  }

  if (!Number.isFinite(object.sizeBytes) || object.sizeBytes < 1) {
    return { ok: false, code: 'UPLOAD_SIZE_MISMATCH', message: 'The uploaded file size is not permitted.' };
  }

  if (object.sizeBytes > declared.sizeBytes || declared.sizeBytes > MAX_PRESCRIPTION_UPLOAD_BYTES) {
    return { ok: false, code: 'UPLOAD_SIZE_MISMATCH', message: 'The uploaded file size is not permitted.' };
  }

  return { ok: true };
}

export function matchesDeclaredFileSignature(bytes: Uint8Array, contentType: string): boolean {
  const type = normalisedContentType(contentType);
  if (type === 'application/pdf') return hasPdfHeader(bytes);
  if (type === 'image/jpeg') {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (type === 'image/png') {
    return bytes.length >= 8
      && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
      && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
  }
  return false;
}

function hasPdfHeader(bytes: Uint8Array): boolean {
  const end = Math.min(bytes.length, PRESCRIPTION_SIGNATURE_PREFIX_BYTES);
  for (let index = 0; index <= end - 4; index += 1) {
    if (bytes[index] === 0x25 && bytes[index + 1] === 0x50 && bytes[index + 2] === 0x44 && bytes[index + 3] === 0x46) {
      return true;
    }
  }
  return false;
}
