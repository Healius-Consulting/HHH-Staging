import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ArrowRight, CheckCircle2, ListChecks, Monitor, RefreshCw, ShieldCheck } from 'lucide-react';
import SummaryTiles from '../components/SummaryTiles';
import { useApp } from '../context/AppContext';
import { getPharmacyOverview, getStaffAccessibilityPreferences, updateStaffAccessibilityPreferences } from '../shared/api';
import type { PharmacyOverview as PharmacyOverviewContract, StaffAccessibilityPreferences } from '../shared/contracts';

type OverviewView = 'today' | 'handover';

const kindLabels: Record<PharmacyOverviewContract['priorityItems'][number]['kind'], string> = {
  payment: 'Payment',
  collection: 'Collection',
  cancellation: 'Cancellation',
  repeat: 'Repeat due',
  supplier: 'Supplier',
};

function normalizeOverviewView(value?: StaffAccessibilityPreferences['overviewView']): OverviewView {
  return value === 'handover' ? 'handover' : 'today';
}

function formatAsOf(value: string) {
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function stateLabel(state: PharmacyOverviewContract['integrations'][number]['state']) {
  return state.replace('-', ' ');
}

export default function PharmacyOverview() {
  const { dispatch } = useApp();
  const [overview, setOverview] = useState<PharmacyOverviewContract | null>(null);
  const [view, setView] = useState<OverviewView>('today');
  const [preferences, setPreferences] = useState<StaffAccessibilityPreferences | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const [nextOverview, nextPreferences] = await Promise.all([
        getPharmacyOverview(),
        getStaffAccessibilityPreferences(),
      ]);
      setOverview(nextOverview);
      setPreferences(nextPreferences);
      setView(normalizeOverviewView(nextPreferences.overviewView));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'The operational overview is unavailable.');
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const selectView = (nextView: OverviewView) => {
    setView(nextView);
    if (!preferences) return;
    const nextPreferences = { ...preferences, overviewView: nextView };
    setPreferences(nextPreferences);
    void updateStaffAccessibilityPreferences(nextPreferences).catch(() => {
      setError('Your view preference could not be saved. The overview data is still available.');
    });
  };

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
  const handoverMode = view === 'handover';

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
            {overview.organisation.allocationHoldingMode && <span className="status-badge status-badge--intake_live">Allocation holding</span>}
            <span>As of {formatAsOf(overview.asOf)}</span>
          </div>
        </div>
        <div className="secure-overview__actions">
          <button
            type="button"
            className={`btn ${handoverMode ? 'btn-primary' : 'btn-secondary'} overview-handover-toggle`}
            aria-pressed={handoverMode}
            onClick={() => selectView(handoverMode ? 'today' : 'handover')}
          >
            <Monitor size={16} aria-hidden="true" />
            {handoverMode ? 'Exit shared screen' : 'Shared screen mode'}
          </button>
          <button className="btn btn-secondary" onClick={() => void load()} disabled={refreshing} aria-label="Refresh pharmacy overview">
            <RefreshCw size={16} aria-hidden="true" /> {refreshing ? 'Refreshing' : 'Refresh'}
          </button>
        </div>
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
              HHH admin is reviewing {overview.enquiries.pendingCount === 1 ? 'the request' : 'these requests'}.
              Patient identity and health answers remain unavailable to the pharmacy unless HHH completes the referral and activates a patient record.
            </p>
          </div>
          <span className="status-badge status-badge--intake_live">With HHH admin</span>
        </section>
      )}

      {handoverMode ? (
        <section className="overview-panel handover-panel" aria-label="Shared screen handover">
          <div className="handover-privacy">
            <ShieldCheck aria-hidden="true" />
            <div>
              <h2>Shared-screen safe</h2>
              <p>This view contains queue totals and system health only. It does not display patient labels or contact details.</p>
            </div>
          </div>
          <div className="handover-grid">
            <article><span>Active patients</span><strong>{overview.handover.activePatients}</strong></article>
            <article><span>Active payment links</span><strong>{overview.handover.activePaymentLinks}</strong></article>
            <article><span>Supplier orders</span><strong>{overview.handover.supplierOrdersInProgress}</strong></article>
            <article><span>Aged collections</span><strong>{overview.handover.agedCollections}</strong></article>
          </div>
          <section className="card integration-health">
            <div className="section-heading">
              <div><p className="section-label">Service health</p><h2>Integrations</h2></div>
            </div>
            <ul>
              {overview.integrations.map(item => (
                <li key={item.integration}>
                  <span>{item.integration}</span>
                  <strong className={`integration-state integration-state--${item.state}`}>{stateLabel(item.state)}</strong>
                  <small>{item.checkedAt ? `Checked ${formatAsOf(item.checkedAt)}` : 'No recent check'}</small>
                </li>
              ))}
            </ul>
          </section>
        </section>
      ) : (
        <section className="overview-panel overview-today" aria-label="Today">
          {overview.summary.urgentTotal > 0 && (
            <p className="page-status-note" role="status">
              <strong>{overview.summary.urgentTotal}</strong> item{overview.summary.urgentTotal === 1 ? '' : 's'} need attention today.
            </p>
          )}

          <SummaryTiles
            className="summary-tiles--compact"
            label="Today's workflow"
            items={[
              {
                label: 'Patients',
                value: overview.summary.activePatients,
                detail: 'Activated by HHH',
                onClick: () => openScreen('patients'),
              },
              {
                label: 'Payment',
                value: overview.summary.awaitingPayment,
                detail: 'Awaiting payment',
                onClick: () => openScreen('orders'),
              },
              {
                label: 'Supplier',
                value: overview.summary.supplierFulfilment,
                detail: 'In fulfilment',
                onClick: () => openScreen('orders'),
              },
              {
                label: 'Collection',
                value: overview.summary.readyForCollection,
                detail: 'Ready for collection',
                onClick: () => openScreen('orders'),
              },
            ]}
          />

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
                <span>There are no aged or urgent cases in this summary.</span>
              </div>
            ) : (
              <ul className="overview-priority-list">
                {overview.priorityItems.map(item => (
                  <li key={item.id}>
                    <div>
                      <span className="overview-kind">{kindLabels[item.kind]}</span>
                      <strong>{item.maskedPatientLabel}</strong>
                      <p className="overview-priority-meta">
                        <span>{item.orderReference}</span>
                        <span>{item.ageDays} day{item.ageDays === 1 ? '' : 's'} in queue</span>
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
                  <strong className={`integration-state integration-state--${item.state}`}>{stateLabel(item.state)}</strong>
                  <small>{item.checkedAt ? `Checked ${formatAsOf(item.checkedAt)}` : 'No recent check'}</small>
                </li>
              ))}
            </ul>
          </section>
        </section>
      )}
    </div>
  );
}
