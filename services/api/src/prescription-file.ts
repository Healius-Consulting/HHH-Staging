import { storage } from './firebase.js';
import { HttpError } from './http.js';
import { getTenantRecord } from './repository.js';

const MAX_PRESCRIPTION_FILE_BYTES = 16_000_000;

export async function loadUploadedPrescriptionFile(organisationId: string, fileId: string) {
  const record = await getTenantRecord('prescriptionFiles', fileId, organisationId);
  if (record.status !== 'uploaded') throw new HttpError(409, 'Complete and verify the prescription file upload first.', 'UPLOAD_INCOMPLETE');
  const object = storage.bucket().file(record.storagePath as string);
  const [exists] = await object.exists();
  if (!exists) throw new HttpError(409, 'Complete the prescription file upload first.', 'UPLOAD_INCOMPLETE');
  const [metadata] = await object.getMetadata();
  if (!metadata.size || Number(metadata.size) > MAX_PRESCRIPTION_FILE_BYTES) throw new HttpError(400, 'Prescription files must be 16 MB or smaller.', 'FILE_TOO_LARGE');
  const [bytes] = await object.download();
  return { bytes, contentType: record.contentType as string, filename: record.filename as string };
}
