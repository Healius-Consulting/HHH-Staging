import { Activity, CreditCard, Package, CheckCircle, ListTodo, History, FileText } from 'lucide-react';
import { useApp } from '../context/AppContext';

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
    o.prescriptions.some(rx => rx.status !== 'ready')
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
      const amount = o.prescriptions.reduce((sum, rx) => sum + rx.items.reduce((s, item) => s + (item.retail * item.qty + (item.fee || 0)), 0), 0);
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

  // 5. Patient Portal Requests
  const portalRequests = tenantPatients.flatMap(p => {
    const alerts: {
      type: 'repeat-req' | 'appointment-req';
      id: string;
      patientName: string;
      patientId: string;
      timeStr: string;
      ts: Date;
    }[] = [];

    const interactions = p.interactions || [];

    // Find latest Repeat Request
    const repeatReqs = interactions.filter(i => i.type === 'Repeat Requested');
    if (repeatReqs.length > 0) {
      const latestReq = [...repeatReqs].sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())[0];
      const repeatResolves = interactions.filter(i => i.type === 'Repeat Rx Initiated' || i.type === 'Request Resolved');
      const latestResolve = repeatResolves.length > 0 
        ? [...repeatResolves].sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())[0]
        : null;

      if (!latestResolve || new Date(latestReq.ts).getTime() > new Date(latestResolve.ts).getTime()) {
        alerts.push({
          type: 'repeat-req',
          id: `repeat-req-${p.id}`,
          patientName: p.name,
          patientId: p.id,
          timeStr: new Date(latestReq.ts).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
          ts: new Date(latestReq.ts),
        });
      }
    }

    // Find latest Appointment Request
    const apptReqs = interactions.filter(i => i.type === 'Appointment Requested');
    if (apptReqs.length > 0) {
      const latestReq = [...apptReqs].sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())[0];
      const apptResolves = interactions.filter(i => i.type === 'Callback Scheduled' || i.type === 'Request Resolved');
      const latestResolve = apptResolves.length > 0 
        ? [...apptResolves].sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())[0]
        : null;

      if (!latestResolve || new Date(latestReq.ts).getTime() > new Date(latestResolve.ts).getTime()) {
        alerts.push({
          type: 'appointment-req',
          id: `appt-req-${p.id}`,
          patientName: p.name,
          patientId: p.id,
          timeStr: new Date(latestReq.ts).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
          ts: new Date(latestReq.ts),
        });
      }
    }

    return alerts;
  });

  const totalUrgent = uncollectedAlerts.length + overduePaymentAlerts.length + repeatAlerts.length + intakeAlerts.length + portalRequests.length;

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
    <div className="page-body">
      {/* ══ Stats Grid ══ */}
      <div className="stats-grid">
        <div className="card card-surface stat-card" onClick={() => dispatch({ type: 'SET_SCREEN', screen: 'referrals' })}>
          <div className="stat-card__head">
            <span className="stat-card__label">Awaiting HHH Decisions</span>
            <Activity size={18} className="text-info" />
          </div>
          <div className="flex items-baseline gap-xs">
            <span className="stat-card__value">{newReferrals}</span>
            <span className="stat-card__meta">pending review</span>
          </div>
        </div>

        <div className="card card-surface stat-card" onClick={() => dispatch({ type: 'SET_SCREEN', screen: 'review' })}>
          <div className="stat-card__head">
            <span className="stat-card__label">Awaiting Payments</span>
            <CreditCard size={18} className="text-amber" />
          </div>
          <div className="flex items-baseline gap-xs">
            <span className="stat-card__value">{awaitingPayment}</span>
            <span className="stat-card__meta">links active</span>
          </div>
        </div>

        <div className="card card-surface stat-card" onClick={() => dispatch({ type: 'SET_SCREEN', screen: 'orders' })}>
          <div className="stat-card__head">
            <span className="stat-card__label">In Fulfilment</span>
            <Package size={18} className="text-info" />
          </div>
          <div className="flex items-baseline gap-xs">
            <span className="stat-card__value">{inFulfilment}</span>
            <span className="stat-card__meta">supplier orders</span>
          </div>
        </div>

        <div className="card card-surface stat-card" onClick={() => dispatch({ type: 'SET_SCREEN', screen: 'orders' })}>
          <div className="stat-card__head">
            <span className="stat-card__label">Ready for Collection</span>
            <CheckCircle size={18} className="text-green" />
          </div>
          <div className="flex items-baseline gap-xs">
            <span className="stat-card__value">{readyForCollection}</span>
            <span className="stat-card__meta">patient alerts sent</span>
          </div>
        </div>
      </div>

      <div className="page-grid-main">
        <div className="page-stack">
          
          {/* Urgent Actions Section */}
          {totalUrgent > 0 && (
            <div className="card card-urgent">
              <h3 className="card-title flex items-center gap-sm">
                <Activity size={18} /> Urgent Action Items ({totalUrgent})
              </h3>
              <div className="alert-list">
                {intakeAlerts.map(alert => (
                  <div key={alert.id} className="alert-item alert-item--danger">
                    <div>
                      <span className="alert-item__title">Pending Eligibility Intake · {alert.patientName}</span>
                      <span className="alert-item__desc">
                        Submitted <strong className="text-red">{alert.days} days ago</strong> for{' '}
                        <strong className="text-primary">{alert.condition}</strong>. Review is pending.
                      </span>
                    </div>
                    <button className="btn btn-sm btn-danger-solid" onClick={() => dispatch({ type: 'SET_SCREEN', screen: 'referrals' })}>
                      Review Records
                    </button>
                  </div>
                ))}

                {uncollectedAlerts.map(alert => (
                  <div key={alert.id} className="alert-item alert-item--danger">
                    <div>
                      <span className="alert-item__title">Uncollected Medication · {alert.patientName}</span>
                      <span className="alert-item__desc">
                        Ready for collection for <strong className="text-red">{alert.days} days</strong>. Contact: {alert.patientMobile}
                      </span>
                    </div>
                    <button
                      className="btn btn-sm btn-danger-solid"
                      onClick={() => {
                        dispatch({ type: 'ADD_TOAST', message: `SMS reminder resent to ${alert.patientName} (${alert.patientMobile}).`, toastType: 'success' });
                        dispatch({ type: 'LOG_INTERACTION', patientId: alert.patientId, interactionType: 'SMS Reminder', detail: `Resent counter pickup notification SMS to ${alert.patientMobile}.` });
                      }}
                    >
                      Resend SMS
                    </button>
                  </div>
                ))}

                {overduePaymentAlerts.map(alert => (
                  <div key={alert.id} className="alert-item alert-item--warning">
                    <div>
                      <span className="alert-item__title">Overdue Payment · {alert.patientName}</span>
                      <span className="alert-item__desc">
                        <strong className="text-primary">£{alert.amount.toFixed(2)}</strong> outstanding for{' '}
                        <strong className="text-amber">{alert.days} days</strong>. {alert.patientEmail}
                      </span>
                    </div>
                    <button
                      className="btn btn-sm btn-warning-outline"
                      onClick={() => {
                        dispatch({ type: 'ADD_TOAST', message: `Worldpay billing link resent to ${alert.patientName} at ${alert.patientEmail}.`, toastType: 'info' });
                        dispatch({ type: 'LOG_INTERACTION', patientId: alert.patientId, interactionType: 'Payment Link Resent', detail: `Resent Worldpay invoice link for £${alert.amount.toFixed(2)} to ${alert.patientEmail}.` });
                      }}
                    >
                      Resend Link
                    </button>
                  </div>
                ))}

                {repeatAlerts.map(alert => (
                  <div key={alert.id} className="alert-item alert-item--info">
                    <div>
                      <span className="alert-item__title">Repeat Rx Overdue · {alert.patientName}</span>
                      <span className="alert-item__desc">
                        Last order <strong className="text-info">{alert.days} days ago</strong>. Treatment gap exceeds guidelines.
                      </span>
                    </div>
                    <div className="flex gap-xs flex-wrap">
                      <button
                        className="btn btn-sm"
                        onClick={() => {
                          dispatch({ type: 'ADD_TOAST', message: `Follow-up logged for ${alert.patientName}.`, toastType: 'success' });
                          dispatch({ type: 'LOG_INTERACTION', patientId: alert.patientId, interactionType: 'Callback Scheduled', detail: 'Scheduled repeat prescription assessment call.' });
                        }}
                      >
                        Log Callback
                      </button>
                      <button
                        className="btn btn-sm btn-primary"
                        onClick={() => {
                          dispatch({ type: 'LOG_INTERACTION', patientId: alert.patientId, interactionType: 'Repeat Rx Initiated', detail: 'Created new repeat prescription order session from dashboard.' });
                          dispatch({ type: 'NEW_ORDER', patientId: alert.patientId });
                          dispatch({ type: 'SET_SCREEN', screen: 'create' });
                        }}
                      >
                        Create Repeat Rx
                      </button>
                    </div>
                  </div>
                ))}

                {portalRequests.filter(r => r.type === 'repeat-req').map(alert => (
                  <div key={alert.id} className="alert-item alert-item--success">
                    <div>
                      <span className="alert-item__title">Portal: Repeat Prescription · {alert.patientName}</span>
                      <span className="alert-item__desc">Requested via patient portal on {alert.timeStr}.</span>
                    </div>
                    <div className="flex gap-xs flex-wrap">
                      <button
                        className="btn btn-sm btn-success-solid"
                        onClick={() => {
                          dispatch({ type: 'LOG_INTERACTION', patientId: alert.patientId, interactionType: 'Repeat Rx Initiated', detail: 'Repeat prescription from patient portal request.' });
                          dispatch({ type: 'NEW_ORDER', patientId: alert.patientId });
                          dispatch({ type: 'SET_SCREEN', screen: 'create' });
                          dispatch({ type: 'ADD_TOAST', message: `Initiating repeat Rx for ${alert.patientName}.`, toastType: 'info' });
                        }}
                      >
                        Create Repeat Rx
                      </button>
                      <button
                        className="btn btn-sm"
                        onClick={() => {
                          dispatch({ type: 'LOG_INTERACTION', patientId: alert.patientId, interactionType: 'Request Resolved', detail: 'Dismissed portal repeat request.' });
                          dispatch({ type: 'ADD_TOAST', message: 'Request dismissed.', toastType: 'info' });
                        }}
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                ))}

                {portalRequests.filter(r => r.type === 'appointment-req').map(alert => (
                  <div key={alert.id} className="alert-item alert-item--info">
                    <div>
                      <span className="alert-item__title">Portal: Schedule Check-up · {alert.patientName}</span>
                      <span className="alert-item__desc">Check-up requested via portal on {alert.timeStr}.</span>
                    </div>
                    <div className="flex gap-xs flex-wrap">
                      <button
                        className="btn btn-sm btn-primary"
                        onClick={() => {
                          dispatch({ type: 'LOG_INTERACTION', patientId: alert.patientId, interactionType: 'Callback Scheduled', detail: 'Scheduled patient-requested check-up call.' });
                          dispatch({ type: 'ADD_TOAST', message: `Callback scheduled for ${alert.patientName}.`, toastType: 'success' });
                        }}
                      >
                        Log Callback
                      </button>
                      <button
                        className="btn btn-sm"
                        onClick={() => {
                          dispatch({ type: 'LOG_INTERACTION', patientId: alert.patientId, interactionType: 'Request Resolved', detail: 'Dismissed portal appointment request.' });
                          dispatch({ type: 'ADD_TOAST', message: 'Request dismissed.', toastType: 'info' });
                        }}
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recent Pharmacy Sessions */}
          <div className="card card-flush">
            <h3 className="card-title card-title--spaced">
              <History size={16} /> Recent Pharmacy Sessions
            </h3>
            {recentOrders.length === 0 ? (
              <div className="empty-state">No active sessions or order history.</div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Patient name</th>
                      <th>Session Date</th>
                      <th>Payment Status</th>
                      <th className="text-right">Sub-orders (Rxs)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentOrders.map(order => (
                      <tr
                        key={order.id}
                        className="table-row-clickable"
                        onClick={() => {
                          dispatch({ type: 'SET_ACTIVE_ORDER', orderId: order.id });
                          dispatch({ type: 'SET_SCREEN', screen: 'create' });
                        }}
                      >
                        <td className="font-semibold">{patientName(order.patientId)}</td>
                        <td className="text-muted text-sm">
                          {new Date(order.date).toLocaleDateString('en-GB', {
                            day: 'numeric', month: 'short', year: 'numeric',
                          })} at {new Date(order.date).toLocaleTimeString('en-GB', {
                            hour: '2-digit', minute: '2-digit'
                          })}
                        </td>
                        <td>{paymentPill(order.payment.status)}</td>
                        <td className="text-right font-semibold">{order.prescriptions.length}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

        </div>

        {/* RIGHT COLUMN: Operational Checklist */}
        <div className="card card-surface duty-sidebar">
          <h3 className="card-title">
            <ListTodo size={16} /> Pharmacist Duties
          </h3>

          <div className="duty-list">
            <div className="duty-item">
              <input type="checkbox" checked={newReferrals === 0} readOnly />
              <div>
                <span className="font-semibold" style={{ display: 'block' }}>Review onboarding status</span>
                <span className="text-muted text-xs">{newReferrals} pharmacy-attributed enquiries are still with HHH for review.</span>
              </div>
            </div>
            <div className="duty-item">
              <input type="checkbox" checked={awaitingPayment === 0} readOnly />
              <div>
                <span className="font-semibold" style={{ display: 'block' }}>Outstanding Billing Links</span>
                <span className="text-muted text-xs">{awaitingPayment} Worldpay requests currently active.</span>
              </div>
            </div>
            <div className="duty-item">
              <input type="checkbox" checked={inFulfilment === 0} readOnly />
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
        </div>

      </div>
    </div>
  );
}
