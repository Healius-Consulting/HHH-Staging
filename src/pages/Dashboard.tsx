import { Activity, CreditCard, Package, CheckCircle, ListTodo, History, FileText } from 'lucide-react';
import { useApp } from '../context/AppContext';

export default function Dashboard() {
  const { state, dispatch } = useApp();

  /* ── Computed stats ── */
  const newReferrals = state.submissions.filter(s => s.status !== 'Completed').length;
  const awaitingPayment = state.orders.filter(o => o.payment.status === 'sent').length;

  const inFulfilment = state.orders.filter(o =>
    o.payment.status === 'paid' &&
    o.prescriptions.some(rx => rx.status !== 'ready')
  ).length;

  const readyForCollection = state.orders.filter(o =>
    o.payment.status === 'paid' &&
    o.prescriptions.length > 0 &&
    o.prescriptions.every(rx => rx.status === 'ready')
  ).length;

  // 1. Uncollected warnings (10+ days)
  const uncollectedAlerts = state.orders.flatMap(o => {
    const pName = state.crm.find(p => p.id === o.patientId)?.name ?? 'Unknown';
    const pMobile = state.crm.find(p => p.id === o.patientId)?.mobile ?? '';
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
  const overduePaymentAlerts = state.orders
    .filter(o => o.payment.status === 'sent' && o.payment.sentAt && (Date.now() - new Date(o.payment.sentAt).getTime()) >= 3 * 24 * 60 * 60 * 1000)
    .map(o => {
      const pName = state.crm.find(p => p.id === o.patientId)?.name ?? 'Unknown';
      const pEmail = state.crm.find(p => p.id === o.patientId)?.email ?? '';
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
  const repeatAlerts = state.crm.map(p => {
    const pOrders = state.orders.filter(o => o.patientId === p.id);
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
    .filter(s => s.status !== 'Completed' && (Date.now() - new Date(s.submittedAt).getTime()) >= 48 * 60 * 60 * 1000)
    .map(s => ({
      type: 'intake' as const,
      id: `intake-${s.id}`,
      patientName: s.name,
      condition: s.condition,
      subId: s.id,
      days: Math.floor((Date.now() - new Date(s.submittedAt).getTime()) / (1000 * 60 * 60 * 24)),
    }));

  // 5. Patient Portal Requests
  const portalRequests = state.crm.flatMap(p => {
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
  const recentOrders = [...state.orders]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 5);

  const patientName = (patientId: string | null) => {
    if (!patientId) return 'Unassigned';
    return state.crm.find(p => p.id === patientId)?.name ?? 'Unknown';
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
      <div className="stats-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 24 }}>
        <div
          className="card card-surface"
          style={{ cursor: 'pointer', margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}
          onClick={() => dispatch({ type: 'SET_SCREEN', screen: 'referrals' })}
        >
          <div className="flex justify-between items-center">
            <span className="text-xs font-bold text-muted uppercase">New Clinic Referrals</span>
            <Activity size={18} className="text-info" />
          </div>
          <div className="flex items-baseline gap-xs">
            <span style={{ fontSize: 28, fontWeight: 700 }}>{newReferrals}</span>
            <span className="text-xs text-muted">pending review</span>
          </div>
        </div>

        <div
          className="card card-surface"
          style={{ cursor: 'pointer', margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}
          onClick={() => dispatch({ type: 'SET_SCREEN', screen: 'review' })}
        >
          <div className="flex justify-between items-center">
            <span className="text-xs font-bold text-muted uppercase">Awaiting Payments</span>
            <CreditCard size={18} className="text-amber" />
          </div>
          <div className="flex items-baseline gap-xs">
            <span style={{ fontSize: 28, fontWeight: 700 }}>{awaitingPayment}</span>
            <span className="text-xs text-muted">links active</span>
          </div>
        </div>

        <div
          className="card card-surface"
          style={{ cursor: 'pointer', margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}
          onClick={() => dispatch({ type: 'SET_SCREEN', screen: 'orders' })}
        >
          <div className="flex justify-between items-center">
            <span className="text-xs font-bold text-muted uppercase">In Fulfilment</span>
            <Package size={18} className="text-info" />
          </div>
          <div className="flex items-baseline gap-xs">
            <span style={{ fontSize: 28, fontWeight: 700 }}>{inFulfilment}</span>
            <span className="text-xs text-muted">supplier orders</span>
          </div>
        </div>

        <div
          className="card card-surface"
          style={{ cursor: 'pointer', margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}
          onClick={() => dispatch({ type: 'SET_SCREEN', screen: 'orders' })}
        >
          <div className="flex justify-between items-center">
            <span className="text-xs font-bold text-muted uppercase">Ready for Collection</span>
            <CheckCircle size={18} className="text-green" />
          </div>
          <div className="flex items-baseline gap-xs">
            <span style={{ fontSize: 28, fontWeight: 700 }}>{readyForCollection}</span>
            <span className="text-xs text-muted">patient alerts sent</span>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 20, alignItems: 'flex-start' }}>
        
        {/* LEFT COLUMN: Urgent Alerts & Recent Activity */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          
          {/* Urgent Actions Section */}
          {totalUrgent > 0 && (
            <div className="card" style={{ margin: 0, border: '1px solid rgba(239, 68, 68, 0.25)', background: 'rgba(239, 68, 68, 0.03)' }}>
              <h3 className="card-title" style={{ color: '#f87171', display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <Activity size={18} /> Urgent Action Items ({totalUrgent})
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {/* Intake Pending bottlenecks */}
                {intakeAlerts.map(alert => (
                  <div key={alert.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', background: 'rgba(239, 68, 68, 0.08)', borderRadius: 8, borderLeft: '3px solid #ef4444' }}>
                    <div style={{ fontSize: 14 }}>
                      <span className="font-semibold text-primary" style={{ display: 'block', fontSize: 15 }}>Pending Eligibility Intake &middot; {alert.patientName}</span>
                      <span className="text-secondary text-xs">Submitted <strong style={{ color: '#f87171' }}>{alert.days} days ago</strong> for <strong style={{ color: 'var(--text-primary)' }}>{alert.condition}</strong>. Review is currently pending.</span>
                    </div>
                    <button
                      className="btn btn-sm btn-primary"
                      style={{ background: '#ef4444', borderColor: '#ef4444', color: '#fff', fontSize: 12, padding: '6px 12px' }}
                      onClick={() => {
                        dispatch({ type: 'SET_SCREEN', screen: 'referrals' });
                      }}
                    >
                      Review Records
                    </button>
                  </div>
                ))}

                {uncollectedAlerts.map(alert => (
                  <div key={alert.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', background: 'rgba(239, 68, 68, 0.08)', borderRadius: 8, borderLeft: '3px solid #ef4444' }}>
                    <div style={{ fontSize: 14 }}>
                      <span className="font-semibold text-primary" style={{ display: 'block', fontSize: 15 }}>Uncollected Medication &middot; {alert.patientName}</span>
                      <span className="text-secondary text-xs">Prescription ready for collection for <strong style={{ color: '#f87171' }}>{alert.days} days</strong>. Contact: {alert.patientMobile}</span>
                    </div>
                    <button
                      className="btn btn-sm btn-primary"
                      style={{ background: '#ef4444', borderColor: '#ef4444', color: '#fff', fontSize: 12, padding: '6px 12px' }}
                      onClick={() => {
                        dispatch({
                          type: 'ADD_TOAST',
                          message: `SMS reminder resent to ${alert.patientName} (${alert.patientMobile}).`,
                          toastType: 'success'
                        });
                        dispatch({
                          type: 'LOG_INTERACTION',
                          patientId: alert.patientId,
                          interactionType: 'SMS Reminder',
                          detail: `Resent counter pickup notification SMS to ${alert.patientMobile}.`
                        });
                      }}
                    >
                      Resend SMS Reminder
                    </button>
                  </div>
                ))}

                {overduePaymentAlerts.map(alert => (
                  <div key={alert.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', background: 'rgba(245, 158, 11, 0.08)', borderRadius: 8, borderLeft: '3px solid #f59e0b' }}>
                    <div style={{ fontSize: 14 }}>
                      <span className="font-semibold text-primary" style={{ display: 'block', fontSize: 15 }}>Overdue Payment &middot; {alert.patientName}</span>
                      <span className="text-secondary text-xs">Payment link for <strong style={{ color: 'var(--text-primary)' }}>£{alert.amount.toFixed(2)}</strong> has been outstanding for <strong style={{ color: '#fbbf24' }}>{alert.days} days</strong>. Email: {alert.patientEmail}</span>
                    </div>
                    <button
                      className="btn btn-sm"
                      style={{ borderColor: '#f59e0b', color: '#fbbf24', fontSize: 12, padding: '6px 12px', background: 'transparent' }}
                      onClick={() => {
                        dispatch({
                          type: 'ADD_TOAST',
                          message: `Worldpay billing link resent to ${alert.patientName} at ${alert.patientEmail}.`,
                          toastType: 'info'
                        });
                        dispatch({
                          type: 'LOG_INTERACTION',
                          patientId: alert.patientId,
                          interactionType: 'Payment Link Resent',
                          detail: `Resent Worldpay invoice link for £${alert.amount.toFixed(2)} to ${alert.patientEmail}.`
                        });
                      }}
                    >
                      Resend Payment Link
                    </button>
                  </div>
                ))}

                {repeatAlerts.map(alert => (
                  <div key={alert.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', background: 'rgba(59, 130, 246, 0.08)', borderRadius: 8, borderLeft: '3px solid #3b82f6' }}>
                    <div style={{ fontSize: 14 }}>
                      <span className="font-semibold text-primary" style={{ display: 'block', fontSize: 15 }}>Repeat Rx Overdue &middot; {alert.patientName}</span>
                      <span className="text-secondary text-xs">Last repeat order was <strong style={{ color: '#60a5fa' }}>{alert.days} days ago</strong>. Treatment gap exceeds clinical guidelines.</span>
                    </div>
                    <div className="flex gap-xs">
                      <button
                        className="btn btn-sm"
                        style={{ fontSize: 12, padding: '6px 12px' }}
                        onClick={() => {
                          dispatch({
                            type: 'ADD_TOAST',
                            message: `Follow-up logged: Scheduled repeat check-up call with ${alert.patientName}.`,
                            toastType: 'success'
                          });
                          dispatch({
                            type: 'LOG_INTERACTION',
                            patientId: alert.patientId,
                            interactionType: 'Callback Scheduled',
                            detail: `Scheduled medical cannabis repeat prescription assessment call.`
                          });
                        }}
                      >
                        Log Callback
                      </button>
                      <button
                        className="btn btn-sm btn-primary"
                        style={{ fontSize: 12, padding: '6px 12px' }}
                        onClick={() => {
                          dispatch({
                            type: 'LOG_INTERACTION',
                            patientId: alert.patientId,
                            interactionType: 'Repeat Rx Initiated',
                            detail: 'Created new repeat prescription order session from dashboard.'
                          });
                          dispatch({ type: 'NEW_ORDER', patientId: alert.patientId });
                          dispatch({ type: 'SET_SCREEN', screen: 'create' });
                        }}
                      >
                        Create Repeat Rx
                      </button>
                    </div>
                  </div>
                ))}

                {/* Patient Portal Repeat Requests */}
                {portalRequests.filter(r => r.type === 'repeat-req').map(alert => (
                  <div key={alert.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', background: 'rgba(16, 185, 129, 0.08)', borderRadius: 8, borderLeft: '3px solid #10b981' }}>
                    <div style={{ fontSize: 14 }}>
                      <span className="font-semibold text-primary" style={{ display: 'block', fontSize: 15 }}>Portal Request: Repeat Prescription &middot; {alert.patientName}</span>
                      <span className="text-secondary text-xs">Patient requested repeat order copy via portal on {alert.timeStr}. Action required.</span>
                    </div>
                    <div className="flex gap-xs">
                      <button
                        className="btn btn-sm btn-primary"
                        style={{ background: '#10b981', borderColor: '#10b981', fontSize: 12, padding: '6px 12px' }}
                        onClick={() => {
                          dispatch({
                            type: 'LOG_INTERACTION',
                            patientId: alert.patientId,
                            interactionType: 'Repeat Rx Initiated',
                            detail: 'Repeat prescription process initiated from patient portal request.'
                          });
                          dispatch({ type: 'NEW_ORDER', patientId: alert.patientId });
                          dispatch({ type: 'SET_SCREEN', screen: 'create' });
                          dispatch({ type: 'ADD_TOAST', message: `Initiating repeat Rx builder for ${alert.patientName}.`, toastType: 'info' });
                        }}
                      >
                        Create Repeat Rx
                      </button>
                      <button
                        className="btn btn-sm"
                        style={{ fontSize: 12, padding: '6px 12px' }}
                        onClick={() => {
                          dispatch({
                            type: 'LOG_INTERACTION',
                            patientId: alert.patientId,
                            interactionType: 'Request Resolved',
                            detail: 'Dismissed patient portal repeat prescription request.'
                          });
                          dispatch({ type: 'ADD_TOAST', message: 'Request dismissed.', toastType: 'info' });
                        }}
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                ))}

                {/* Patient Portal Appointment Requests */}
                {portalRequests.filter(r => r.type === 'appointment-req').map(alert => (
                  <div key={alert.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', background: 'rgba(59, 130, 246, 0.08)', borderRadius: 8, borderLeft: '3px solid #3b82f6' }}>
                    <div style={{ fontSize: 14 }}>
                      <span className="font-semibold text-primary" style={{ display: 'block', fontSize: 15 }}>Portal Request: Schedule Check-up &middot; {alert.patientName}</span>
                      <span className="text-secondary text-xs">Patient requested clinical assessment check-up via portal on {alert.timeStr}.</span>
                    </div>
                    <div className="flex gap-xs">
                      <button
                        className="btn btn-sm btn-primary"
                        style={{ fontSize: 12, padding: '6px 12px' }}
                        onClick={() => {
                          dispatch({
                            type: 'LOG_INTERACTION',
                            patientId: alert.patientId,
                            interactionType: 'Callback Scheduled',
                            detail: 'Scheduled patient-requested check-up assessment call.'
                          });
                          dispatch({ type: 'ADD_TOAST', message: `Callback scheduled for ${alert.patientName}.`, toastType: 'success' });
                        }}
                      >
                        Log Callback
                      </button>
                      <button
                        className="btn btn-sm"
                        style={{ fontSize: 12, padding: '6px 12px' }}
                        onClick={() => {
                          dispatch({
                            type: 'LOG_INTERACTION',
                            patientId: alert.patientId,
                            interactionType: 'Request Resolved',
                            detail: 'Dismissed patient portal appointment check-up request.'
                          });
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
          <div className="card" style={{ margin: 0 }}>
            <h3 className="card-title" style={{ marginBottom: 16 }}>
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
                        style={{ cursor: 'pointer' }}
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
        <div className="card card-surface" style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <h3 className="card-title">
            <ListTodo size={16} /> Pharmacist Duties
          </h3>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 13 }}>
              <input type="checkbox" checked={newReferrals === 0} readOnly style={{ marginTop: 3 }} />
              <div>
                <span className="font-semibold" style={{ display: 'block' }}>Process Clinic Intake</span>
                <span className="text-muted text-xs">There are {newReferrals} clinic referrals awaiting verification and CRM sync.</span>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 13 }}>
              <input type="checkbox" checked={awaitingPayment === 0} readOnly style={{ marginTop: 3 }} />
              <div>
                <span className="font-semibold" style={{ display: 'block' }}>Outstanding Billing Links</span>
                <span className="text-muted text-xs">{awaitingPayment} Worldpay requests are currently active. Webhook simulations clear in 7s.</span>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 13 }}>
              <input type="checkbox" checked={inFulfilment === 0} readOnly style={{ marginTop: 3 }} />
              <div>
                <span className="font-semibold" style={{ display: 'block' }}>DPD Supply Chain Review</span>
                <span className="text-muted text-xs">{inFulfilment} orders are actively processing with Curaleaf. Statuses advance every 15s.</span>
              </div>
            </div>
          </div>

          <div className="divider" style={{ margin: '4px 0' }} />

          <div style={{ background: 'rgba(0,0,0,0.2)', padding: 12, borderRadius: 8 }}>
            <h4 className="font-semibold text-xs text-muted" style={{ textTransform: 'uppercase', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
              <FileText size={12} /> Curaleaf Integration
            </h4>
            <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
              Connected to Curaleaf API gateway. All orders placed are automatically tracked via REST endpoints.
            </span>
          </div>
        </div>

      </div>
    </div>
  );
}
