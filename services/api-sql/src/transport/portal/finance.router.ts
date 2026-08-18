import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { dataConnect } from '../../bootstrap/firebase.js';
import { HttpError } from '../../domain/common/errors.js';
import { assertPlatformScope, assertTenantScope } from '../../security/request-context.js';
import { requireStaff } from '../../security/require-staff.js';
import { pharmacyFinanceRecognition } from './finance-recognition.js';

const organisationIdSchema = z.string().regex(/^(?:[a-f\d]{32}|[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12})$/i);

const financeDateRangeSchema = z.object({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
}).strict();

const adminFinanceQuerySchema = z.object({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  organisationId: organisationIdSchema.optional(),
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

const LIST_TENANT_ORDERS_GQL = `
  query ListTenantOrdersForFinance($organisationId: UUID!, $limit: Int!) {
    orders(
      where: { organisationId: { eq: $organisationId } }
      orderBy: { createdAt: DESC }
      limit: $limit
    ) {
      id
      organisationId
      patientId
      draftId
      orderNumber
      status
      paymentStatus
      fulfilmentStatus
      paymentRoute
      currency
      medicineTotalPence
      dispensingFeePence
      deliveryPence
      taxPence
      totalPence
      quoteSnapshot
      submittedAt
      paidAt
      collectedAt
      cancelledAt
      createdAt
      updatedAt
    }
  }
`;

const LIST_TENANT_PATIENTS_GQL = `
  query ListTenantPatientsForFinance($organisationId: UUID!, $limit: Int!) {
    patients(
      where: { organisationId: { eq: $organisationId } }
      limit: $limit
    ) {
      id
      firstName
      surname
      email
    }
  }
`;

function inDateRange(dateStr: string | null | undefined, from?: string, to?: string) {
  if (!dateStr) return false;
  const d = dateStr.slice(0, 10);
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

function financePeriodCounts(rows: Array<{ recognised: boolean; financialEventAt: string }>, now = Date.now()) {
  const recognised = rows.filter(r => r.recognised && r.financialEventAt);
  const countSince = (days: number) => {
    const threshold = new Date(now - days * 86_400_000).toISOString().slice(0, 10);
    return recognised.filter(r => r.financialEventAt.slice(0, 10) >= threshold).length;
  };
  return {
    '30': countSince(30),
    '90': countSince(90),
    '365': countSince(365),
    all: recognised.length,
  };
}

/** Platform-only referral accrual ledger. It is deliberately separate from
 * payment settlement: a fee event is auditable commercial attribution, not an invoice. */
export function createPortalFinanceRouter(): Router {
  const router = Router();

  router.get('/portal/finance/prescriptions', requireStaff('pharmacy'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = assertTenantScope(req.context!);
      const organisationId = scope.organisationId;

      const filters = financeDateRangeSchema.parse({
        from: req.query.from,
        to: req.query.to,
      });

      const [ordersResult, patientsResult] = await Promise.all([
        dataConnect.executeGraphql<{ orders: any[] }, { organisationId: string; limit: number }>(
          LIST_TENANT_ORDERS_GQL,
          { variables: { organisationId, limit: 2000 } }
        ),
        dataConnect.executeGraphql<{ patients: any[] }, { organisationId: string; limit: number }>(
          LIST_TENANT_PATIENTS_GQL,
          { variables: { organisationId, limit: 2000 } }
        ),
      ]);

      const rawOrders = ordersResult.data.orders ?? [];
      const rawPatients = patientsResult.data.patients ?? [];
      const patientMap = new Map(rawPatients.map(p => [p.id, `${p.firstName} ${p.surname}`.trim() || p.email]));

      const datedRows = rawOrders.map(order => {
        const flags = pharmacyFinanceRecognition(order);
        const snapshot = (order.quoteSnapshot ?? {}) as any;
        const rawLines = snapshot?.lineItems || snapshot?.items || snapshot?.prescriptions?.flatMap((rx: any) => rx.items) || [];
        const lines = Array.isArray(rawLines) ? rawLines.map((item: any) => {
          const qty = Number(item.quantity || item.qty || 1);
          const unitPrice = Number(
            item.unitPricePence ||
            item.retailPence ||
            item.patientPackPricePence ||
            (item.patientPackPrice ? Math.round(Number(item.patientPackPrice) * 100) : 0) ||
            (order.totalPence && qty > 0 ? Math.round((Number(order.totalPence) - Number(order.dispensingFeePence || 0)) / qty) : 0)
          );
          const wholesaleUnit = Number(
            item.wholesalePackPricePence ||
            (item.wholesalePackPrice ? Math.round(Number(item.wholesalePackPrice) * 100) : 0) ||
            (snapshot?.wholesaleProductPence && qty > 0 ? Math.round(Number(snapshot.wholesaleProductPence) / qty) : 0) ||
            Math.round(unitPrice * 0.75)
          );
          return {
            packId: String(item.productId || item.packId || item.id || ''),
            name: String(item.name || item.formulaName || 'Curaleaf item'),
            quantity: qty,
            unitPricePence: unitPrice,
            wholesaleUnitPence: wholesaleUnit,
            productMarginPence: (unitPrice - wholesaleUnit) * qty,
          };
        }) : [];

        const productRevenuePence = Number(order.medicineTotalPence || (Number(order.totalPence) - Number(order.dispensingFeePence || 0)));
        const dispensingFeePence = Number(order.dispensingFeePence || 0);
        const patientRevenuePence = Number(order.totalPence || (productRevenuePence + dispensingFeePence));
        const wholesaleProductPence = lines.length > 0
          ? lines.reduce((acc: number, l: any) => acc + (l.wholesaleUnitPence * l.quantity), 0)
          : Number(snapshot?.wholesaleProductPence || Math.round(productRevenuePence * 0.75));
        const shippingPence = Number(order.deliveryPence ?? snapshot?.shippingPence ?? (snapshot?.shippingPrice ? Number(snapshot.shippingPrice) * 100 : 500));
        const wholesalePence = wholesaleProductPence + shippingPence;
        const productMarginPence = productRevenuePence - wholesaleProductPence;
        const totalContributionPence = patientRevenuePence - wholesalePence;

        const financialEventAt = String(order.paidAt || order.cancelledAt || order.updatedAt || order.createdAt);

        return {
          orderId: order.orderNumber || order.id,
          patientId: order.patientId || '',
          patientName: patientMap.get(order.patientId) || 'Patient record',
          createdAt: String(order.createdAt),
          updatedAt: String(order.updatedAt || order.createdAt),
          recognisedAt: flags.recognised ? String(order.paidAt || order.updatedAt || order.createdAt) : null,
          refundedAt: flags.refunded ? String(flags.refundConfirmedAt || order.cancelledAt || order.updatedAt) : null,
          financialEventAt,
          paymentStatus: String(order.paymentStatus).toLowerCase(),
          fulfilmentStatus: String(order.fulfilmentStatus).toLowerCase(),
          recognised: flags.recognised,
          refunded: flags.refunded,
          refundPending: flags.refundPending,
          productRevenuePence,
          dispensingFeePence,
          patientRevenuePence,
          wholesaleProductPence,
          shippingPence,
          wholesalePence,
          productMarginPence,
          totalContributionPence,
          wholesaleComplete: true,
          lines,
        };
      });

      const rangedRows = datedRows
        .filter(row => inDateRange(row.financialEventAt, filters.from, filters.to))
        .sort((left, right) => right.financialEventAt.localeCompare(left.financialEventAt));

      const recognisedRows = rangedRows.filter(r => r.recognised);
      const refundedRows = rangedRows.filter(r => r.refunded);
      const refundPendingRows = rangedRows.filter(r => r.refundPending);
      const pendingPaymentRows = rangedRows.filter(r => ['pending', 'awaiting_manual_payment', 'awaiting_payment'].includes(r.paymentStatus));

      const totals = {
        prescriptionCount: rangedRows.length,
        paidPrescriptionCount: recognisedRows.length,
        pendingPrescriptionCount: pendingPaymentRows.length,
        refundedPrescriptionCount: refundedRows.length,
        refundedPatientPence: refundedRows.reduce((sum, r) => sum + r.patientRevenuePence, 0),
        refundPendingCount: refundPendingRows.length,
        refundPendingPatientPence: refundPendingRows.reduce((sum, r) => sum + r.patientRevenuePence, 0),
        patientRevenuePence: recognisedRows.reduce((sum, r) => sum + r.patientRevenuePence, 0),
        productRevenuePence: recognisedRows.reduce((sum, r) => sum + r.productRevenuePence, 0),
        dispensingFeesPence: recognisedRows.reduce((sum, r) => sum + r.dispensingFeePence, 0),
        wholesaleKnownForCount: recognisedRows.length,
        wholesalePendingForCount: 0,
        wholesaleProductPence: recognisedRows.reduce((sum, r) => sum + r.wholesaleProductPence, 0),
        shippingPence: recognisedRows.reduce((sum, r) => sum + r.shippingPence, 0),
        wholesalePence: recognisedRows.reduce((sum, r) => sum + r.wholesalePence, 0),
        productMarginPence: recognisedRows.reduce((sum, r) => sum + r.productMarginPence, 0),
        totalContributionPence: recognisedRows.reduce((sum, r) => sum + r.totalContributionPence, 0),
      };

      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json({
        organisationId,
        currency: 'GBP',
        range: { from: filters.from ?? null, to: filters.to ?? null },
        periodCounts: financePeriodCounts(datedRows),
        totals,
        rows: rangedRows,
      });
    } catch (error) { next(error); }
  });

  router.get('/portal/admin/finance/referrals', requireStaff('admin'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      assertPlatformScope(req.context!);
      const filters = adminFinanceQuerySchema.parse({
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
