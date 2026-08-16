import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { HttpError } from '../../domain/common/errors.js';
import { StorageProvider } from '../../providers/storage/storage.provider.js';
import { SqlPrescriptionRepository } from '../../repositories/sql/prescription.sql.js';
import { requireCsrf } from '../../security/csrf.js';
import { assertTenantScope } from '../../security/request-context.js';
import { requireStaff } from '../../security/require-staff.js';

const uploadTargetSchema = z.object({
  filename: z.string().min(1).max(255),
  contentType: z.enum(['application/pdf', 'image/jpeg', 'image/png']),
  sizeBytes: z.number().int().positive().max(25 * 1024 * 1024), // max 25MB
  patientId: z.string().uuid().optional(),
});

export function createPortalPrescriptionRouter(): Router {
  const router = Router();
  const prescriptionRepo = new SqlPrescriptionRepository();
  const storageProvider = new StorageProvider();

  // POST /v1/portal/prescription-files/upload-target
  router.post('/portal/prescription-files/upload-target', requireCsrf, requireStaff('pharmacy'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = assertTenantScope(req.context!);
      const input = uploadTargetSchema.parse(req.body);
      const fileId = crypto.randomUUID();

      const target = await storageProvider.generateUploadTarget({
        organisationId: scope.organisationId,
        fileId,
        filename: input.filename,
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
      });

      await prescriptionRepo.createFile({
        id: fileId,
        organisationId: scope.organisationId,
        patientId: input.patientId,
        storagePath: target.storagePath,
        originalFilename: input.filename,
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
        uploadedByUid: scope.uid,
      });

      res.status(200).json(target);
    } catch (error) {
      next(error);
    }
  });

  // GET /v1/portal/prescription-files/:id/download-url
  router.get('/portal/prescription-files/:id/download-url', requireStaff('pharmacy'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = assertTenantScope(req.context!);
      const fileId = String(req.params.id || '');

      // Validate tenant ownership strictly in SQL
      const fileRecord = await prescriptionRepo.findFileById(fileId, scope.organisationId);
      if (!fileRecord) {
        throw new HttpError(404, 'Prescription file not found.', 'NOT_FOUND');
      }

      const downloadUrl = await storageProvider.generateDownloadUrl(fileRecord.storagePath, 300);
      res.status(200).json({ downloadUrl, expiresAt: new Date(Date.now() + 300 * 1000).toISOString() });
    } catch (error) {
      next(error);
    }
  });

  // GET /v1/portal/prescriptions - List tenant prescriptions
  router.get('/portal/prescriptions', requireStaff('pharmacy'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = assertTenantScope(req.context!);
      const prescriptions = await prescriptionRepo.listTenantPrescriptions(scope.organisationId);
      res.status(200).json(prescriptions);
    } catch (error) {
      next(error);
    }
  });

  // GET /v1/portal/prescribers - List active prescriber directory
  router.get('/portal/prescribers', requireStaff('pharmacy'), async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const prescribers = await prescriptionRepo.listActivePrescribers();
      res.status(200).json(prescribers);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
