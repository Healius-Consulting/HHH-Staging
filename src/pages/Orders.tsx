import React, { useState, useMemo } from 'react';
import { Package, Truck, FileText, Download, CheckCircle, Clock, Printer, X } from 'lucide-react';
import {
  useApp,
  money,
  lineRevenue,
  RX_STATUS_LABELS,
  type RxStatus,
  type Prescription,
  PHARMACY
} from '../context/AppContext';

const TRACK_STEPS = ['Submitted', 'Approved', 'Dispatched', 'Ready', 'Collected'] as const;

const STATUS_TABS: { key: RxStatus; label: string; shortLabel: string; icon: React.ReactNode }[] = [
  { key: 'awaiting-approval', label: 'Awaiting Approval', shortLabel: 'Awaiting', icon: <Clock size={14} /> },
  { key: 'approved',          label: 'Approved',          shortLabel: 'Approved', icon: <CheckCircle size={14} /> },
  { key: 'dispatched',        label: 'In Transit',        shortLabel: 'In Transit', icon: <Truck size={14} /> },
  { key: 'ready',             label: 'Ready for Collection', shortLabel: 'Ready', icon: <Package size={14} /> },
  { key: 'collected',         label: 'Collected',         shortLabel: 'Collected', icon: <CheckCircle size={14} /> },
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
  rx: Prescription;
}

