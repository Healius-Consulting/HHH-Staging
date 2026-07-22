import { Activity, ArrowRight, ListTodo, History, FileText, Plus } from 'lucide-react';
import { orderRevenue, useApp } from '../context/AppContext';
import SummaryTiles from '../components/SummaryTiles';
import { compactPatientName } from '../utils/patientName';

export default function Dashboard() {
  const { state, dispatch } = useApp();
  const organisationId = state.currentOrganisationId;
  const tenantOrders = state.orders.filter(order => order.organisationId === organisationId);
  const tenantPatients = state.crm.filter(patient => patient.organisationId === organisationId);
  const curaleafIntegration = state.platformIntegrations.find(integration => integration.id === 'curaleaf');

  /* ── Computed stats ── */
  const newReferrals = state.submissions.filter(s => s.organisationId === organisationId && (s.status === 'New' || s.status === 'Under HHH review')).length;
  const awaitingPayment = tenantOrders.filter(o => o.payment.status === 'sent').length;

  const inFulfilment = tenantOrders.filter(o =>
    o.payment.status === 'paid' &&
    o.prescriptions.some(rx => !['ready', 'collected'].includes(rx.status))
  ).length;

  const readyForCollection = tenantOrders.filter(o =>
    o.payment.status === 'paid' &&
    o.prescriptions.length > 0 &&
    o.prescriptions.every(rx => rx.status === 'ready')
  ).length;

  // 1. Uncollected warnings (10+ days)
  const uncollectedAlerts = tenantOrders.flatMap(o => {
    const pName = tenantPatients.find(p => p.id === o.patientId)?.name ?? 'Unknown';
    const pMobile = tenantPatients.find(p => p.id === o.patientId)?.mobile ?? '';
    return o.prescriptions
      .filter(rx => rx.status === 'ready' && rx.readyAt && (Date.now() - new Date(rx.readyAt).getTime()) >= 10 * 24 * 60 * 60 * 1000)
      .map(rx => ({
        type: 'uncollected' as const,
        id: `uncollected-${o.id}-${rx.id}`,
        patientName: pName,
        patientMobile: pMobile,
        patientId: o.patientId ?? '',
        orderId: o.id,
        rxId: rx.id,
        days: Math.floor((Date.now() - new Date(rx.readyAt!).getTime()) / (1000 * 60 * 60 * 24)),
      }));
  });

  // 2. Overdue payments (3+ days)
  const overduePaymentAlerts = tenantOrders
    .filter(o => o.payment.status === 'sent' && o.payment.sentAt && (Date.now() - new Date(o.payment.sentAt).getTime()) >= 3 * 24 * 60 * 60 * 1000)
    .map(o => {
      const pName = tenantPatients.find(p => p.id === o.patientId)?.name ?? 'Unknown';
      const pEmail = tenantPatients.find(p => p.id === o.patientId)?.email ?? '';
      const amount = orderRevenue(o);
      return {
        type: 'payment' as const,
        id: `payment-${o.id}`,
        patientName: pName,
        patientEmail: pEmail,
        patientId: o.patientId ?? '',
        orderId: o.id,
        amount,
        days: Math.floor((Date.now() - new Date(o.payment.sentAt!).getTime()) / (1000 * 60 * 60 * 24)),
      };
    });

  // 3. Repeat overdue (30+ days)
  const repeatAlerts = tenantPatients.map(p => {
    const pOrders = tenantOrders.filter(o => o.patientId === p.id);
    if (pOrders.length === 0) return null;
    const latestOrder = [...pOrders].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];
    const daysSince = Math.floor((Date.now() - new Date(latestOrder.date).getTime()) / (1000 * 60 * 60 * 24));
    if (daysSince >= 30) {
      return {
        type: 'repeat' as const,
        id: `repeat-${p.id}`,
        patientName: p.name,
        patientId: p.id,
        days: daysSince,
      };
    }
    return null;
  }).filter((x): x is NonNullable<typeof x> => x !== null);

  // 4. Intake Pending Bottleneck (> 48h)
  const intakeAlerts = state.submissions
    .filter(s => s.organisationId === organisationId && (s.status === 'New' || s.status === 'Under HHH review') && (Date.now() - new Date(s.submittedAt).getTime()) >= 48 * 60 * 60 * 1000)
    .map(s => ({
      type: 'intake' as const,
      id: `intake-${s.id}`,
      patientName: s.name,
      condition: s.condition,
      subId: s.id,
      days: Math.floor((Date.now() - new Date(s.submittedAt).getTime()) / (1000 * 60 * 60 * 24)),
    }));

  const totalUrgent = uncollectedAlerts.length + overduePaymentAlerts.length + repeatAlerts.length + intakeAlerts.length;

  /* ── Recent orders (last 5) ── */
  const recentOrders = [...tenantOrders]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 5);

  const patientName = (patientId: string | null) => {
    if (!patientId) return 'Unassigned';
    return tenantPatients.find(p => p.id === patientId)?.name ?? 'Unknown';
  };

  const paymentPill = (status: string) => {
    switch (status) {
      case 'paid': return <span className="pill pill-green">Paid</span>;
      case 'sent': return <span className="pill pill-amber">Awaiting</span>;
      default:     return <span className="pill pill-neutral">Draft</span>;
    }
  };

  return (
    <div className="page-body operations-dashboard">
      <section className="operations-brief">
        <div className="operations-brief__lead">
          <p className="section-label">Operations overview</p>
          <h2>Manage today’s pharmacy workload</h2>
          <p>{totalUrgent > 0 ? `${totalUrgent} item${totalUrgent === 1 ? '' : 's'} require attention. Start with the priority queue, then continue through the normal workflow.` : 'There are no overdue clinical, payment or collection actions at the moment.'}</p>
        </div>
        <button className="btn btn-primary operations-brief__action" onClick={() => dispatch({ type: 'SET_SCREEN', screen: 'create' })}>
          <Plus size={15} /> Start prescription
        </button>
        <SummaryTiles label="Pharmacy workflow summary" items={[
          { label: 'Patient review', value: newReferrals, detail: 'awaiting decisions', onClick: () => dispatch({ type: 'SET_SCREEN', screen: 'referrals' }) },
          { label: 'Payments', value: awaitingPayment, detail: 'awaiting action', onClick: () => dispatch({ type: 'SET_SCREEN', screen: 'review' }) },
          { label: 'Supplier', value: inFulfilment, detail: 'in fulfilment', onClick: () => dispatch({ type: 'SET_SCREEN', screen: 'orders' }) },
          { label: 'Collection', value: readyForCollection, detail: 'ready', onClick: () => dispatch({ type: 'SET_SCREEN', screen: 'orders' }) },
        ]} />
      </section>

      <div className="page-grid-main">
        <div className="page-stack">
          
          {totalUrgent > 0 && (
            <section className="card card-urgent priority-queue">
              <div className="section-heading"><div><p className="section-label">Attention required</p><h3><Activity size={17} /> Priority work queue</h3></div><span>{totalUrgent} open</span></div>
              <div className="alert-list">
                {intakeAlerts.map(alert => (
                  <div key={alert.id} className="alert-item alert-item--danger">
                    <div className="alert-item__copy">
                      <span className="alert-item__category">Eligibility review</span>
                      <span className="alert-item__title">{alert.patientName}</span>
                      <span className="alert-item__desc">
                        Submitted <strong className="text-red">{alert.days} days ago</strong> for{' '}
                        <strong className="text-primary">{alert.condition}</strong>. Review is pending.
                      </span>
                    </div>
                    <button className="priority-action" onClick={() => dispatch({ type: 'SET_SCREEN', screen: 'referrals' })}>
                      Review patient <ArrowRight size={14} />
                    </button>
                  </div>
                ))}

                {uncollectedAlerts.map(alert => (
                  <div key={alert.id} className="alert-item alert-item--danger">
                    <div className="alert-item__copy">
                      <span className="alert-item__category">Collection follow-up</span>
                      <span className="alert-item__title">{alert.patientName}</span>
                      <span className="alert-item__desc">
                        Ready for collection for <strong className="text-red">{alert.days} days</strong>. Contact: {alert.patientMobile}
                      </span>
                    </div>
                    <button
                      className="priority-action"
                      onClick={() => {
                        dispatch({ type: 'ADD_TOAST', message: `SMS reminder resent to ${alert.patientName} (${alert.patientMobile}).`, toastType: 'success' });
                        dispatch({ type: 'LOG_INTERACTION', patientId: alert.patientId, interactionType: 'SMS Reminder', detail: `Resent counter pickup notification SMS to ${alert.patientMobile}.` });
                      }}
                    >
                      Send reminder <ArrowRight size={14} />
                    </button>
                  </div>
                ))}

                {overduePaymentAlerts.map(alert => (
                  <div key={alert.id} className="alert-item alert-item--warning">
                    <div className="alert-item__copy">
                      <span className="alert-item__category">Overdue payment</span>
                      <span className="alert-item__title">{alert.patientName}</span>
                      <span className="alert-item__desc">
                        <strong className="text-primary">£{alert.amount.toFixed(2)}</strong> outstanding for{' '}
                        <strong className="text-amber">{alert.days} days</strong>. {alert.patientEmail}
                      </span>
                    </div>
                    <button
                      className="priority-action"
                      onClick={() => {
                        dispatch({ type: 'ADD_TOAST', message: `Worldpay billing link resent to ${alert.patientName} at ${alert.patientEmail}.`, toastType: 'info' });
                        dispatch({ type: 'LOG_INTERACTION', patientId: alert.patientId, interactionType: 'Payment Link Resent', detail: `Resent Worldpay invoice link for £${alert.amount.toFixed(2)} to ${alert.patientEmail}.` });
                      }}
                    >
                      Resend link <ArrowRight size={14} />
                    </button>
                  </div>
                ))}

                {repeatAlerts.map(alert => (
                  <div key={alert.id} className="alert-item alert-item--info">
                    <div className="alert-item__copy">
                      <span className="alert-item__category">Repeat prescription</span>
                      <span className="alert-item__title">{alert.patientName}</span>
                      <span className="alert-item__desc">
                        Last order <strong className="text-info">{alert.days} days ago</strong>. Treatment gap exceeds guidelines.
                      </span>
                    </div>
                    <div className="priority-action-group">
                      <button
                        className="priority-action priority-action--quiet"
                        onClick={() => {
                          dispatch({ type: 'ADD_TOAST', message: `Follow-up logged for ${alert.patientName}.`, toastType: 'success' });
                          dispatch({ type: 'LOG_INTERACTION', patientId: alert.patientId, interactionType: 'Callback Scheduled', detail: 'Scheduled repeat prescription assessment call.' });
                        }}
                      >
                        Log follow-up
                      </button>
                      <button
                        className="priority-action"
                        onClick={() => {
                          dispatch({ type: 'LOG_INTERACTION', patientId: alert.patientId, interactionType: 'Repeat Rx Initiated', detail: 'Created new repeat prescription order session from dashboard.' });
                          dispatch({ type: 'NEW_ORDER', patientId: alert.patientId });
                          dispatch({ type: 'SET_SCREEN', screen: 'create' });
                        }}
                      >
                        Create repeat <ArrowRight size={14} />
                      </button>
                    </div>
                  </div>
                ))}

              </div>
            </section>
          )}

          {/* Recent Pharmacy Sessions */}
          <section className="card card-flush activity-ledger">
            <div className="section-heading section-heading--padded"><div><p className="section-label">Activity ledger</p><h3><History size={16} /> Recent pharmacy sessions</h3><p>Continue a draft or inspect the latest prescription activity.</p></div><span>{recentOrders.length} latest</span></div>
            {recentOrders.length === 0 ? (
              <div className="empty-state">No active sessions or order history.</div>
            ) : (
              <div className="session-ledger">
                <div className="session-ledger__head" aria-hidden="true"><span>Date</span><span>Patient</span><span>Payment</span><span>Action</span></div>
                <div role="list">
                {recentOrders.map(order => {
                  const sessionDate = new Date(order.date);
                  const openSession = () => {
                    dispatch({ type: 'SET_ACTIVE_ORDER', orderId: order.id });
                    dispatch({ type: 'SET_SCREEN', screen: 'create' });
                  };
                  return (
                    <div className="session-ledger__row" role="listitem" key={order.id}>
                      <time className="session-ledger__date" dateTime={sessionDate.toISOString()}>
                        <strong>{sessionDate.toLocaleDateString('en-GB', { day: '2-digit' })}</strong>
                        <span>{sessionDate.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}</span>
                      </time>
                      <div className="session-ledger__patient">
                        <button type="button" onClick={openSession} title={patientName(order.patientId)}>{compactPatientName(patientName(order.patientId))}</button>
                        <span>{order.prescriptions.length} prescription{order.prescriptions.length === 1 ? '' : 's'} · {sessionDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                      <div className="session-ledger__status"><small>Payment</small>{paymentPill(order.payment.status)}</div>
                      <button type="button" className="session-ledger__open" onClick={openSession} aria-label={`Open ${patientName(order.patientId)} prescription session`}>
                        {order.payment.status === 'none' ? 'Continue' : 'Review'} <ArrowRight size={14} aria-hidden="true" />
                      </button>
                    </div>
                  );
                })}
                </div>
              </div>
            )}
          </section>

        </div>

        {/* RIGHT COLUMN: Operational Checklist */}
        <aside className="card card-surface duty-sidebar">
          <div className="section-heading"><div><p className="section-label">Shift handover</p><h3><ListTodo size={16} /> Pharmacist duties</h3></div></div>

          <div className="duty-list">
            <div className="duty-item">
              <input type="checkbox" checked={newReferrals === 0} readOnly aria-label="Onboarding status reviewed" />
              <div>
                <span className="font-semibold" style={{ display: 'block' }}>Review onboarding status</span>
                <span className="text-muted text-xs">{newReferrals} pharmacy-attributed enquiries are still with HHH for review.</span>
              </div>
            </div>
            <div className="duty-item">
              <input type="checkbox" checked={awaitingPayment === 0} readOnly aria-label="Outstanding billing links cleared" />
              <div>
                <span className="font-semibold" style={{ display: 'block' }}>Outstanding Billing Links</span>
                <span className="text-muted text-xs">{awaitingPayment} Worldpay requests currently active.</span>
              </div>
            </div>
            <div className="duty-item">
              <input type="checkbox" checked={inFulfilment === 0} readOnly aria-label="Supply chain review complete" />
              <div>
                <span className="font-semibold" style={{ display: 'block' }}>Supply Chain Review</span>
                <span className="text-muted text-xs">{inFulfilment} orders processing with Curaleaf.</span>
              </div>
            </div>
          </div>

          <div className="divider" style={{ margin: '4px 0' }} />

          <div className="integration-note">
            <h4><FileText size={12} /> Curaleaf Integration</h4>
            <p>{curaleafIntegration?.status === 'connected' ? 'Connected to Curaleaf Rocky. Supplier orders and shipment events are available.' : 'Platform connection is pending live Curaleaf credentials. The configured formulary remains available for workflow testing.'}</p>
          </div>
        </aside>

      </div>
    </div>
  );
}
