const PENDING_UPLOAD_MAX_AGE_MS = 24 * 60 * 60 * 1_000;
const UPLOADED_UNLINKED_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1_000;

export function isAbandonedPrescriptionFile(
  file: { status: string; createdAt: string; deletedAt?: string | null },
  asOf = new Date(),
) {
  if (file.deletedAt || file.status === 'DELETED') return false;
  const createdAt = Date.parse(file.createdAt);
  if (!Number.isFinite(createdAt)) return false;
  const ageMs = asOf.getTime() - createdAt;
  if (file.status === 'PENDING_UPLOAD') return ageMs >= PENDING_UPLOAD_MAX_AGE_MS;
  if (file.status === 'UPLOADED') return ageMs >= UPLOADED_UNLINKED_MAX_AGE_MS;
  return false;
}
