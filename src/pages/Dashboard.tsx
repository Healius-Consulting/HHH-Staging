import { Activity, CreditCard, Package, CheckCircle } from 'lucide-react';
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
      default:     return <span className="pill pill-neutral">None</span>;
    }
  };

  return (
    <div className="page-body">
      <h2 className="page-title">Dashboard</h2>
      <p className="page-subtitle">Overview of your pharmacy operations</p>

      {/* ══ Stats Grid ══ */}
      <div className="stats-grid" style={{ marginBottom: 24 }}>
        <div
          className="stat-card"
          style={{ cursor: 'pointer' }}
          onClick={() => dispatch({ type: 'SET_SCREEN', screen: 'referrals' })}
        >
          <div className="stat-icon info">
            <Activity size={18} />
          </div>
          <div className="stat-value">{newReferrals}</div>
          <div className="stat-label">New Referrals</div>
        </div>

        <div
          className="stat-card"
          style={{ cursor: 'pointer' }}
          onClick={() => dispatch({ type: 'SET_SCREEN', screen: 'review' })}
        >
          <div className="stat-icon amber">
            <CreditCard size={18} />
          </div>
          <div className="stat-value">{awaitingPayment}</div>
          <div className="stat-label">Awaiting Payment</div>
        </div>

        <div
          className="stat-card"
          style={{ cursor: 'pointer' }}
          onClick={() => dispatch({ type: 'SET_SCREEN', screen: 'orders' })}
        >
          <div className="stat-icon green">
            <Package size={18} />
          </div>
          <div className="stat-value">{inFulfilment}</div>
          <div className="stat-label">In Fulfilment</div>
        </div>

        <div
          className="stat-card"
          style={{ cursor: 'pointer' }}
          onClick={() => dispatch({ type: 'SET_SCREEN', screen: 'orders' })}
        >
          <div className="stat-icon green">
            <CheckCircle size={18} />
          </div>
          <div className="stat-value">{readyForCollection}</div>
          <div className="stat-label">Ready for Collection</div>
        </div>
      </div>

      {/* ══ Recent Activity ══ */}
      <div className="card">
        <h3 className="card-title" style={{ marginBottom: 12 }}>Recent Activity</h3>
        {recentOrders.length === 0 ? (
          <div className="empty-state">No orders yet.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Patient</th>
                  <th>Date</th>
                  <th>Payment</th>
                  <th className="text-right">Rxs</th>
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
                      })}
                    </td>
                    <td>{paymentPill(order.payment.status)}</td>
                    <td className="text-right">{order.prescriptions.length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
