import { useState } from 'react';
import { Package, Truck, FileText, Download, CheckCircle, Clock, Printer, X } from 'lucide-react';
import {
  useApp,
  money,
  orderRevenue,
  lineRevenue,
  RX_STATUS_LABELS,
  type PatientOrder,
  type RxStatus,
} from '../context/AppContext';

const TRACK_STEPS = ['Submitted', 'Approved', 'Dispatched', 'Ready', 'Collected'] as const;

function stepsCompleted(status: RxStatus): number {
  switch (status) {
    case 'awaiting-approval': return 0;
    case 'approved':          return 1;
    case 'dispatched':        return 2;
    case 'ready':             return 3;
    case 'collected':         return 4;
    default:                  return -1;
  }
}

const STATUS_PILL: Record<string, string> = {
  'awaiting-approval': 'pill-info',
  approved:            'pill-info',
  dispatched:          'pill-amber',
  ready:               'pill-green',
  collected:           'pill-neutral',
};

type Filter = 'active' | 'past';

export default function Orders() {
  const { state, dispatch } = useApp();
  const [filter, setFilter] = useState<Filter>('active');
  const [printingRx, setPrintingRx] = useState<{ rx: any; patientName: string } | null>(null);

  const paidOrders = state.orders.filter(o => o.payment.status === 'paid');

  const filtered = paidOrders.filter(order => {
    const allCollected =
      order.prescriptions.length > 0 &&
      order.prescriptions.every(rx => rx.status === 'collected');
    return filter === 'active' ? !allCollected : allCollected;
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
    const progressWidth = done >= 0 ? done * 25 : 0;
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
            if (i < done || (status === 'collected' && i <= done)) cls += ' done';
            else if (i === done && status !== 'collected') cls += ' active';
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
      {order.prescriptions.map((rx, idx) => {
        const pName = patientName(order.patientId);
        return (
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

            {/* B2B Workflow actions for the pharmacist */}
            {rx.placed && (rx.status === 'dispatched' || rx.status === 'ready') && (
              <div style={{ marginTop: 12, padding: 10, background: 'var(--bg-elevated)', borderRadius: 6, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <span className="text-xs font-bold text-muted uppercase">Pharmacy Actions:</span>
                
                {rx.status === 'dispatched' && (
                  <button
                    className="btn btn-sm btn-primary"
                    onClick={() => dispatch({ type: 'RECEIVE_SHIPMENT', orderId: order.id, rxId: rx.id })}
                  >
                    Confirm Arrived (Goods-In Check-In)
                  </button>
                )}

                {rx.status === 'ready' && (
                  <>
                    <button
                      className="btn btn-sm"
                      onClick={() => setPrintingRx({ rx, patientName: pName })}
                    >
                      <Printer size={12} /> Print Dispensing Label
                    </button>
                    <button
                      className="btn btn-sm btn-primary"
                      onClick={() => dispatch({ type: 'HANDOVER_TO_PATIENT', orderId: order.id, rxId: rx.id })}
                    >
                      Handover to Patient
                    </button>
                  </>
                )}
              </div>
            )}

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
        );
      })}
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
          Active shipments / Handover ({paidOrders.filter(o => !o.prescriptions.every(rx => rx.status === 'collected')).length})
        </button>
        <button
          className={`chip ${filter === 'past' ? 'chip-active' : ''}`}
          onClick={() => setFilter('past')}
        >
          <CheckCircle size={14} />
          Collected / Archived ({paidOrders.filter(o => o.prescriptions.every(rx => rx.status === 'collected')).length})
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
              ? 'No active shipments or packages awaiting check-in.'
              : 'No collected or archived prescriptions in this session.'}
          </p>
        </div>
      ) : (
        filtered.map(order => renderOrder(order))
      )}

      {/* ── Thermal Dispensing Label Print Preview Modal ── */}
      {printingRx && (
        <>
          <div className="drawer-backdrop" onClick={() => setPrintingRx(null)} />
          <div className="card card-surface" style={{
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            zIndex: 110,
            width: '380px',
            padding: '20px',
            border: '2px solid var(--green-500)',
            background: 'var(--bg-root)',
            boxShadow: 'var(--shadow-lg)'
          }} onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center" style={{ marginBottom: 12 }}>
              <span className="font-bold text-xs text-green uppercase flex items-center gap-xs">
                <Printer size={14} /> ZPL thermal printer queue
              </span>
              <button className="toast-close" onClick={() => setPrintingRx(null)}>
                <X size={14} />
              </button>
            </div>
            
            {/* Label sticker layout */}
            <div style={{
              background: '#F8FAFC',
              color: '#0F172A',
              padding: '16px',
              borderRadius: '4px',
              border: '1px solid #CBD5E1',
              fontFamily: 'monospace',
              fontSize: '11px',
              lineHeight: 1.5,
              boxShadow: 'inset 0 0 10px rgba(0,0,0,0.1)'
            }}>
              <div style={{ textAlign: 'center', fontWeight: 'bold', borderBottom: '1px solid #000', paddingBottom: 6, marginBottom: 8, fontSize: '12px' }}>
                HHH PHARMACY LEEDS
              </div>
              <div><strong>Patient:</strong> {printingRx.patientName}</div>
              <div><strong>Date:</strong> {new Date().toLocaleDateString('en-GB')}</div>
              <div style={{ margin: '8px 0', borderBottom: '1px dashed #000', paddingBottom: 6 }}>
                {printingRx.rx.items.map((item: any, idx: number) => (
                  <div key={idx}>
                    <strong>CD:</strong> {item.name} &times; {item.qty}<br />
                    <span style={{ fontSize: '10px' }}>Dispensing Fee: {money(item.fee)}</span>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: '10px', fontStyle: 'italic', marginBottom: 8, color: '#334155' }}>
                Directions: Use as directed by the clinician. Keep out of reach and sight of children. Controlled Drug.
              </div>
              {/* Simulated Barcode */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: 12 }}>
                <div style={{ letterSpacing: '2px', background: '#000', color: '#fff', padding: '4px 12px', fontSize: '9px', fontWeight: 'bold' }}>
                  |||||| | |||| ||| ||
                </div>
                <span style={{ fontSize: '8px', marginTop: 2 }}>{printingRx.rx.poRef || 'PO-BATCH-REF'}</span>
              </div>
            </div>
            
            <div className="flex gap-sm" style={{ marginTop: 16, justifyContent: 'flex-end' }}>
              <button className="btn btn-sm" onClick={() => setPrintingRx(null)}>Cancel</button>
              <button className="btn btn-primary btn-sm" onClick={() => {
                dispatch({ type: 'ADD_TOAST', message: 'Dispensing label printed successfully via ZPL printer job queue.', toastType: 'success' });
                setPrintingRx(null);
              }}>
                Disperse Job to Printer
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
