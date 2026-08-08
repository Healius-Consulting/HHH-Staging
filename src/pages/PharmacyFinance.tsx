import { useMemo, useState } from 'react';
import { AlertCircle, BadgePoundSterling, PackageCheck, PoundSterling, ReceiptText, TrendingUp } from 'lucide-react';
import {
  money,
  orderCost,
  rxRevenue,
  useApp,
  type PatientOrder,
} from '../context/AppContext';
import { compactPatientName } from '../utils/patientName';
import './PharmacyFinance.css';

type Period = '30' | '90' | '365' | 'all';

interface FinancialOrder {
  order: PatientOrder;
  patientName: string;
  paidAt: Date;
  productRevenue: number;
  wholesale: number | null;
  productMargin: number | null;
  dispensingFees: number;
  contribution: number | null;
}

const PERIOD_OPTIONS: Array<{ value: Period; label: string; short: string }> = [
  { value: '30', label: 'Last 30 days', short: '30 days' },
  { value: '90', label: 'Last 90 days', short: '90 days' },
  { value: '365', label: 'Last 12 months', short: '12 months' },
  { value: 'all', label: 'All paid prescriptions', short: 'All time' },
];

function hasCompleteWholesale(order: PatientOrder) {
  const items = order.prescriptions.flatMap(prescription => prescription.items);
  return items.length > 0 && items.every(item => item.cost !== null);
}

function orderReference(order: PatientOrder) {
  if (order.backendId) return order.backendId;
  return `Order ${order.id}`;
}

function FinancialValue({
  value,
  unavailable = false,
}: {
  value: number | null;
  unavailable?: boolean;
}) {
  if (value === null || unavailable) return <span className="pharmacy-finance__pending">Awaiting quote</span>;
  return <>{money(value)}</>;
}