export default function Orders() {
  const { state, dispatch } = useApp();
  const [activeTab, setActiveTab] = useState<RxStatus | 'all'>('awaiting-approval');
  const [printingRx, setPrintingRx] = useState<{ rx: any; patientName: string } | null>(null);
  const [exitingRxId, setExitingRxId] = useState<number | null>(null);

  const handleActionWithAnimation = (orderId: number, rxId: number, actionType: 'RECEIVE_SHIPMENT' | 'HANDOVER_TO_PATIENT') => {
    setExitingRxId(rxId);
    setTimeout(() => {
      dispatch({ type: actionType, orderId, rxId });
      setExitingRxId(null);
    }, 400);
  };

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
    return activeTab === 'all'
      ? allSubOrders
      : allSubOrders.filter(so => so.rx.status === activeTab);
  }, [allSubOrders, activeTab]);

  const renderTrackBar = (status: RxStatus) => {
    const done = stepsCompleted(status);
    const progressWidth = done >= 0 ? done * 25 : 0;
    return (
      <div className="orders-timeline-container">
        <div className="orders-timeline">
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
                <div className="timeline-dot">{i + 1}</div>
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
    const isExiting = exitingRxId === rx.id;
    const readyDays = rx.status === 'ready' && rx.readyAt
      ? Math.floor((Date.now() - new Date(rx.readyAt).getTime()) / (1000 * 60 * 60 * 24))
      : 0;

    return (
      <div className={`card order-card ${isExiting ? 'card-exit' : ''}`} key={`${orderId}-${rx.id}`}>
        <div className="order-card__header">
          <div>
            <div className="flex items-center gap-sm flex-wrap">
              <span className="card-title-md">{pName}</span>
              <span className="text-muted text-xs">Rx #{rxIdx} · Order #{orderId}</span>
            </div>
            <div className="order-card__meta">
              Ordered {fmtDate(date)} · Prescriber: {rx.prescriber || 'Pending'}
            </div>
          </div>
          <div className="order-card__aside">
            <span className="font-bold text-green">{money(rxRevenue(rx))}</span>
            <span className={`pill ${STATUS_PILL[rx.status] ?? 'pill-neutral'}`}>
              {RX_STATUS_LABELS[rx.status]}
            </span>
          </div>
        </div>

        {readyDays >= 10 && (
          <div className="banner banner-red">
            <span className="text-sm">
              Prescription uncollected for {readyDays} days — follow-up required.
            </span>
          </div>
        )}

        <div className="order-card__section">
          <span className="section-label section-label--spaced">Fulfilment progress</span>
          {renderTrackBar(rx.status)}
        </div>

        <div className="detail-grid" style={{ marginBottom: 0 }}>
          <div className="detail-cell">
            <FileText size={13} className="text-muted" style={{ display: 'inline', marginRight: 6, verticalAlign: -2 }} />
            <strong className="text-primary">Supplier ref:</strong>{' '}
            {rx.poRef || 'Pending approval'}
          </div>

          {rx.trackingNumber && (
            <div className="detail-cell">
              <Truck size={13} className="text-muted" style={{ display: 'inline', marginRight: 6, verticalAlign: -2 }} />
              <strong className="text-primary">Tracking:</strong>{' '}
              {rx.trackingNumber} ({rx.carrier})
            </div>
          )}

          {rx.invoiceRef && (
            <div className="detail-cell" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span>
                <FileText size={13} className="text-muted" style={{ display: 'inline', marginRight: 6, verticalAlign: -2 }} />
                <strong className="text-primary">Invoice:</strong> {rx.invoiceRef}
              </span>
              <button className="btn btn-xs btn-sm" style={{ gap: 4, padding: '2px 8px', fontSize: 10, flexShrink: 0 }}>
                <Download size={10} /> PDF
              </button>
            </div>
          )}
        </div>

        {(rx.status === 'dispatched' || rx.status === 'ready') && (
          <div className="order-card__actions">
            {rx.status === 'dispatched' && (
              <button
                className="btn btn-sm btn-primary"
                onClick={() => handleActionWithAnimation(orderId, rx.id, 'RECEIVE_SHIPMENT')}
              >
                Confirm arrived (goods-in)
              </button>
            )}

            {rx.status === 'ready' && (
              <>
                <button
                  className="btn btn-sm"
                  onClick={() => setPrintingRx({ rx, patientName: pName })}
                >
                  <Printer size={12} /> Print dispensing label
                </button>
                <button
                  className="btn btn-sm btn-primary"
                  onClick={() => handleActionWithAnimation(orderId, rx.id, 'HANDOVER_TO_PATIENT')}
                >
                  Handover to patient
                </button>
              </>
            )}
          </div>
        )}

        {rx.items.length > 0 && (
          <div className="order-card__products">
            <span className="section-label">Prescribed products</span>
            {rx.items.map(item => (
              <div key={item.productId} className="order-product-line">
                <span className="text-secondary">{item.name} × {item.qty}</span>
                <span className="font-semibold text-primary">{money(lineRevenue(item))}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const activeTabLabel = activeTab === 'all'
    ? 'All stages'
    : STATUS_TABS.find(t => t.key === activeTab)?.label ?? 'Filtered';

  return (
    <div className="page-body">
      <div className="orders-toolbar">
        <span className="text-sm text-secondary">
          <strong className="text-primary">{filteredSubOrders.length}</strong>
          {' '}prescription{filteredSubOrders.length === 1 ? '' : 's'}
          {activeTab !== 'all' && <> in <strong className="text-primary">{activeTabLabel}</strong></>}
        </span>
        <span className="text-xs text-tertiary">
          {allSubOrders.length} total across paid orders
        </span>
      </div>

      <div className="filter-grid orders-stage-grid">
        <div
          className={`card card-surface filter-card ${activeTab === 'all' ? 'active' : ''}`}
          onClick={() => setActiveTab('all')}
        >
          <div className="filter-card__head">
            <span>All Orders</span>
            <Package size={14} className={activeTab === 'all' ? 'text-info' : 'text-muted'} />
          </div>
          <span className="filter-card__value">{allSubOrders.length}</span>
        </div>

        {STATUS_TABS.map(tab => {
          const count = allSubOrders.filter(so => so.rx.status === tab.key).length;
          let iconColor = 'text-muted';
          if (activeTab === tab.key) {
            if (tab.key === 'ready') iconColor = 'text-green';
            else if (tab.key === 'dispatched') iconColor = 'text-amber';
            else iconColor = 'text-info';
          }
          return (
            <div
              key={tab.key}
              className={`card card-surface filter-card ${activeTab === tab.key ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.key)}
            >
              <div className="filter-card__head">
                <span>{tab.shortLabel}</span>
                {React.cloneElement(tab.icon as React.ReactElement<{ className?: string; size?: number }>, { className: iconColor })}
              </div>
              <span className="filter-card__value">{count}</span>
            </div>
          );
        })}
      </div>

      {filteredSubOrders.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">
            <Package size={28} />
          </div>
          <p className="empty-desc">
            No prescription sub-orders currently in this stage.
          </p>
        </div>
      ) : (
        <div className="orders-list">
          {filteredSubOrders.map(so => renderSubOrderCard(so))}
        </div>
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
                {PHARMACY.name.toUpperCase()}
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
