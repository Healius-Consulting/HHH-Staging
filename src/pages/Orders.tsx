import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  Clock,
  Package,
  Printer,
  RefreshCw,
  Search,
  ShieldAlert,
  XCircle,
} from 'lucide-react';
import { getUnresolvedReason, lineRevenue, money, useApp, type Prescription } from '../context/AppContext';
import { useModalFocus } from '../accessibility/useModalFocus';
import { compactPatientName } from '../utils/patientName';
import { formatPatientDob } from '../utils/patientDob';



export type CustomerOrdersTab = 'needs-action' | 'active' | 'archived' | 'rejected';

interface FlatSubOrder {
  key: string;
  orderId: number;
  patientName: string;
  patientDob: string;
  date: Date;
  rxIdx: number;
  rx: Prescription;
  placementState?: 'PENDING_PLACEMENT' | 'HELD_PRICE' | 'HELD_STOCK' | 'CANCELLATION_PENDING_REFUND' | 'PLACED' | 'CANCELLED_REFUNDED';
  rejectionReason?: string;
  isExpired?: boolean;
}

export default function Orders() {
  const { state, dispatch } = useApp();

  const [activeTab, setActiveTab] = useState<CustomerOrdersTab>('active');
  const [query, setQuery] = useState('');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [printingRx, setPrintingRx] = useState<{ rx: Prescription; patientName: string } | null>(null);
  useModalFocus<HTMLDivElement>(Boolean(printingRx), () => setPrintingRx(null));


  const allSubOrders = useMemo(() => {
    const list: FlatSubOrder[] = [];
    const now = new Date();

    state.orders
      .filter(order => order.organisationId === state.currentOrganisationId)
      .forEach(order => {
        const patient = order.patientId
          ? state.crm.find(candidate => candidate.organisationId === state.currentOrganisationId && candidate.id === order.patientId)
          : null;
        const patientName = patient?.name ?? (order.patientId ? 'Unknown patient' : 'Unassigned');
        const patientDob = patient?.dob ?? '';

        order.prescriptions.forEach((rx, index) => {
          const unresolvedReason = getUnresolvedReason(order, now);
          const isExpired = unresolvedReason === 'expired' || Boolean(order.isExpired);

          let placementState: FlatSubOrder['placementState'] = 'PLACED';
          let rejectionReason: string | undefined;

          // Classify placement / rejection state
          if (rx.status === 'awaiting-approval') {
            placementState = 'PENDING_PLACEMENT';
          }
          if (rx.items.some(i => state.catalogue.find(c => c.id === i.productId)?.availability === 'out')) {
            placementState = 'HELD_STOCK';
            rejectionReason = 'Out of stock at Curaleaf supplier';
          }
          if (order.quoteReview?.type === 'patient_price_changed' || unresolvedReason === 'rejected') {
            placementState = 'HELD_PRICE';
            rejectionReason = order.quoteReview?.type === 'patient_price_changed'
              ? 'Wholesale cost shift below 15% margin floor'
              : 'Curaleaf rejected / recreate required';
          }
          if (order.payment.status === 'none') {
            placementState = 'PENDING_PLACEMENT';
          }


          list.push({
            key: `${order.id}-${rx.id}`,
            orderId: order.id,
            patientName,
            patientDob,
            date: order.date,
            rxIdx: index + 1,
            rx,
            placementState,
            rejectionReason,
            isExpired,
          });
        });
      });

    return list.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [state.catalogue, state.crm, state.currentOrganisationId, state.orders]);

  // Filter into the 4 tabs: Needs Action, Active, Archived, Rejected
  const tabFilteredOrders = useMemo(() => {
    return allSubOrders.filter(item => {
      if (activeTab === 'needs-action') {
        return (
          item.placementState === 'HELD_PRICE' ||
          item.placementState === 'HELD_STOCK' ||
          item.placementState === 'CANCELLATION_PENDING_REFUND' ||
          item.rx.status === 'received'
        );
      }
      if (activeTab === 'active') {
        return !item.isExpired && item.placementState !== 'CANCELLED_REFUNDED' && item.placementState !== 'HELD_PRICE' && item.placementState !== 'HELD_STOCK';
      }
      if (activeTab === 'archived') {
        // Strictly expired orders (past 28 calendar days)
        return item.isExpired;
      }
      if (activeTab === 'rejected') {
        // Cancelled/refunded lines and operational/supplier rejections
        return (
          item.placementState === 'CANCELLED_REFUNDED' ||
          item.placementState === 'CANCELLATION_PENDING_REFUND' ||
          item.rejectionReason !== undefined
        );
      }
      return true;
    });
  }, [allSubOrders, activeTab]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return tabFilteredOrders.filter(item => {
      if (!needle) return true;
      return `${item.patientName} ${item.patientDob} ${formatPatientDob(item.patientDob)} ${item.orderId} ${item.rx.poRef ?? ''} ${item.rejectionReason ?? ''}`
        .toLowerCase()
        .includes(needle);
    });
  }, [tabFilteredOrders, query]);

  useEffect(() => {
    if (!filtered.some(item => item.key === selectedKey)) {
      setSelectedKey(filtered[0]?.key ?? null);
    }
  }, [filtered, selectedKey]);

  const selected = filtered.find(item => item.key === selectedKey) ?? filtered[0] ?? null;
  const fmtDate = (date: Date) => new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const rxTotal = (rx: Prescription) => rx.items.reduce((total, item) => total + lineRevenue(item), 0);

  const needsActionCount = allSubOrders.filter(
    i => i.placementState === 'HELD_PRICE' || i.placementState === 'HELD_STOCK' || i.placementState === 'CANCELLATION_PENDING_REFUND'
  ).length;
  const activeCount = allSubOrders.filter(i => !i.isExpired && i.placementState !== 'CANCELLED_REFUNDED').length;
  const archivedCount = allSubOrders.filter(i => i.isExpired).length;
  const rejectedCount = allSubOrders.filter(i => i.placementState === 'CANCELLED_REFUNDED' || i.rejectionReason !== undefined).length;

  return (
    <div className="page-body orders-page">
      <div className="filter-grid" role="group" aria-label="Customer order views">
        <button type="button" aria-pressed={activeTab === 'needs-action'} className={`filter-card ${activeTab === 'needs-action' ? 'active' : ''}`} onClick={() => setActiveTab('needs-action')}>
          <div className="filter-card__head"><span>Needs action</span><AlertTriangle size={14} className={activeTab === 'needs-action' ? 'text-amber' : 'text-muted'} /></div>
          <span className="filter-card__value">{needsActionCount}</span>
        </button>
        <button type="button" aria-pressed={activeTab === 'active'} className={`filter-card ${activeTab === 'active' ? 'active' : ''}`} onClick={() => setActiveTab('active')}>
          <div className="filter-card__head"><span>Active</span><Clock size={14} className={activeTab === 'active' ? 'text-info' : 'text-muted'} /></div>
          <span className="filter-card__value">{activeCount}</span>
        </button>
        <button type="button" aria-pressed={activeTab === 'archived'} className={`filter-card ${activeTab === 'archived' ? 'active' : ''}`} onClick={() => setActiveTab('archived')}>
          <div className="filter-card__head"><span>Archived</span><Archive size={14} className={activeTab === 'archived' ? 'text-muted' : 'text-muted'} /></div>
          <span className="filter-card__value">{archivedCount}</span>
        </button>
        <button type="button" aria-pressed={activeTab === 'rejected'} className={`filter-card ${activeTab === 'rejected' ? 'active' : ''}`} onClick={() => setActiveTab('rejected')}>
          <div className="filter-card__head"><span>Rejected</span><XCircle size={14} className={activeTab === 'rejected' ? 'text-red' : 'text-muted'} /></div>
          <span className="filter-card__value">{rejectedCount}</span>
        </button>
      </div>

      <section className="filter-toolbar">
        <div className="search-box">
          <Search size={16} />
          <input
            type="search"
            placeholder="Search by patient, order ID, PO reference or reason..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            aria-label="Search customer orders"
          />
        </div>
      </section>

      {/* Main Grid */}
      <div className="orders-grid">
        <aside className="orders-list">
          {filtered.length === 0 ? (
            <div className="empty-state">
              <Package size={32} />
              <p>No customer orders match this view.</p>
            </div>
          ) : (
            filtered.map(item => (
              <button
                type="button"
                key={item.key}
                className={`order-card-item ${selectedKey === item.key ? 'selected' : ''}`}
                onClick={() => setSelectedKey(item.key)}
              >
                <div className="order-card-header">
                  <strong>#{item.orderId}</strong>
                  <span className="date">{fmtDate(item.date)}</span>
                </div>
                <div className="order-card-patient">
                  <span>{compactPatientName(item.patientName)}</span>
                </div>
                <div className="order-card-meta">
                  <span>{money(rxTotal(item.rx))}</span>
                  {item.placementState === 'HELD_PRICE' ? (
                    <span className="pill pill-amber">Price Hold</span>
                  ) : item.placementState === 'HELD_STOCK' ? (
                    <span className="pill pill-amber">Stock Hold</span>
                  ) : item.placementState === 'CANCELLATION_PENDING_REFUND' ? (
                    <span className="pill pill-amber">Refund Pending</span>
                  ) : item.placementState === 'CANCELLED_REFUNDED' ? (
                    <span className="pill pill-red">Cancelled</span>
                  ) : item.isExpired ? (
                    <span className="pill pill-neutral">Expired</span>
                  ) : (
                    <span className="pill pill-green">Placed</span>
                  )}
                </div>
              </button>
            ))
          )}
        </aside>

        {/* Selected Order Detail */}
        <main className="order-detail-pane">
          {selected ? (
            <div className="detail-container">
              <header className="detail-header">
                <div>
                  <h2>Order #{selected.orderId}</h2>
                  <p>
                    Patient: <strong>{selected.patientName}</strong> · Placed {fmtDate(selected.date)}
                  </p>
                </div>
                <div className="detail-actions">
                  {(selected.isExpired || selected.placementState === 'CANCELLED_REFUNDED' || selected.rejectionReason) && (
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => {
                        dispatch({ type: 'START_REDO_ORDER', sourceOrderId: selected.orderId });
                        dispatch({
                          type: 'ADD_TOAST',
                          message: `Started a redo draft from order #${selected.orderId}. Attach the new prescription PDF for Curaleaf authentication.`,
                          toastType: 'info',
                        });
                      }}
                    >
                      <RefreshCw size={14} />
                      <span>Deal with Order / Redo Prescription</span>
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => setPrintingRx({ rx: selected.rx, patientName: selected.patientName })}
                  >
                    <Printer size={14} />
                    <span>Print label</span>
                  </button>
                </div>

              </header>

              {/* Status Banner */}
              {selected.rejectionReason ? (
                <div className="alert-box alert-danger">
                  <ShieldAlert size={18} />
                  <div>
                    <strong>Order Exception / Rejection Reason</strong>
                    <p>{selected.rejectionReason}</p>
                  </div>
                </div>
              ) : null}

              {/* Prescription Items & Placement Table */}
              <section className="detail-section">
                <h3>Prescribed Line Items & Placement Status</h3>
                <table className="placement-table">
                  <thead>
                    <tr>
                      <th>Medicine Name</th>
                      <th>Quantity</th>
                      <th>Patient Charge</th>
                      <th>Placement Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selected.rx.items.map(line => {
                      const isOutOfStock = state.catalogue.find(c => c.id === line.productId)?.availability === 'out';
                      return (
                        <tr key={line.productId}>
                          <td>
                            <strong>{line.name}</strong>
                          </td>
                          <td>{line.qty} pack(s)</td>
                          <td>{money(lineRevenue(line))}</td>
                          <td>
                            <span
                              className={`pill ${
                                isOutOfStock
                                  ? 'pill-amber'
                                  : selected.placementState === 'HELD_PRICE'
                                  ? 'pill-amber'
                                  : selected.placementState === 'CANCELLED_REFUNDED'
                                  ? 'pill-red'
                                  : 'pill-green'
                              }`}
                            >
                              {isOutOfStock
                                ? 'HELD_STOCK'
                                : selected.placementState === 'HELD_PRICE'
                                ? 'HELD_PRICE'
                                : selected.placementState === 'CANCELLED_REFUNDED'
                                ? 'CANCELLED_REFUNDED'
                                : 'PLACED'}
                            </span>
                          </td>
                          <td>
                            {selected.placementState === 'HELD_PRICE' ? (
                              <button type="button" className="btn btn-secondary btn-xs">
                                Absorb & place
                              </button>
                            ) : isOutOfStock ? (
                              <button type="button" className="btn btn-secondary btn-xs">
                                Approve substitution
                              </button>
                            ) : (
                              <span className="text-muted">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>

                </table>
              </section>
            </div>
          ) : (
            <div className="empty-detail">
              <Package size={48} />
              <p>Select an order from the workspace list to view timeline and details.</p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
