import { useState } from 'react';
import { Package, Truck, FileText, Download, CheckCircle, Clock } from 'lucide-react';
import {
  useApp,
  money,
  orderRevenue,
  lineRevenue,
  RX_STATUS_LABELS,
  type PatientOrder,
  type RxStatus,
} from '../context/AppContext';

const TRACK_STEPS = ['Submitted', 'Approved', 'Dispatched', 'Ready'] as const;

function stepsCompleted(status: RxStatus): number {
  switch (status) {
    case 'awaiting-approval': return 0;
    case 'approved':          return 1;
    case 'dispatched':        return 2;
    case 'ready':             return 3;
    default:                  return -1;
  }
}

const STATUS_PILL: Record<string, string> = {
  'awaiting-approval': 'pill-info',
  approved:            'pill-info',
  dispatched:          'pill-amber',
  ready:               'pill-green',
};

type Filter = 'active' | 'past';

export default function Orders() {
  const { state } = useApp();
  const [filter, setFilter] = useState<Filter>('active');

  const paidOrders = state.orders.filter(o => o.payment.status === 'paid');

  const filtered = paidOrders.filter(order => {
    const allReady =
      order.prescriptions.length > 0 &&
      order.prescriptions.every(rx => rx.status === 'ready');
    return filter === 'active' ? !allReady : allReady;
  });

  const patientName = (patientId: string | null) => {
    if (!patientId) return 'Unassigned';
    return state.crm.find(p => p.id === patientId)?.name ?? 'Unknown';
  };

  const fmtDate = (d: Date) =>
    new Date(d).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });

  const renderTrackBar = (status: RxStatus) => {
    const done = stepsCompleted(status);
    const progressWidth = done >= 0 ? done * 33.33 : 0;
    return (
      <div className="orders-timeline-container">
        <div className="orders-timeline">
          {/* Active progress fill line */}
          <div 
            className="orders-timeline-progress" 
            style={{ width: `${progressWidth}%` }} 
          />
          {TRACK_STEPS.map((label, i) => {
            let cls = 'timeline-step';
            if (i < done || (status === 'ready' && i <= done)) cls += ' done';
            else if (i === done && status !== 'ready') cls += ' active';
            return (
              <div key={label} className={cls}>
                <div className="timeline-dot">
                  {i + 1}
                </div>
                <span className="timeline-label">{label}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderOrder = (order: PatientOrder) => (
    <div className="card" key={order.id} style={{ marginBottom: 16 }}>
      {/* ── Card header ── */}
      <div className="flex items-center justify-between" style={{ marginBottom: 12 }}>
        <div>
          <div className="font-semibold text-sm" style={{ fontSize: 15 }}>{patientName(order.patientId)}</div>
          <div className="text-sm text-muted" style={{ marginTop: 2 }}>
            {fmtDate(order.date)} &middot; Order session #{order.id}
          </div>
        </div>
        <div className="font-bold text-green">{money(orderRevenue(order))}</div>
      </div>

      <div className="divider" />

      {/* ── Prescriptions ── */}
      {order.prescriptions.map((rx, idx) => (
        <div className="rx-card" key={rx.id} style={{ marginTop: 12, background: 'rgba(0,0,0,0.15)', border: '1px solid var(--border)' }}>
          {/* rx header */}
          <div className="flex items-center justify-between" style={{ marginBottom: 12 }}>
            <div className="flex items-center gap-sm">
              <FileText size={14} className="text-secondary" />
              <span className="font-semibold text-sm">Rx #{idx + 1}</span>
              <span className="text-muted text-sm">&middot; {rx.prescriber}</span>
            </div>
            <div className="flex items-center gap-sm">
              <span className="text-xs text-tertiary">
                PO: {rx.poRef || '—'}
              </span>
              <span className={`pill ${STATUS_PILL[rx.status] ?? 'pill-neutral'}`}>
                {RX_STATUS_LABELS[rx.status]}
              </span>
            </div>
          </div>

          {/* tracking bar */}
          {renderTrackBar(rx.status)}

          {/* tracking & invoice info */}
          <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
            {rx.trackingNumber && (
              <div className="flex items-center gap-sm text-xs text-secondary">
                <Truck size={14} className="text-muted" />
                <span>
                  Courier tracking: <span className="font-semibold text-primary">{rx.trackingNumber}</span> ({rx.carrier})
                </span>
              </div>
            )}
            {rx.invoiceRef && (
              <div className="flex items-center justify-between text-xs text-secondary">
                <div className="flex items-center gap-sm">
                  <FileText size={14} className="text-muted" />
                  <span>
                    Invoice ref: <span className="font-semibold text-primary">{rx.invoiceRef}</span>
                  </span>
                </div>
                <button className="btn btn-xs btn-sm" style={{ gap: 4, padding: '2px 8px', fontSize: 10 }}>
                  <Download size={10} /> PDF Invoice
                </button>
              </div>
            )}
          </div>

          <div className="divider" style={{ borderStyle: 'dashed' }} />

          {/* items list */}
          {rx.items.length > 0 && (
            <div className="item-list">
              <span className="text-xs font-bold text-muted uppercase">Assigned products</span>
              {rx.items.map(item => (
                <div key={item.productId} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '2px 0' }}>
                  <span className="text-secondary">{item.name} &times; {item.qty}</span>
                  <span className="font-semibold text-primary">{money(lineRevenue(item))}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );

  return (
    <div className="page-body">
      {/* ── Filter chips ── */}
      <div className="flex items-center gap-sm" style={{ marginBottom: 20 }}>
        <button
          className={`chip ${filter === 'active' ? 'chip-active' : ''}`}
          onClick={() => setFilter('active')}
        >
          <Clock size={14} />
          Active Shipments ({paidOrders.filter(o => !o.prescriptions.every(rx => rx.status === 'ready')).length})
        </button>
        <button
          className={`chip ${filter === 'past' ? 'chip-active' : ''}`}
          onClick={() => setFilter('past')}
        >
          <CheckCircle size={14} />
          Ready / Completed ({paidOrders.filter(o => o.prescriptions.every(rx => rx.status === 'ready')).length})
        </button>
      </div>

      {/* ── Orders list ── */}
      {filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">
            {filter === 'active' ? <Package size={28} /> : <CheckCircle size={28} />}
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            {filter === 'active'
              ? 'No active orders processing with Curaleaf.'
              : 'No past orders completed in this session.'}
          </p>
        </div>
      ) : (
        filtered.map(order => renderOrder(order))
      )}
    </div>
  );
}
