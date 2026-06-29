import { useState } from 'react';
import { Package, Truck, FileText, Download, CheckCircle } from 'lucide-react';
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
    return (
      <div className="track-bar">
        {TRACK_STEPS.map((label, i) => {
          let cls = 'track-step';
          if (i < done || (status === 'ready' && i <= done)) cls += ' done';
          else if (i === done && status !== 'ready') cls += ' active';
          return (
            <div key={label} className={cls}>
              <div className="track-dot" />
              <span>{label}</span>
            </div>
          );
        })}
      </div>
    );
  };

  const renderOrder = (order: PatientOrder) => (
    <div className="card" key={order.id} style={{ marginBottom: 16 }}>
      {/* ── Card header ── */}
      <div className="flex items-center justify-between" style={{ marginBottom: 12 }}>
        <div>
          <div className="font-semibold">{patientName(order.patientId)}</div>
          <div className="text-sm text-muted">
            {fmtDate(order.date)} &middot; Order #{order.id}
          </div>
        </div>
        <div className="font-semibold">{money(orderRevenue(order))}</div>
      </div>

      <div className="divider" />

      {/* ── Prescriptions ── */}
      {order.prescriptions.map(rx => (
        <div className="rx-card" key={rx.id} style={{ marginTop: 12 }}>
          {/* rx header */}
          <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
            <div className="flex items-center gap-sm">
              <FileText size={14} className="text-muted" />
              <span className="font-semibold text-sm">Rx #{rx.id}</span>
              <span className="text-muted text-sm">{rx.prescriber}</span>
            </div>
            <div className="flex items-center gap-sm">
              <span className="text-xs text-faint">
                PO {rx.poRef || '—'}
              </span>
              <span className={`pill ${STATUS_PILL[rx.status] ?? 'pill-neutral'}`}>
                {RX_STATUS_LABELS[rx.status]}
              </span>
            </div>
          </div>

          {/* tracking bar */}
          {renderTrackBar(rx.status)}

          {/* tracking & invoice info */}
          <div style={{ marginTop: 8 }}>
            {rx.trackingNumber && (
              <div className="flex items-center gap-sm text-sm" style={{ marginBottom: 4 }}>
                <Truck size={14} className="text-muted" />
                <span>
                  Tracking: <span className="font-semibold">{rx.trackingNumber}</span>
                  {' via '}
                  {rx.carrier}
                </span>
              </div>
            )}
            {rx.invoiceRef && (
              <div className="flex items-center justify-between text-sm" style={{ marginBottom: 4 }}>
                <div className="flex items-center gap-sm">
                  <FileText size={14} className="text-muted" />
                  <span>
                    Invoice: <span className="font-semibold">{rx.invoiceRef}</span>
                  </span>
                </div>
                <button className="btn btn-sm" style={{ gap: 4 }}>
                  <Download size={12} /> Download PDF
                </button>
              </div>
            )}
          </div>

          {/* items list */}
          {rx.items.length > 0 && (
            <div className="item-list" style={{ marginTop: 8 }}>
              {rx.items.map(item => (
                <div className="item-block" key={item.productId}>
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-sm font-semibold">{item.name}</span>
                      <span className="text-xs text-muted" style={{ marginLeft: 8 }}>
                        × {item.qty}
                      </span>
                    </div>
                    <span className="text-sm font-semibold">
                      {money(lineRevenue(item))}
                    </span>
                  </div>
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
      <h2 className="page-title">Orders</h2>
      <p className="page-subtitle">Active and past orders submitted to Curaleaf.</p>

      {/* ── Filter chips ── */}
      <div className="flex items-center gap-sm" style={{ marginBottom: 16 }}>
        <button
          className={`chip ${filter === 'active' ? 'chip-active' : ''}`}
          onClick={() => setFilter('active')}
        >
          <Package size={14} />
          Active
        </button>
        <button
          className={`chip ${filter === 'past' ? 'chip-active' : ''}`}
          onClick={() => setFilter('past')}
        >
          <CheckCircle size={14} />
          Past
        </button>
      </div>

      {/* ── Orders list ── */}
      {filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">
            {filter === 'active' ? <Package size={28} /> : <CheckCircle size={28} />}
          </div>
          {filter === 'active'
            ? 'No active orders in fulfilment.'
            : 'No past orders yet.'}
        </div>
      ) : (
        filtered.map(order => renderOrder(order))
      )}
    </div>
  );
}
