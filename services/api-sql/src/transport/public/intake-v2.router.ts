import { Router, type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { ELIGIBILITY_CONDITION_IDS } from '../../domain/eligibility/conditions.js';
import { HttpError } from '../../domain/common/errors.js';
import { SqlIdentityRepository } from '../../repositories/sql/identity.sql.js';
import { SqlIntakeRepository } from '../../repositories/sql/intake.sql.js';
import { SqlOrganisationRepository } from '../../repositories/sql/organisation.sql.js';
import { sha256 } from '../../security/session-utils.js';

export const referralTokenSchema = z.string().min(12).max(160).regex(/^[A-Za-z0-9_-]+$/);
const conditionIdSchema = z.enum(ELIGIBILITY_CONDITION_IDS);

const resolveTokenSchema = z.object({
  token: referralTokenSchema,
}).strict();

export const fixedPharmacyIntakeSchema = z.object({
  type: z.literal('future_pharmacy_qr'),
  referralToken: referralTokenSchema,
  firstName: z.string().trim().min(1).max(100),
  surname: z.string().trim().min(1).max(100),
  dob: z.iso.date(),
  mobile: z.string().trim().min(7).max(30),
  email: z.email().max(254),
  postcode: z.string().trim().min(2).max(16),
  conditions: z.array(conditionIdSchema).min(1).max(3),
  primaryCondition: conditionIdSchema,
  tried2: z.boolean(),
  psychExclusion: z.boolean(),
  consentReferral: z.literal(true),
  consentShare: z.literal(true),
  marketing: z.boolean().default(false),
  heardAbout: z.string().trim().max(100).default(''),
  consentVersion: z.enum(['pharmacy-qr-v2.0', 'pharmacy-qr-v2.1']),
  idempotencyKey: z.string().uuid(),
}).strict().refine(input => new Set(input.conditions).size === input.conditions.length, {
  path: ['conditions'],
  message: 'Conditions must be unique.',
}).refine(input => input.conditions.includes(input.primaryCondition), {
  path: ['primaryCondition'],
  message: 'Primary condition must be one of the selected conditions.',
});

const resolveLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 120,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
});

const submissionLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
});

export function caseReference(id: string, submittedAt: string) {
  const day = submittedAt.slice(0, 10).replaceAll('-', '');
  return `HHH-${day}-${id.replaceAll('-', '').slice(0, 8).toUpperCase()}`;
}

export function createPublicIntakeV2Router(): Router {
  const router = Router();
  const organisationRepo = new SqlOrganisationRepository();
  const intakeRepo = new SqlIntakeRepository();
  const identityRepo = new SqlIdentityRepository();

  router.post('/public/referral-tokens/resolve', resolveLimiter, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { token } = resolveTokenSchema.parse(req.body);
      const resolution = await organisationRepo.findDirectoryByTokenHash(sha256(token));
      if (!resolution) throw new HttpError(404, 'Pharmacy link not found.', 'NOT_FOUND');
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json(resolution);
    } catch (error) {
      next(error);
    }
  });

  router.post('/public/intakes', submissionLimiter, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = fixedPharmacyIntakeSchema.parse(req.body);
      const resolution = await organisationRepo.findDirectoryByTokenHash(sha256(input.referralToken));
      if (!resolution || resolution.intakeVersion !== 'v2') {
        throw new HttpError(404, 'Pharmacy link not found.', 'NOT_FOUND');
      }

      const idempotencyKeyHash = sha256(input.idempotencyKey);
      let submission = await intakeRepo.findSubmissionByIdempotencyHash(idempotencyKeyHash);
      let created = false;

      if (!submission) {
        const result = await intakeRepo.createSubmission({
          sourceOrganisationId: resolution.pharmacy.id,
          assignedOrganisationId: resolution.pharmacy.id,
          sourceType: 'PHARMACY_QR',
          firstName: input.firstName,
          surname: input.surname,
          dob: input.dob,
          mobile: input.mobile,
          email: input.email.trim().toLowerCase(),
          emailHash: sha256(input.email.trim().toLowerCase()),
          postcode: input.postcode.trim().toUpperCase(),
          triedTwoTreatments: input.tried2,
          psychiatricExclusion: input.psychExclusion,
          heardAbout: input.heardAbout,
          idempotencyKeyHash,
          assignmentStatus: 'PROVISIONAL',
          pharmacyAccessStatus: 'WITHHELD',
          consentVersion: input.consentVersion,
          referralConsent: input.consentReferral,
          dataSharingConsent: input.consentShare,
          marketingConsent: input.marketing,
          privacyNoticeVersion: '2026-v2.1',
        });
        if (!result.id) throw new Error('Eligibility submission did not return an identifier.');
        submission = await intakeRepo.findSubmissionById(result.id);
        if (!submission) throw new Error('Eligibility submission could not be verified after creation.');
        created = true;
      }

      await Promise.all(input.conditions.map(conditionCode => intakeRepo.upsertSubmissionCondition(
        submission!.id,
        conditionCode,
        conditionCode === input.primaryCondition,
      )));

      if (created) {
        await identityRepo.appendAudit({
          organisationId: resolution.pharmacy.id,
          event: 'eligibility.submitted',
          recordType: 'EligibilitySubmission',
          recordId: submission.id,
          surface: 'public',
          details: { sourceType: 'PHARMACY_QR', conditionCount: input.conditions.length },
        });
      }

      const submittedAt = submission.submittedAt || new Date().toISOString();
      res.status(created ? 201 : 200).json({
        caseReference: caseReference(submission.id, submittedAt),
        submittedAt,
        assignmentStatus: 'provisional',
        provisionalPharmacyName: resolution.pharmacy.tradingName,
        warning: null,
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
