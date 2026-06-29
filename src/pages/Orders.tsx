import { useState, useMemo } from 'react';
import { Package, Truck, FileText, Download, CheckCircle, Clock, Printer, X } from 'lucide-react';
import {
  useApp,
  money,
  lineRevenue,
  RX_STATUS_LABELS,
  type RxStatus,
} from '../context/AppContext';

const TRACK_STEPS = ['Submitted', 'Approved', 'Dispatched', 'Ready', 'Collected'] as const;

const STATUS_TABS: { key: RxStatus; label: string; icon: React.ReactNode }[] = [
  { key: 'awaiting-approval', label: '1. Awaiting Approval', icon: <Clock size={13} /> },
  { key: 'approved',          label: '2. Approved',          icon: <CheckCircle size={13} /> },
  { key: 'dispatched',        label: '3. In Transit',        icon: <Truck size={13} /> },
  { key: 'ready',             label: '4. Ready for Collection', icon: <Package size={13} /> },
  { key: 'collected',         label: '5. Collected',         icon: <CheckCircle size={13} /> },
];

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

interface FlatSubOrder {
  orderId: number;
  patientName: string;
  date: Date;
  rxIdx: number;
  rx: {
    id: number;
    prescriber: string;
    copyFileName: string | null;
    items: any[];
    placed: boolean;
    poRef: string | null;
    status: RxStatus;
    invoiceRef: string | null;
    trackingNumber: string | null;
    carrier: string | null;
  };
}

export default function Orders() {
  const { state, dispatch } = useApp();
  const [activeTab, setActiveTab] = useState<RxStatus>('awaiting-approval');
  const [printingRx, setPrintingRx] = useState<{ rx: any; patientName: string } | null>(null);

  const paidOrders = state.orders.filter(o => o.payment.status === 'paid');

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

  /* ── Flatten all prescriptions from paid orders to track independently ── */
  const allSubOrders = useMemo(() => {
    const list: FlatSubOrder[] = [];
    paidOrders.forEach(order => {
      const pName = patientName(order.patientId);
      order.prescriptions.forEach((rx, idx) => {
        list.push({
          orderId: order.id,
          patientName: pName,
          date: order.date,
          rxIdx: idx + 1,
          rx,
        });
      });
    });
    return list;
  }, [paidOrders, state.crm]);

  // Filter sub-orders matching active status tab
  const filteredSubOrders = useMemo(() => {
    return allSubOrders.filter(so => so.rx.status === activeTab);
  }, [allSubOrders, activeTab]);

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

  const rxRevenue = (rx: any) => rx.items.reduce((t: number, i: any) => t + lineRevenue(i), 0);

  const renderSubOrderCard = (so: FlatSubOrder) => {
    const { rx, patientName: pName, orderId, date, rxIdx } = so;
    return (
      <div className="card" key={`${orderId}-${rx.id}`} style={{ marginBottom: 16 }}>
        {/* Card Header */}
        <div className="flex items-center justify-between" style={{ marginBottom: 12 }}>
          <div>
            <div className="flex items-center gap-sm">
              <span className="font-semibold text-sm" style={{ fontSize: 15 }}>{pName}</span>
              <span className="text-muted text-xs">&middot; Rx #{rxIdx} inside Order #{orderId}</span>
            </div>
            <div className="text-xs text-muted" style={{ marginTop: 2 }}>
              Ordered: {fmtDate(date)} &middot; Prescriber: {rx.prescriber || 'Pending'}
            </div>
          </div>
          <div className="flex flex-col items-end gap-xs">
            <span className="font-bold text-green">{money(rxRevenue(rx))}</span>
            <span className={`pill ${STATUS_PILL[rx.status] ?? 'pill-neutral'}`}>
              {RX_STATUS_LABELS[rx.status]}
            </span>
          </div>
        </div>

        <div className="divider" />

        {/* Stepper Timeline */}
        {renderTrackBar(rx.status)}

        {/* Courier details & invoice links */}
        <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
          <div className="flex items-center gap-sm text-xs text-secondary">
            <FileText size={14} className="text-muted" />
            <span>Supplier Reference: <strong className="text-primary">{rx.poRef || 'Pending Approval'}</strong></span>
          </div>
          
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

        {/* Action Triggers */}
        {(rx.status === 'dispatched' || rx.status === 'ready') && (
          <div style={{ marginTop: 12, padding: 10, background: 'var(--bg-elevated)', borderRadius: 6, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <span className="text-xs font-bold text-muted uppercase">Pharmacy Check-in Actions:</span>
            
            {rx.status === 'dispatched' && (
              <button
                className="btn btn-sm btn-primary"
                onClick={() => dispatch({ type: 'RECEIVE_SHIPMENT', orderId, rxId: rx.id })}
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
                  onClick={() => dispatch({ type: 'HANDOVER_TO_PATIENT', orderId, rxId: rx.id })}
                >
                  Handover to Patient
                </button>
              </>
            )}
          </div>
        )}

        <div className="divider" style={{ borderStyle: 'dashed' }} />

        {/* Prescription items list */}
        {rx.items.length > 0 && (
          <div className="item-list">
            <span className="text-xs font-bold text-muted uppercase">Prescribed Products</span>
            {rx.items.map(item => (
              <div key={item.productId} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '2px 0' }}>
                <span className="text-secondary">{item.name} &times; {item.qty}</span>
                <span className="font-semibold text-primary" style={{ marginLeft: 'auto' }}>{money(lineRevenue(item))}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="page-body">
      {/* ── Sub-tabs for the 5 stages of tracking ── */}
      <div className="flex items-center gap-xs" style={{ marginBottom: 20, flexWrap: 'wrap' }}>
        {STATUS_TABS.map(tab => {
          const count = allSubOrders.filter(so => so.rx.status === tab.key).length;
          return (
            <button
              key={tab.key}
              className={`chip ${activeTab === tab.key ? 'chip-active' : ''}`}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.icon}
              <span>{tab.label}</span>
              <span className="tab-badge" style={{ minWidth: 16, height: 16, fontSize: 9, padding: '0 4px', background: activeTab === tab.key ? 'var(--green-600)' : 'var(--border)' }}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── Sub-orders list ── */}
      {filteredSubOrders.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">
            <Package size={28} />
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            No prescription sub-orders currently in this stage.
          </p>
        </div>
      ) : (
        filteredSubOrders.map(so => renderSubOrderCard(so))
      )}

      {/* ── ZPL Thermal Dispensing Label Print Preview Modal ── */}
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
            
            {/* Label Layout */}
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
