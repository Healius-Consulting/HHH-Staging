import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ArrowRight, CheckCircle2, Clock3, Columns3, ListChecks, RefreshCw, ShieldCheck } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { getPharmacyOverview, getStaffAccessibilityPreferences, updateStaffAccessibilityPreferences } from '../shared/api';
import type { PharmacyOverview as PharmacyOverviewContract, StaffAccessibilityPreferences } from '../shared/contracts';

type OverviewView = NonNullable<StaffAccessibilityPreferences['overviewView']>;

const views: Array<{ id: OverviewView; label: string; description: string }> = [
  { id: 'operations', label: 'Daily operations', description: 'Priority work and recent activity' },
  { id: 'pipeline', label: 'Workflow pipeline', description: 'Queue ageing and bottlenecks' },
  { id: 'handover', label: 'Secure handover', description: 'A zero-PII shared-screen view' },
];

const workflow = [
  { key: 'activePatients', label: 'Patients', detail: 'Activated by HHH' },
  { key: 'awaitingPayment', label: 'Payment', detail: 'Awaiting payment' },
  { key: 'supplierFulfilment', label: 'Supplier', detail: 'In fulfilment' },
  { key: 'readyForCollection', label: 'Collection', detail: 'Ready for collection' },
] as const;

function formatAsOf(value: string) {
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function stateLabel(state: PharmacyOverviewContract['integrations'][number]['state']) {
  return state.replace('-', ' ');
}

export default function PharmacyOverview() {
  const { dispatch } = useApp();
  const [overview, setOverview] = useState<PharmacyOverviewContract | null>(null);
  const [view, setView] = useState<OverviewView>('operations');
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
      setView(nextPreferences.overviewView ?? 'operations');
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

  const moveViewFocus = (current: OverviewView, key: string) => {
    const currentIndex = views.findIndex(item => item.id === current);
    const nextIndex = key === 'Home' ? 0 : key === 'End' ? views.length - 1 : key === 'ArrowLeft' ? (currentIndex - 1 + views.length) % views.length : key === 'ArrowRight' ? (currentIndex + 1) % views.length : currentIndex;
    if (nextIndex === currentIndex && !['Home', 'End'].includes(key)) return;
    const next = views[nextIndex]!;
    selectView(next.id);
    requestAnimationFrame(() => document.getElementById(`overview-tab-${next.id}`)?.focus());
  };

  const openRecord = (target: PharmacyOverviewContract['priorityItems'][number]['recordTarget']) => {
    if (target.kind === 'order') {
      dispatch({ type: 'SET_NAVIGATION_TARGET', target: { kind: 'order', key: target.id } });
      dispatch({ type: 'SET_SCREEN', screen: 'orders' });
      return;
    }
    if (target.kind === 'patient') dispatch({ type: 'SET_NAVIGATION_TARGET', target: { kind: 'patient', id: target.id } });
    dispatch({ type: 'SET_SCREEN', screen: 'patients' });
  };

  if (!overview && refreshing) {
    return <div className="page-body"><section className="overview-state" aria-busy="true"><span className="spinner" aria-hidden="true" /><h2>Loading pharmacy overview</h2><p>Retrieving the authorised operational summary.</p></section></div>;
  }

  if (!overview) {
    return <div className="page-body"><section className="overview-state" role="alert"><AlertTriangle aria-hidden="true" /><h2>Overview unavailable</h2><p>{error}</p><button className="btn btn-primary" onClick={() => void load()}><RefreshCw size={16} /> Try again</button></section></div>;
  }

  const isStale = Date.now() - new Date(overview.asOf).getTime() > 5 * 60 * 1000;

  return (
    <div className="page-body secure-overview">
      <header className="secure-overview__header">
        <div>
          <p className="section-label">Authenticated pharmacy workspace</p>
          <h1>{overview.organisation.tradingName}</h1>
          <div className="secure-overview__identity">
            <span className={`status-badge status-badge--${overview.organisation.status}`}>{overview.organisation.status.replace('_', ' ')}</span>
            {overview.organisation.trainingMode && <span className="status-badge status-badge--training">Training data</span>}
            {overview.organisation.allocationHoldingMode && <span className="status-badge status-badge--intake_live">Allocation holding</span>}
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

      <div className="overview-view-switcher" role="tablist" aria-label="Overview view">
        {views.map(item => (
          <button key={item.id} id={`overview-tab-${item.id}`} type="button" role="tab" tabIndex={view === item.id ? 0 : -1} aria-selected={view === item.id} aria-controls={`overview-${item.id}`} className={view === item.id ? 'is-active' : ''} onClick={() => selectView(item.id)} onKeyDown={event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) event.preventDefault(); moveViewFocus(item.id, event.key); }}>
            <span>{item.label}</span><small>{item.description}</small>
          </button>
        ))}
      </div>

      {view === 'operations' && (
        <section id="overview-operations" role="tabpanel" className="overview-panel" aria-labelledby="overview-tab-operations">
          <div className="overview-summary-grid" aria-label="Workflow summary">
            {workflow.map(item => <article className="overview-summary-tile" key={item.key}><span>{item.label}</span><strong>{overview.summary[item.key]}</strong><small>{item.detail}</small></article>)}
            <article className="overview-summary-tile overview-summary-tile--urgent"><span>Urgent</span><strong>{overview.summary.urgentTotal}</strong><small>Needs attention</small></article>
          </div>

          <div className="overview-two-column">
            <section className="card overview-queue">
              <div className="section-heading"><div><p className="section-label">Attention required</p><h2><ListChecks size={18} aria-hidden="true" /> Priority queue</h2></div><span>{overview.priorityItems.length} open</span></div>
              {overview.priorityItems.length === 0 ? <div className="overview-empty"><CheckCircle2 aria-hidden="true" /><strong>No priority exceptions</strong><span>There are no aged or urgent cases in this summary.</span></div> : (
                <ul className="overview-priority-list">
                  {overview.priorityItems.map(item => <li key={`${item.kind}-${item.id}`}><div><span className="overview-kind">{item.kind}</span><strong>{item.maskedPatientLabel}</strong><p>{item.summary}</p><small>{item.ageDays} day{item.ageDays === 1 ? '' : 's'} in queue</small></div><button className="priority-action" onClick={() => openRecord(item.recordTarget)}>Open record <ArrowRight size={14} aria-hidden="true" /></button></li>)}
                </ul>
              )}
            </section>

            <aside className="card overview-recent">
              <div className="section-heading"><div><p className="section-label">Authorised summary</p><h2><Clock3 size={18} aria-hidden="true" /> Recent sessions</h2></div></div>
              {overview.recentSessions.length === 0 ? <p className="overview-muted">No recent sessions.</p> : <ul>{overview.recentSessions.map(session => <li key={session.orderId}><div><strong>{session.maskedPatientLabel}</strong><span>{session.prescriptionCount} prescription{session.prescriptionCount === 1 ? '' : 's'}</span></div><span className="status-badge">{session.status}</span></li>)}</ul>}
            </aside>
          </div>
        </section>
      )}

      {view === 'pipeline' && (
        <section id="overview-pipeline" role="tabpanel" className="overview-panel" aria-labelledby="overview-tab-pipeline">
          <div className="pipeline-grid">
            {workflow.map((item, index) => {
              const related = overview.priorityItems.filter(priority => index === 0 ? priority.kind === 'repeat' : index === 1 ? priority.kind === 'payment' : index === 2 ? priority.kind === 'supplier' || priority.kind === 'cancellation' : priority.kind === 'collection');
              const oldest = related.reduce((max, record) => Math.max(max, record.ageDays), 0);
              return <article className="pipeline-stage" key={item.key}><span className="pipeline-stage__number">{index + 1}</span><h2>{item.label}</h2><strong>{overview.summary[item.key]}</strong><p>{item.detail}</p><div><span>{related.length} exceptions</span><span>{oldest ? `Oldest ${oldest}d` : 'No aged cases'}</span></div></article>;
            })}
          </div>
          <div className="card pipeline-note"><Columns3 aria-hidden="true" /><div><h2>Aggregate workflow view</h2><p>Counts and ageing are computed by the server for this pharmacy. Contact details are intentionally excluded.</p></div></div>
        </section>
      )}

      {view === 'handover' && (
        <section id="overview-handover" role="tabpanel" className="overview-panel handover-panel" aria-labelledby="overview-tab-handover">
          <div className="handover-privacy"><ShieldCheck aria-hidden="true" /><div><h2>Shared-screen safe</h2><p>This view contains queue totals and system health only. It does not display patient labels or contact details.</p></div></div>
          <div className="handover-grid">
            <article><span>Active patients</span><strong>{overview.handover.activePatients}</strong></article>
            <article><span>Active payment links</span><strong>{overview.handover.activePaymentLinks}</strong></article>
            <article><span>Supplier orders</span><strong>{overview.handover.supplierOrdersInProgress}</strong></article>
            <article><span>Aged collections</span><strong>{overview.handover.agedCollections}</strong></article>
          </div>
          <section className="card integration-health"><div className="section-heading"><div><p className="section-label">Service health</p><h2>Integrations</h2></div></div><ul>{overview.integrations.map(item => <li key={item.integration}><span>{item.integration}</span><strong className={`integration-state integration-state--${item.state}`}>{stateLabel(item.state)}</strong><small>{item.checkedAt ? `Checked ${formatAsOf(item.checkedAt)}` : 'No recent check'}</small></li>)}</ul></section>
        </section>
      )}
    </div>
  );
}
