import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ArrowRight, CheckCircle2, ListChecks, RefreshCw, ShieldCheck } from 'lucide-react';
import SummaryTiles from '../components/SummaryTiles';
import { useApp } from '../context/AppContext';
import { getPharmacyOverview } from '../shared/api';
import type { PharmacyOverview as PharmacyOverviewContract } from '../shared/contracts';

const kindLabels: Record<PharmacyOverviewContract['priorityItems'][number]['kind'], string> = {
  payment: 'Awaiting payment',
  collection: 'Collection follow-up',
  cancellation: 'Cancellation',
  repeat: 'Repeat prescription',
  supplier: 'Supplier',
};

function ageLabel(kind: PharmacyOverviewContract['priorityItems'][number]['kind'], ageDays: number) {
  if (kind === 'payment') {
    return ageDays === 0 ? 'Sent today' : `${ageDays} day${ageDays === 1 ? '' : 's'} awaiting payment`;
  }
  if (kind === 'repeat') {
    return `Last order ${ageDays} day${ageDays === 1 ? '' : 's'} ago`;
  }
  return `${ageDays} day${ageDays === 1 ? '' : 's'} in queue`;
}

function formatAsOf(value: string) {
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function startKindLabel(kind: PharmacyOverviewContract['prescriptionStarts']['items'][number]['kind']) {
  return kind === 'first' ? 'First order' : 'Repeat';
}

function startAgeLabel(kind: PharmacyOverviewContract['prescriptionStarts']['items'][number]['kind'], ageDays: number) {
  if (kind === 'first') {
    return ageDays === 0 ? 'Referred today' : `Referred ${ageDays} day${ageDays === 1 ? '' : 's'} ago`;
  }
  return `Last order ${ageDays} day${ageDays === 1 ? '' : 's'} ago`;
}

function stateLabel(item: PharmacyOverviewContract['integrations'][number]) {
  const label = item.state.replace('-', ' ');
  if (item.state === 'not-configured' || item.environment !== 'test') return label;
  return `${label} (Test)`;
}

export default function PharmacyOverview() {
  const { state, dispatch } = useApp();
  const [overview, setOverview] = useState<PharmacyOverviewContract | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      setOverview(await getPharmacyOverview());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'The operational overview is unavailable.');
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const openScreen = (screen: 'orders' | 'patients') => {
    dispatch({ type: 'SET_NAVIGATION_TARGET', target: null });
    dispatch({ type: 'SET_SCREEN', screen });
  };

  const openRecord = (target: PharmacyOverviewContract['priorityItems'][number]['recordTarget']) => {
    if (target.kind === 'order') {
      dispatch({ type: 'SET_NAVIGATION_TARGET', target: { kind: 'order', key: target.id } });
      dispatch({ type: 'SET_SCREEN', screen: 'orders' });
      return;
    }
    dispatch({ type: 'SET_NAVIGATION_TARGET', target: { kind: 'patient', id: target.id } });
    dispatch({ type: 'SET_SCREEN', screen: 'patients' });
  };

  const startPrescription = (patientId: string) => {
    const existingDraft = state.orders.find(order => (
      order.organisationId === state.currentOrganisationId
      && order.patientId === patientId
      && order.payment.status === 'none'
    ));
    if (existingDraft) {
      dispatch({ type: 'SET_ACTIVE_ORDER', orderId: existingDraft.id });
    } else {
      dispatch({ type: 'NEW_ORDER', patientId });
    }
    dispatch({ type: 'SET_SCREEN', screen: 'create' });
  };

  if (!overview && refreshing) {
    return (
      <div className="page-body">
        <section className="overview-state" aria-busy="true">
          <span className="spinner" aria-hidden="true" />
          <h2>Loading pharmacy overview</h2>
          <p>Retrieving the authorised operational summary.</p>
        </section>
      </div>
    );
  }

  if (!overview) {
    return (
      <div className="page-body">
        <section className="overview-state" role="alert">
          <AlertTriangle aria-hidden="true" />
          <h2>Overview unavailable</h2>
          <p>{error}</p>
          <button className="btn btn-primary" onClick={() => void load()}>
            <RefreshCw size={16} /> Try again
          </button>
        </section>
      </div>
    );
  }

  const isStale = Date.now() - new Date(overview.asOf).getTime() > 5 * 60 * 1000;
  const ordersQueueTotal = overview.summary.awaitingPayment
    + overview.summary.supplierFulfilment
    + overview.summary.readyForCollection;
  const prescriptionStarts = overview.prescriptionStarts ?? { firstCount: 0, repeatCount: 0, items: [] };

  return (
    <div className="page-body secure-overview">
      <header className="secure-overview__header">
        <div>
          <p className="section-label">Authenticated pharmacy workspace</p>
          <h1>{overview.organisation.tradingName}</h1>
          <div className="secure-overview__identity">
            <span className={`status-badge status-badge--${overview.organisation.status}`}>
              {overview.organisation.status.replace('_', ' ')}
            </span>
            {overview.organisation.trainingMode && <span className="status-badge status-badge--training">Training data</span>}
            {overview.organisation.allocationHoldingMode && <span className="status-badge status-badge--intake_live">Holistic Health Hub Allocation</span>}
            <span>As of {formatAsOf(overview.asOf)}</span>
          </div>
        </div>
        <button className="btn btn-secondary" onClick={() => void load()} disabled={refreshing} aria-label="Refresh pharmacy overview">
          <RefreshCw size={16} aria-hidden="true" /> {refreshing ? 'Refreshing' : 'Refresh'}
        </button>
      </header>

      {(error || isStale) && (
        <div className="overview-advisory" role="status">
          <AlertTriangle size={17} aria-hidden="true" />
          <span>{error ?? 'This summary may be stale. Refresh before acting on queue totals.'}</span>
        </div>
      )}

      {overview.enquiries.pendingCount > 0 && (
        <section className="card overview-enquiry-notice" role="status" aria-label="HHH-managed eligibility enquiries">
          <span className="overview-enquiry-notice__icon"><ShieldCheck size={20} aria-hidden="true" /></span>
          <div>
            <p className="section-label">Eligibility enquiry</p>
            <h2>
              {overview.enquiries.pendingCount === 1
                ? 'A new enquiry has been received'
                : `${overview.enquiries.pendingCount} new enquiries have been received`}
            </h2>
            <p>
              HHH admin may accept this pharmacy or move the enquiry.
              Open Patients to see who is currently assigned to you. Referral marks them referred.
            </p>
          </div>
          <span className="status-badge status-badge--intake_live">With HHH admin</span>
        </section>
      )}

      <section className="overview-panel overview-today" aria-label="Today">
        {overview.summary.urgentTotal > 0 && (
          <p className="page-status-note" role="status">
            <strong>{overview.summary.urgentTotal}</strong> item{overview.summary.urgentTotal === 1 ? '' : 's'} need attention today.
          </p>
        )}

        <SummaryTiles
          className="summary-tiles--compact summary-tiles--two"
          label="Today's workflow"
          items={[
            {
              label: 'Patients',
              value: overview.summary.activePatients,
              detail: 'Activated by HHH',
              onClick: () => openScreen('patients'),
            },
            {
              label: 'Orders queue',
              value: ordersQueueTotal,
              detail: 'Payment, supplier, and collection',
              onClick: () => openScreen('orders'),
            },
          ]}
        />

        <section className="card overview-rx-starts" aria-label="Start a prescription">
          <div className="section-heading">
            <div>
              <p className="section-label">Prescriptions</p>
              <h2>Start a prescription</h2>
            </div>
            {prescriptionStarts.items.length > 0 ? (
              <span>{prescriptionStarts.firstCount} first · {prescriptionStarts.repeatCount} repeat</span>
            ) : null}
          </div>
          <p className="overview-rx-starts__lead">Clinic paperwork can take time. Start when the prescription is ready.</p>
          {prescriptionStarts.items.length === 0 ? (
            <p className="overview-muted">No first orders or 30-day repeats just now.</p>
          ) : (
            <ul className="overview-priority-list">
              {prescriptionStarts.items.map(item => (
                <li key={item.id} className={`overview-rx-item overview-rx-item--${item.kind}`}>
                  <div>
                    <span className="overview-kind">{startKindLabel(item.kind)}</span>
                    <strong>{item.maskedPatientLabel}</strong>
                    <p className="overview-rx-meta">
                      <span>{startAgeLabel(item.kind, item.ageDays)}</span>
                      {item.lastOrderReference ? <span>{item.lastOrderReference}</span> : null}
                    </p>
                  </div>
                  {state.workspaceMode === 'live' ? (
                    <button
                      type="button"
                      className="priority-action"
                      aria-label={`Start prescription for ${item.maskedPatientLabel}`}
                      onClick={() => startPrescription(item.recordTarget.id)}
                    >
                      Start prescription <ArrowRight size={14} aria-hidden="true" />
                    </button>
                  ) : (
                    <span className="overview-muted">Orders unlock after pharmacy activation</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card overview-queue">
          <div className="section-heading">
            <div>
              <p className="section-label">Needs action</p>
              <h2><ListChecks size={18} aria-hidden="true" /> Priority queue</h2>
            </div>
            <span>{overview.priorityItems.length} open</span>
          </div>
          {overview.priorityItems.length === 0 ? (
            <div className="overview-empty">
              <CheckCircle2 aria-hidden="true" />
              <strong>No priority exceptions</strong>
              <span>There are no awaiting payments or aged collections in this summary.</span>
            </div>
          ) : (
            <ul className="overview-priority-list">
              {overview.priorityItems.map(item => (
                <li key={item.id} className={`overview-priority-item overview-priority-item--${item.kind}`}>
                  <div>
                    <span className="overview-kind">{kindLabels[item.kind]}</span>
                    <strong>{item.maskedPatientLabel}</strong>
                    <p className="overview-priority-meta">
                      {item.orderReference && <span>{item.orderReference}</span>}
                      <span>{ageLabel(item.kind, item.ageDays)}</span>
                    </p>
                    <p>{item.summary}</p>
                  </div>
                  <button className="priority-action" onClick={() => openRecord(item.recordTarget)}>
                    {item.actionLabel} <ArrowRight size={14} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card integration-health">
          <div className="section-heading">
            <div><p className="section-label">Service health</p><h2>Integrations</h2></div>
          </div>
          <ul>
            {overview.integrations.map(item => (
              <li key={item.integration}>
                <span>{item.integration}</span>
                <strong className={`integration-state integration-state--${item.state}`}>{stateLabel(item)}</strong>
                <small>{item.checkedAt ? `Checked ${formatAsOf(item.checkedAt)}` : 'No recent check'}</small>
              </li>
            ))}
          </ul>
        </section>
      </section>
    </div>
  );
}
