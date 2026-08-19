export const MAX_PRESCRIPTION_UPLOAD_BYTES = 30 * 1024 * 1024;

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