export default function PharmacyFinance() {
  const { state } = useApp();
  const [period, setPeriod] = useState<Period>('90');
  const organisationId = state.currentOrganisationId;

  const financialOrders = useMemo(() => {
    const patientById = new Map(
      state.crm
        .filter(patient => patient.organisationId === organisationId)
        .map(patient => [patient.id, patient.name]),
    );
    const cutoff = period === 'all'
      ? null
      : new Date(Date.now() - Number(period) * 24 * 60 * 60 * 1000);

    return state.orders
      .filter(order => order.organisationId === organisationId && order.payment.status === 'paid')
      .map((order): FinancialOrder => {
        const paidAt = new Date(order.payment.paidAt ?? order.date);
        const calculatedProductRevenue = order.prescriptions.reduce((total, prescription) => total + rxRevenue(prescription), 0);
        const productRevenue = calculatedProductRevenue > 0
          ? calculatedProductRevenue
          : Math.max(0, order.payment.amount - order.dispensingFee);
        const wholesale = hasCompleteWholesale(order) ? orderCost(order) : null;
        const productMargin = wholesale === null ? null : productRevenue - wholesale;
        return {
          order,
          patientName: patientById.get(order.patientId ?? '') ?? 'Patient unavailable',
          paidAt,
          productRevenue,
          wholesale,
          productMargin,
          dispensingFees: order.dispensingFee,
          contribution: productMargin === null ? null : productMargin + order.dispensingFee,
        };
      })
      .filter(record => cutoff === null || record.paidAt >= cutoff)
      .sort((a, b) => b.paidAt.getTime() - a.paidAt.getTime());
  }, [organisationId, period, state.crm, state.orders]);

  const totals = useMemo(() => {
    const confirmed = financialOrders.filter(order => order.wholesale !== null);
    const productRevenue = financialOrders.reduce((total, order) => total + order.productRevenue, 0);
    const wholesale = confirmed.reduce((total, order) => total + (order.wholesale ?? 0), 0);
    const productMargin = confirmed.reduce((total, order) => total + (order.productMargin ?? 0), 0);
    const dispensingFees = financialOrders.reduce((total, order) => total + order.dispensingFees, 0);
    const contribution = confirmed.reduce((total, order) => total + (order.contribution ?? 0), 0);
    return {
      productRevenue,
      wholesale,
      productMargin,
      dispensingFees,
      contribution,
      confirmedCount: confirmed.length,
      pendingCount: financialOrders.length - confirmed.length,
      patientTotal: financialOrders.reduce((total, record) => total + record.productRevenue + record.dispensingFees, 0),
    };
  }, [financialOrders]);

  const periodLabel = PERIOD_OPTIONS.find(option => option.value === period)?.label ?? 'Selected period';

  const periodCounts = useMemo(() => {
    const paid = state.orders.filter(order => order.organisationId === organisationId && order.payment.status === 'paid');
    const countFor = (value: Period) => {
      if (value === 'all') return paid.length;
      const cutoff = new Date(Date.now() - Number(value) * 24 * 60 * 60 * 1000);
      return paid.filter(order => new Date(order.payment.paidAt ?? order.date) >= cutoff).length;
    };
    return Object.fromEntries(PERIOD_OPTIONS.map(option => [option.value, countFor(option.value)])) as Record<Period, number>;
  }, [organisationId, state.orders]);

  return (
    <div className="page-body pharmacy-finance">
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
            <span className="filter-card__value">{periodCounts[option.value]}</span>
          </button>
        ))}
      </div>

      <section className="summary-tiles pharmacy-finance__tiles" aria-label={`${periodLabel} financial summary`}>
        <div className="summary-tile">
          <span className="summary-tile__label">Patient product revenue</span>
          <strong className="summary-tile__value">{money(totals.productRevenue)}</strong>
          <small className="summary-tile__detail">Paid Curaleaf product prices</small>
          <PoundSterling className="summary-tile__arrow" size={16} aria-hidden="true" />
        </div>
        <div className="summary-tile">
          <span className="summary-tile__label">Curaleaf wholesale</span>
          <strong className="summary-tile__value">{money(totals.wholesale)}</strong>
          <small className="summary-tile__detail">{totals.pendingCount ? `${totals.pendingCount} awaiting quoted cost` : 'All quoted costs confirmed'}</small>
          <PackageCheck className="summary-tile__arrow" size={16} aria-hidden="true" />
        </div>
        <div className="summary-tile">
          <span className="summary-tile__label">Product margin</span>
          <strong className="summary-tile__value">{money(totals.productMargin)}</strong>
          <small className="summary-tile__detail">Patient price less wholesale</small>
          <TrendingUp className="summary-tile__arrow" size={16} aria-hidden="true" />
        </div>
        <div className="summary-tile">
          <span className="summary-tile__label">Dispensing fees</span>
          <strong className="summary-tile__value">{money(totals.dispensingFees)}</strong>
          <small className="summary-tile__detail">Retained by this pharmacy</small>
          <ReceiptText className="summary-tile__arrow" size={16} aria-hidden="true" />
        </div>
        <div className="summary-tile summary-tile--accent">
          <span className="summary-tile__label">Confirmed contribution</span>
          <strong className="summary-tile__value">{money(totals.contribution)}</strong>
          <small className="summary-tile__detail">
            {totals.pendingCount
              ? `${totals.confirmedCount} of ${financialOrders.length} orders costed`
              : 'Margin + dispensing fees'}
          </small>
          <BadgePoundSterling className="summary-tile__arrow" size={16} aria-hidden="true" />
        </div>
      </section>

      {totals.pendingCount > 0 && (
        <div className="alert-warning pharmacy-finance__notice" role="status">
          <AlertCircle size={17} />
          <div>
            <strong>{totals.pendingCount} paid order{totals.pendingCount === 1 ? '' : 's'} awaiting wholesale data</strong>
            <span>Revenue includes these payments; margin and contribution wait until Curaleaf supplies a quoted wholesale cost.</span>
          </div>
        </div>
      )}

      <section className="card card-flush pharmacy-finance__ledger">
        <div className="section-heading section-heading--padded">
          <div>
            <p className="section-label">Prescription ledger</p>
            <h3>{financialOrders.length} paid order{financialOrders.length === 1 ? '' : 's'} · {periodLabel}</h3>
          </div>
          <span>Margin + fees = contribution</span>
        </div>

        {financialOrders.length === 0 ? (
          <div className="empty-state">
            <BadgePoundSterling size={32} />
            <h3>No paid prescriptions in this period</h3>
            <p>Results appear here after a patient payment is confirmed.</p>
          </div>
        ) : (
          <div className="pharmacy-finance__table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Prescription</th>
                  <th>Patient products</th>
                  <th>Wholesale</th>
                  <th>Product margin</th>
                  <th>Dispensing fees</th>
                  <th>Contribution</th>
                </tr>
              </thead>
              <tbody>
                {financialOrders.map(record => (
                  <tr key={record.order.backendId ?? record.order.id}>
                    <td>
                      <strong title={record.patientName}>{compactPatientName(record.patientName)}</strong>
                      <span>{record.paidAt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} · {orderReference(record.order)}</span>
                    </td>
                    <td data-label="Patient products"><FinancialValue value={record.productRevenue} /></td>
                    <td data-label="Wholesale"><FinancialValue value={record.wholesale} /></td>
                    <td data-label="Product margin"><FinancialValue value={record.productMargin} /></td>
                    <td data-label="Dispensing fees"><FinancialValue value={record.dispensingFees} /></td>
                    <td data-label="Contribution" className="pharmacy-finance__contribution"><FinancialValue value={record.contribution} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="pharmacy-finance__footnote">
        Operational view for this pharmacy only — not a settlement statement.
        Patient total for the period: <strong>{money(totals.patientTotal)}</strong>.
      </p>
    </div>
  );
}
