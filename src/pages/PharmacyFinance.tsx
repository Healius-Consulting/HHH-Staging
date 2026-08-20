import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, BadgePoundSterling, PackageCheck, PoundSterling, ReceiptText, RefreshCw, TrendingUp } from 'lucide-react';
import { money, useApp } from '../context/AppContext';
import { getPharmacyPrescriptionFinance } from '../shared/api';
import type { PharmacyPrescriptionFinanceReport } from '../shared/contracts';
import { isLocalPortalPreview } from '../dev/localPortalPreview';
import { compactPatientName } from '../utils/patientName';
import './PharmacyFinance.css';

type Period = '30' | '90' | '365' | 'all';
type FinanceRow = PharmacyPrescriptionFinanceReport['rows'][number];

const PERIOD_OPTIONS: Array<{ value: Period; label: string }> = [
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
  { value: '365', label: 'Last 12 months' },
  { value: 'all', label: 'All paid prescriptions' },
];

function periodStart(period: Period) {
  if (period === 'all') return undefined;
  return new Date(Date.now() - Number(period) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function emptyFinanceReport(period: Period, organisationId: string): PharmacyPrescriptionFinanceReport {
  return {
    organisationId,
    currency: 'GBP',
    range: { from: periodStart(period) ?? null, to: null },
    periodCounts: { '30': 0, '90': 0, '365': 0, all: 0 },
    totals: {
      prescriptionCount: 0, paidPrescriptionCount: 0, pendingPrescriptionCount: 0,
      refundedPrescriptionCount: 0, refundedPatientPence: 0, refundPendingCount: 0, refundPendingPatientPence: 0,
      patientRevenuePence: 0, productRevenuePence: 0, dispensingFeesPence: 0,
      wholesaleKnownForCount: 0, wholesalePendingForCount: 0, wholesaleProductPence: 0,
      shippingPence: 0, wholesalePence: 0, productMarginPence: 0, totalContributionPence: 0,
    },
    rows: [],
  };
}

function localPreviewFinanceReport(period: Period): PharmacyPrescriptionFinanceReport {
  const now = new Date().toISOString();
  const paidRow: FinanceRow = {
    orderId: 'LOCAL-PAID-01', patientId: 'local-patient-1', patientName: 'Sample Patient',
    createdAt: now, updatedAt: now, recognisedAt: now, refundedAt: null, financialEventAt: now,
    paymentStatus: 'paid', fulfilmentStatus: 'supplier_processing', recognised: true, refunded: false, refundPending: false,
    productRevenuePence: 10_000, dispensingFeePence: 500, patientRevenuePence: 10_500,
    wholesaleProductPence: 8_000, shippingPence: 500, wholesalePence: 8_500,
    productMarginPence: 2_000, totalContributionPence: 2_000, wholesaleComplete: true,
    lines: [{ packId: 'local-pack-1', name: 'Sample product', quantity: 1, unitPricePence: 10_000, wholesaleUnitPence: 8_000, productMarginPence: 2_000 }],
  };
  const refundedRow: FinanceRow = {
    ...paidRow,
    orderId: 'LOCAL-REFUND-01', patientId: 'local-patient-2', patientName: 'Refunded Example',
    paymentStatus: 'refunded', recognised: false, refunded: true, recognisedAt: null, refundedAt: now,
  };
  return {
    organisationId: 'local-preview-pharmacy', currency: 'GBP', range: { from: periodStart(period) ?? null, to: null },
    periodCounts: { '30': 1, '90': 1, '365': 1, all: 1 },
    totals: {
      prescriptionCount: 2, paidPrescriptionCount: 1, pendingPrescriptionCount: 0,
      refundedPrescriptionCount: 1, refundedPatientPence: 10_500, refundPendingCount: 0, refundPendingPatientPence: 0,
      patientRevenuePence: 10_500, productRevenuePence: 10_000, dispensingFeesPence: 500,
      wholesaleKnownForCount: 1, wholesalePendingForCount: 0, wholesaleProductPence: 8_000,
      shippingPence: 500, wholesalePence: 8_500, productMarginPence: 2_000, totalContributionPence: 2_000,
    },
    rows: [paidRow, refundedRow],
  };
}

function pounds(pence: number) {
  return money(pence / 100);
}

function FinancialValue({ value }: { value: number | null }) {
  if (value === null) return <span className="pharmacy-finance__pending">Awaiting quote</span>;
  return <>{pounds(value)}</>;
}

function recognisedDate(row: FinanceRow) {
  return new Date(row.recognisedAt ?? row.financialEventAt);
}

export default function PharmacyFinance() {
  const { state } = useApp();
  const liveWorkspace = state.workspaceMode === 'live';
  const [period, setPeriod] = useState<Period>('90');
  const [report, setReport] = useState<PharmacyPrescriptionFinanceReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestVersion = useRef(0);

  const load = useCallback(async () => {
    const version = requestVersion.current + 1;
    requestVersion.current = version;
    setLoading(true);
    setError(null);
    try {
      const nextReport = isLocalPortalPreview
        ? localPreviewFinanceReport(period)
        : liveWorkspace
          ? await getPharmacyPrescriptionFinance({ from: periodStart(period) })
          : emptyFinanceReport(period, state.currentOrganisationId);
      if (requestVersion.current === version) setReport(nextReport);
    } catch (loadError) {
      if (requestVersion.current === version) setError(loadError instanceof Error ? loadError.message : 'The finance report is unavailable.');
    } finally {
      if (requestVersion.current === version) setLoading(false);
    }
  }, [liveWorkspace, period, state.currentOrganisationId]);

  useEffect(() => { void load(); }, [load]);

  const financialOrders = useMemo(() => (report?.rows ?? [])
    .filter(row => row.recognised)
    .sort((left, right) => recognisedDate(right).getTime() - recognisedDate(left).getTime()), [report]);
  const totals = report?.totals;
  const periodLabel = PERIOD_OPTIONS.find(option => option.value === period)?.label ?? 'Selected period';

  return (
    <div className="page-body pharmacy-finance" aria-busy={loading}>
      <div className="filter-grid pharmacy-finance__periods" role="group" aria-label="Reporting period">
        {PERIOD_OPTIONS.map(option => (
          <button
            key={option.value}
            type="button"
            aria-pressed={period === option.value}
            className={`filter-card ${period === option.value ? 'active' : ''}`}
            onClick={() => setPeriod(option.value)}
          >
            <div className="filter-card__head"><span>{option.label}</span></div>
            <span className="filter-card__value">{report?.periodCounts[option.value] ?? '—'}</span>
          </button>
        ))}
      </div>

      {loading && !report && (
        <section className="overview-state" role="status">
          <span className="spinner" aria-hidden="true" />
          <h2>Loading finance report</h2>
          <p>Calculating the authorised paid-order totals.</p>
        </section>
      )}

      {error && (
        <div className="alert-warning pharmacy-finance__notice" role="alert">
          <AlertCircle size={17} aria-hidden="true" />
          <div><strong>Finance report unavailable</strong><span>{error}</span></div>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void load()}><RefreshCw size={14} aria-hidden="true" /> Try again</button>
        </div>
      )}

      {report && totals && (
        <>
          <section className="summary-tiles pharmacy-finance__tiles" aria-label={`${periodLabel} financial summary`} aria-live="polite">
            <div className="summary-tile">
              <span className="summary-tile__label">Patient product revenue</span>
              <strong className="summary-tile__value">{pounds(totals.productRevenuePence)}</strong>
              <small className="summary-tile__detail">Paid orders</small>
              <PoundSterling className="summary-tile__arrow" size={16} aria-hidden="true" />
            </div>
            <div className="summary-tile">
              <span className="summary-tile__label">Quoted Curaleaf cost</span>
              <strong className="summary-tile__value">{pounds(totals.wholesalePence)}</strong>
              <small className="summary-tile__detail">Products {pounds(totals.wholesaleProductPence)} + shipping {pounds(totals.shippingPence)}</small>
              <PackageCheck className="summary-tile__arrow" size={16} aria-hidden="true" />
            </div>
            <div className="summary-tile">
              <span className="summary-tile__label">Product margin</span>
              <strong className="summary-tile__value">{pounds(totals.productMarginPence)}</strong>
              <small className="summary-tile__detail">Patient product price less quoted product cost</small>
              <TrendingUp className="summary-tile__arrow" size={16} aria-hidden="true" />
            </div>
            <div className="summary-tile">
              <span className="summary-tile__label">Dispensing fees</span>
              <strong className="summary-tile__value">{pounds(totals.dispensingFeesPence)}</strong>
              <small className="summary-tile__detail">Retained by this pharmacy</small>
              <ReceiptText className="summary-tile__arrow" size={16} aria-hidden="true" />
            </div>
            <div className="summary-tile summary-tile--accent">
              <span className="summary-tile__label">Estimated contribution</span>
              <strong className="summary-tile__value">{pounds(totals.totalContributionPence)}</strong>
              <small className="summary-tile__detail">
                {totals.wholesalePendingForCount
                  ? `${totals.wholesaleKnownForCount} of ${totals.paidPrescriptionCount} paid orders costed`
                  : 'Revenue + fees − quoted products and shipping'}
              </small>
              <BadgePoundSterling className="summary-tile__arrow" size={16} aria-hidden="true" />
            </div>
          </section>

          {(totals.refundedPrescriptionCount > 0 || totals.refundPendingCount > 0) && (
            <div className="pharmacy-finance__exclusions" role="status">
              <AlertCircle size={17} aria-hidden="true" />
              <div>
                <strong>Refunded orders are excluded</strong>
                <span>
                  {totals.refundedPrescriptionCount > 0
                    ? `${totals.refundedPrescriptionCount} completed refund${totals.refundedPrescriptionCount === 1 ? '' : 's'} (${pounds(totals.refundedPatientPence)})`
                    : 'No completed refunds'}
                  {totals.refundPendingCount > 0
                    ? ` and ${totals.refundPendingCount} pending refund${totals.refundPendingCount === 1 ? '' : 's'} (${pounds(totals.refundPendingPatientPence)})`
                    : ''}
                  {' '}do not contribute to revenue, quoted cost, margin, fees or contribution.
                </span>
              </div>
            </div>
          )}

          {totals.wholesalePendingForCount > 0 && (
            <div className="alert-warning pharmacy-finance__notice" role="status">
              <AlertCircle size={17} aria-hidden="true" />
              <div>
                <strong>{totals.wholesalePendingForCount} paid order{totals.wholesalePendingForCount === 1 ? '' : 's'} awaiting wholesale data</strong>
                <span>Revenue includes these payments; margin and estimated contribution wait until Curaleaf supplies a quote.</span>
              </div>
            </div>
          )}

          <section className="card card-flush pharmacy-finance__ledger">
            <div className="section-heading section-heading--padded">
              <div>
                <p className="section-label">Prescription ledger</p>
                <h3>{financialOrders.length} paid order{financialOrders.length === 1 ? '' : 's'} · {periodLabel}</h3>
              </div>
              <span>Refunded orders excluded</span>
            </div>

            {financialOrders.length === 0 ? (
              <div className="empty-state">
                <BadgePoundSterling size={32} aria-hidden="true" />
                <h3>{liveWorkspace ? 'No retained paid prescriptions in this period' : 'Training examples are not paid prescriptions'}</h3>
                <p>{liveWorkspace
                  ? 'Results appear here after payment is confirmed and remain excluded after a refund is opened.'
                  : 'Live paid-order totals appear here after HHH flips this workspace live.'}</p>
              </div>
            ) : (
              <div className="pharmacy-finance__table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Prescription</th>
                      <th>Patient products</th>
                      <th>Quoted cost</th>
                      <th>Product margin</th>
                      <th>Dispensing fees</th>
                      <th>Est. contribution</th>
                    </tr>
                  </thead>
                  <tbody>
                    {financialOrders.map(record => (
                      <tr key={record.orderId}>
                        <td>
                          <strong title={record.patientName}>{compactPatientName(record.patientName)}</strong>
                          <span>{recognisedDate(record).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} · {record.orderId}</span>
                        </td>
                        <td data-label="Patient products"><FinancialValue value={record.productRevenuePence} /></td>
                        <td data-label="Quoted cost"><FinancialValue value={record.wholesalePence} /></td>
                        <td data-label="Product margin"><FinancialValue value={record.productMarginPence} /></td>
                        <td data-label="Dispensing fees"><FinancialValue value={record.dispensingFeePence} /></td>
                        <td data-label="Est. contribution" className="pharmacy-finance__contribution"><FinancialValue value={record.totalContributionPence} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <p className="pharmacy-finance__footnote">
            Operational estimate for this pharmacy only—not a Curaleaf settlement statement. Curaleaf costs come from accepted quotes, not supplier invoices or payment records.
            Patient total retained for the period: <strong>{pounds(totals.patientRevenuePence)}</strong>.
          </p>
        </>
      )}
    </div>
  );
}
