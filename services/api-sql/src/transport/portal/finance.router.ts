import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { dataConnect } from '../../bootstrap/firebase.js';
import { HttpError } from '../../domain/common/errors.js';
import { assertPlatformScope } from '../../security/request-context.js';
import { requireStaff } from '../../security/require-staff.js';

const querySchema = z.object({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  organisationId: z.string().uuid().optional(),
}).strict();

const LIST_REFERRAL_FEES_GQL = `
  query ListReferralFeeEvents {
    referralFeeEvents(limit: 20001, orderBy: { createdAt: DESC }) {
      id organisationId patientId kind amountPence dueDate status createdAt settledAt
      organisation { tradingName }
      patient { firstName surname email }
    }
  }
`;

type FeeRow = {
  id: string; organisationId: string; patientId: string; kind: 'NEW_REFERRAL' | 'ANNUAL_PATIENT';
  amountPence: number | string; dueDate: string; status: string; createdAt: string; settledAt: string | null;
  organisation: { tradingName: string } | null;
  patient: { firstName: string; surname: string; email: string } | null;
};

/** Platform-only referral accrual ledger. It is deliberately separate from
 * payment settlement: a fee event is auditable commercial attribution, not an invoice. */
export function createPortalFinanceRouter(): Router {
  const router = Router();

  router.get('/portal/admin/finance/referrals', requireStaff('admin'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      assertPlatformScope(req.context!);
      const filters = querySchema.parse({
        from: req.query.from,
        to: req.query.to,
        organisationId: req.query.organisationId,
      });
      if (filters.from && filters.to && filters.from > filters.to) {
        throw new HttpError(400, 'The reporting start date must be before the end date.', 'INVALID_DATE_RANGE');
      }
      const result = await dataConnect.executeGraphql<{ referralFeeEvents: FeeRow[] }, Record<string, never>>(
        LIST_REFERRAL_FEES_GQL,
        { variables: {} },
      );
      const all = result.data.referralFeeEvents ?? [];
      if (all.length > 20_000) {
        throw new HttpError(413, 'The fee ledger is too large for one report. Select a narrower date range.', 'REPORT_SCOPE_TOO_LARGE');
      }
      const rows = all
        .filter(event => !filters.organisationId || event.organisationId === filters.organisationId)
        .filter(event => !filters.from || event.dueDate >= filters.from!)
        .filter(event => !filters.to || event.dueDate <= filters.to!)
        .map(event => ({
          id: event.id,
          organisationId: event.organisationId,
          pharmacyName: event.organisation?.tradingName ?? 'Unknown pharmacy',
          patientId: event.patientId,
          patientName: event.patient ? `${event.patient.firstName} ${event.patient.surname}`.trim() : 'Patient record',
          patientEmail: event.patient?.email ?? '',
          referralSubmissionId: null,
          kind: event.kind === 'ANNUAL_PATIENT' ? 'annual_patient' as const : 'new_referral' as const,
          amountPence: Number(event.amountPence),
          currency: 'GBP' as const,
          dueDate: event.dueDate,
          occurredAt: event.createdAt,
        }));
      const byPharmacy = new Map<string, { organisationId: string; pharmacyName: string; newReferralCount: number; annualPatientCount: number; amountPence: number }>();
      for (const row of rows) {
        const current = byPharmacy.get(row.organisationId) ?? { organisationId: row.organisationId, pharmacyName: row.pharmacyName, newReferralCount: 0, annualPatientCount: 0, amountPence: 0 };
        current.amountPence += row.amountPence;
        if (row.kind === 'new_referral') current.newReferralCount += 1;
        else current.annualPatientCount += 1;
        byPharmacy.set(row.organisationId, current);
      }
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json({
        currency: 'GBP',
        range: { from: filters.from ?? null, to: filters.to ?? null },
        organisationId: filters.organisationId ?? null,
        totals: {
          eventCount: rows.length,
          newReferralCount: rows.filter(row => row.kind === 'new_referral').length,
          annualPatientCount: rows.filter(row => row.kind === 'annual_patient').length,
          amountPence: rows.reduce((total, row) => total + row.amountPence, 0),
        },
        byPharmacy: [...byPharmacy.values()].sort((left, right) => right.amountPence - left.amountPence),
        rows,
      });
    } catch (error) { next(error); }
  });

  return router;
}
