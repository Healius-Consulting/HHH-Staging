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

const PERIOD_LABELS: Record<Period, string> = {
  '30': 'Last 30 days',
  '90': 'Last 90 days',
  '365': 'Last 12 months',
  all: 'All paid prescriptions',
};

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
    };
  }, [financialOrders]);

  const contributionDetail = totals.pendingCount
    ? `${totals.confirmedCount} of ${financialOrders.length} paid orders costed`
    : 'Product margin plus dispensing fees';

  return (
    <div className="page-body pharmacy-finance">
      <section className="pharmacy-finance__intro">
        <div>
          <p className="section-label">Pharmacy financials</p>
          <h2>Understand the contribution from paid prescriptions</h2>
          <p>Compare Curaleaf patient prices with quoted wholesale costs and the dispensing charges retained by this pharmacy.</p>
        </div>
        <label className="pharmacy-finance__period">
          <span>Reporting period</span>
          <select value={period} onChange={event => setPeriod(event.target.value as Period)}>
            {(Object.entries(PERIOD_LABELS) as Array<[Period, string]>).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
      </section>

      <section className="pharmacy-finance__tiles" aria-label={`${PERIOD_LABELS[period]} financial summary`}>
        <article>
          <span className="pharmacy-finance__tile-icon"><PoundSterling size={17} /></span>
          <div><small>Patient product revenue</small><strong>{money(totals.productRevenue)}</strong><span>Paid Curaleaf product prices</span></div>
        </article>
        <article>
          <span className="pharmacy-finance__tile-icon"><PackageCheck size={17} /></span>
          <div><small>Curaleaf wholesale</small><strong>{money(totals.wholesale)}</strong><span>{totals.pendingCount ? `${totals.pendingCount} awaiting quoted cost` : 'All quoted costs confirmed'}</span></div>
        </article>
        <article>
          <span className="pharmacy-finance__tile-icon"><TrendingUp size={17} /></span>
          <div><small>Product margin</small><strong>{money(totals.productMargin)}</strong><span>Confirmed patient price less wholesale</span></div>
        </article>
        <article>
          <span className="pharmacy-finance__tile-icon"><ReceiptText size={17} /></span>
          <div><small>Dispensing fees</small><strong>{money(totals.dispensingFees)}</strong><span>Charges retained by the pharmacy</span></div>
        </article>
        <article className="pharmacy-finance__tile--primary">
          <span className="pharmacy-finance__tile-icon"><BadgePoundSterling size={18} /></span>
          <div><small>Confirmed contribution</small><strong>{money(totals.contribution)}</strong><span>{contributionDetail}</span></div>
        </article>
      </section>

      {totals.pendingCount > 0 && (
        <div className="pharmacy-finance__notice" role="status">
          <AlertCircle size={17} />
          <div>
            <strong>{totals.pendingCount} paid order{totals.pendingCount === 1 ? '' : 's'} awaiting wholesale data</strong>
            <span>Those patient payments are included in revenue, but excluded from margin and contribution until Curaleaf supplies a quoted wholesale cost.</span>
          </div>
        </div>
      )}

      <section className="card card-flush pharmacy-finance__ledger">
        <header>
          <div>
            <p className="section-label">Prescription ledger</p>
            <h3>{financialOrders.length} paid prescription order{financialOrders.length === 1 ? '' : 's'}</h3>
          </div>
          <div className="pharmacy-finance__formula" aria-label="Contribution calculation">
            <span>Product margin</span><b>+</b><span>Dispensing fees</span><b>=</b><strong>Total contribution</strong>
          </div>
        </header>

        {financialOrders.length === 0 ? (
          <div className="pharmacy-finance__empty">
            <BadgePoundSterling size={24} />
            <strong>No paid prescriptions in this period</strong>
            <span>Financial results will appear here after a patient payment is confirmed.</span>
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
                  <th>Total contribution</th>
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
                    <td data-label="Total contribution" className="pharmacy-finance__contribution"><FinancialValue value={record.contribution} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="pharmacy-finance__footnote">
        This operational view uses paid prescription records for this pharmacy only. It is not a settlement statement or accounting ledger.
        Patient total for the period: <strong>{money(financialOrders.reduce((total, record) => total + record.productRevenue + record.dispensingFees, 0))}</strong>.
      </p>
    </div>
  );
}
