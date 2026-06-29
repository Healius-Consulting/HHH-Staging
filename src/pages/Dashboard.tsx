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
        
        {/* LEFT COLUMN: Recent Activity table */}
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
