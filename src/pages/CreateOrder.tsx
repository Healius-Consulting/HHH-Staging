import { useState, useEffect, useMemo } from 'react';
import { Upload, Plus, Minus, X, FileText, Send, CreditCard, User, CheckCircle, Search, AlertTriangle, ListFilter } from 'lucide-react';
import {
  useApp,
  money,
  lineRevenue,
  lineCost,
  lineMargin,
  orderRevenue,
  orderCost,
  marginPct,
  TYPE_LABELS,
  STOCK_LABELS,
  type LineItem,
  type CatalogueItem,
} from '../context/AppContext';

const TYPE_FILTERS = ['All', 'oil', 'flos', 'capsule', 'lozenge', 'vape'] as const;

export default function CreateOrder() {
  const { state, dispatch } = useApp();

  /* ── Draft Orders Selection ── */
  const draftOrders = state.orders.filter(o => o.payment.status === 'none');
  const activeOrder = state.orders.find(o => o.id === state.activeOrderId && o.payment.status === 'none');
  const patient = activeOrder?.patientId
    ? state.crm.find(c => c.id === activeOrder.patientId) ?? null
    : null;

  /* ── Active Prescription Selection ── */
  const [selectedRxId, setSelectedRxId] = useState<number | null>(null);

  // Auto-default activeRxId to the first prescription in the active order
  useEffect(() => {
    if (activeOrder && activeOrder.prescriptions.length > 0) {
      const exists = activeOrder.prescriptions.some(rx => rx.id === selectedRxId);
      if (!exists) {
        setSelectedRxId(activeOrder.prescriptions[0].id);
      }
    } else {
      setSelectedRxId(null);
    }
  }, [activeOrder, selectedRxId]);

  /* ── Prescription scan local progress ── */
  const [scanningRxId, setScanningRxId] = useState<number | null>(null);
  const [scanProgress, setScanProgress] = useState(0);

  const startScan = (rxId: number) => {
    setScanningRxId(rxId);
    setScanProgress(0);
    dispatch({ type: 'ADD_TOAST', message: 'Analyzing prescription PDF metadata...', toastType: 'info' });
  };

  useEffect(() => {
    if (scanningRxId === null || !activeOrder) return;
    const interval = setInterval(() => {
      setScanProgress(prev => {
        const next = prev + Math.floor(Math.random() * 14) + 6;
        if (next >= 100) {
          clearInterval(interval);
          dispatch({
            type: 'SET_RX_COPY',
            orderId: activeOrder.id,
            rxId: scanningRxId,
            fileName: `prescription_scan_${scanningRxId}.pdf`,
          });
          dispatch({ type: 'ADD_TOAST', message: `Prescription copy prescription_scan_${scanningRxId}.pdf verified & attached.`, toastType: 'success' });
          setScanningRxId(null);
          return 100;
        }
        return next;
      });
    }, 100);
    return () => clearInterval(interval);
  }, [scanningRxId, activeOrder, dispatch]);

  /* ── Product Catalog Search & Category Filters ── */
  const [catalogQuery, setCatalogQuery] = useState('');
  const [catalogTypeFilter, setCatalogTypeFilter] = useState<string>('All');

  const filteredProducts = useMemo(() => {
    let items = state.catalogue;
    if (catalogQuery.trim()) {
      const q = catalogQuery.toLowerCase();
      items = items.filter(i => i.name.toLowerCase().includes(q));
    }
    if (catalogTypeFilter !== 'All') {
      items = items.filter(i => i.type === catalogTypeFilter);
    }
    return items;
  }, [state.catalogue, catalogQuery, catalogTypeFilter]);

  const handleAddToRx = (item: CatalogueItem) => {
    if (!activeOrder) {
      dispatch({ type: 'ADD_TOAST', message: 'Please create an active order first.', toastType: 'warning' });
      return;
    }
    if (selectedRxId === null) {
      dispatch({ type: 'ADD_TOAST', message: 'Please select a prescription block (Column 1) to edit.', toastType: 'warning' });
      return;
    }

    const rx = activeOrder.prescriptions.find(r => r.id === selectedRxId);
    if (!rx) return;

    if (rx.items.some(li => li.productId === item.id)) {
      dispatch({ type: 'ADD_TOAST', message: `"${item.name}" is already in this prescription.`, toastType: 'warning' });
      return;
    }

    const lineItem: LineItem = {
      productId: item.id,
      name: item.name,
      qty: 1,
      cost: item.cost,
      retail: item.retail,
      fee: 0,
    };

    dispatch({ type: 'ADD_ITEM_TO_RX', orderId: activeOrder.id, rxId: selectedRxId, item: lineItem });
    dispatch({ type: 'ADD_TOAST', message: `Added "${item.name}" to Rx #${activeOrder.prescriptions.indexOf(rx) + 1}.`, toastType: 'success' });
  };

  const initials = (name: string) =>
    name
      .split(' ')
      .map(w => w[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);

  const getStockClass = (stock: CatalogueItem['stock']) => {
    switch (stock) {
      case 'in': return 'stock-dot stock-in';
      case 'low': return 'stock-dot stock-low';
      case 'out': return 'stock-dot stock-out';
    }
  };

  return (
    <div className="page-body">
      {/* ── Active draft selection chips ── */}
      <div className="flex items-center gap-sm" style={{ flexWrap: 'wrap', marginBottom: 16 }}>
        <span className="text-xs font-bold text-muted uppercase">Active Session drafts:</span>
        {draftOrders.map(o => {
          const p = o.patientId ? state.crm.find(c => c.id === o.patientId) : null;
          return (
            <button
              key={o.id}
              className={`chip${o.id === state.activeOrderId ? ' active' : ''}`}
              onClick={() => dispatch({ type: 'SET_ACTIVE_ORDER', orderId: o.id })}
            >
              <User size={12} />
              {p ? p.name : `Draft Order #${o.id}`}
            </button>
          );
        })}
        <button
          className="btn btn-sm btn-primary"
          onClick={() => dispatch({ type: 'NEW_ORDER' })}
        >
          <Plus size={12} /> New Draft Order
        </button>
      </div>

      {/* ── Empty State ── */}
      {(!state.activeOrderId || !activeOrder) ? (
        <div className="empty-state">
          <div className="empty-icon"><FileText size={32} /></div>
          <h3>No Active Rx Draft</h3>
          <p style={{ marginTop: 6, fontSize: 'var(--font-sm)', color: 'var(--text-secondary)' }}>
            Start a new order using the <strong>+ New Draft Order</strong> button above.
          </p>
        </div>
      ) : (
        <div className="workspace-3col">
          
          {/* ═══ COLUMN 1: Patient Link & Rx Files ═══ */}
          <div className="col-left">
            <div className="col-header">
              <span className="col-header-title">
                <User size={16} /> 1. Link &amp; Documents
              </span>
            </div>
            
            <div className="col-content">
              {/* Patient linking */}
              <div style={{ marginBottom: 20 }}>
                <span className="text-xs font-bold text-muted uppercase" style={{ display: 'block', marginBottom: 8 }}>Linked Patient</span>
                {patient ? (
                  <div className="patient-card">
                    <div className="avatar">{initials(patient.name)}</div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-sm">{patient.name}</span>
                        <span className="pill pill-green">Linked</span>
                      </div>
                      <div className="text-xs text-muted" style={{ marginTop: 2 }}>{patient.email}</div>
                      <div className="text-xs text-faint" style={{ marginTop: 2 }}>{patient.mobile}</div>
                    </div>
                  </div>
                ) : (
                  <div>
                    <select
                      className="input select"
                      value=""
                      onChange={e => {
                        if (e.target.value) {
                          const p = state.crm.find(c => c.id === e.target.value);
                          dispatch({
                            type: 'SET_ORDER_PATIENT',
                            orderId: activeOrder.id,
                            patientId: e.target.value,
                          });
                          if (p) {
                            dispatch({ type: 'ADD_TOAST', message: `Linked patient "${p.name}" to order.`, toastType: 'success' });
                          }
                        }
                      }}
                    >
                      <option value="">Link a CRM patient...</option>
                      {state.crm.map(c => (
                        <option key={c.id} value={c.id}>
                          {c.name} ({c.email})
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              <div className="divider" />

              {/* Prescriptions stack */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold text-muted uppercase">Prescription Uploads ({activeOrder.prescriptions.length})</span>
                </div>

                {activeOrder.prescriptions.map((rx, rxIdx) => {
                  const isSelected = selectedRxId === rx.id;
                  return (
                    <div 
                      key={rx.id} 
                      className={`card ${isSelected ? 'card-surface' : ''}`}
                      style={{ 
                        cursor: 'pointer',
                        borderColor: isSelected ? 'var(--green-500)' : 'var(--border)',
                        boxShadow: isSelected ? 'var(--shadow-glow)' : 'none',
                        margin: 0
                      }}
                      onClick={() => setSelectedRxId(rx.id)}
                    >
                      <div className="flex justify-between items-center" style={{ marginBottom: 8 }}>
                        <span className="text-sm font-semibold flex items-center gap-xs">
                          <FileText size={14} className={isSelected ? 'text-green' : 'text-muted'} />
                          Rx #{rxIdx + 1}
                        </span>
                        {isSelected && <span className="pill pill-green" style={{ fontSize: 9, padding: '2px 6px' }}>Active</span>}
                        {activeOrder.prescriptions.length > 1 && (
                          <button
                            className="btn btn-sm btn-danger"
                            style={{ padding: '2px 4px' }}
                            onClick={(e) => {
                              e.stopPropagation();
                              dispatch({ type: 'REMOVE_RX', orderId: activeOrder.id, rxId: rx.id });
                              dispatch({ type: 'ADD_TOAST', message: `Removed Rx #${rxIdx + 1}.`, toastType: 'info' });
                            }}
                          >
                            <X size={10} />
                          </button>
                        )}
                      </div>

                      {/* File upload state */}
                      <div
                        className={`upload-zone${rx.copyFileName ? ' uploaded' : ''} ${scanningRxId === rx.id ? 'scanning' : ''}`}
                        style={{ padding: '8px 12px', fontSize: 12 }}
                        onClick={(e) => {
                          if (rx.copyFileName || scanningRxId !== null) return;
                          e.stopPropagation();
                          startScan(rx.id);
                        }}
                      >
                        <div className="upload-icon">
                          {rx.copyFileName ? <CheckCircle size={14} className="text-green" /> : <Upload size={14} />}
                        </div>
                        <div style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', flex: 1 }}>
                          {scanningRxId === rx.id ? (
                            <span className="text-green font-semibold">Scanning {scanProgress}%</span>
                          ) : rx.copyFileName ? (
                            <span className="text-green">{rx.copyFileName}</span>
                          ) : (
                            <span className="text-muted">Click to scan Rx copy</span>
                          )}
                        </div>
                      </div>

                      {/* Scanning laser UI */}
                      {scanningRxId === rx.id && (
                        <div className="scanner-container scanning" style={{ marginTop: 8, padding: 8 }}>
                          <div className="scanner-laser" />
                          <div className="scan-progress-wrapper" style={{ marginTop: 0 }}>
                            <div className="scan-progress-track">
                              <div className="scan-progress-fill" style={{ width: `${scanProgress}%` }} />
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Prescriber Metadata */}
                      <input
                        className="input"
                        placeholder="Prescriber name (e.g. Dr Lee)"
                        value={rx.prescriber}
                        onClick={(e) => e.stopPropagation()}
                        onChange={e =>
                          dispatch({
                            type: 'SET_RX_PRESCRIBER',
                            orderId: activeOrder.id,
                            rxId: rx.id,
                            prescriber: e.target.value,
                          })
                        }
                        style={{ marginTop: 8, padding: '4px 8px', fontSize: 12 }}
                      />
                    </div>
                  );
                })}

                <button
                  className="btn btn-sm btn-primary"
                  onClick={() => dispatch({ type: 'ADD_RX', orderId: activeOrder.id })}
                  style={{ width: '100%', marginTop: 4 }}
                >
                  <Plus size={12} /> Add another Rx copy
                </button>
              </div>
            </div>
          </div>

          {/* ═══ COLUMN 2: Prescription Builder Workspace ═══ */}
          <div className="col-center">
            <div className="col-header">
              <span className="col-header-title">
                <FileText size={16} /> 2. Prescription Workspace
              </span>
              {activeOrder.prescriptions.length > 0 && selectedRxId && (
                <span className="pill pill-green">
                  Editing Rx #{activeOrder.prescriptions.findIndex(r => r.id === selectedRxId) + 1}
                </span>
              )}
            </div>

            <div className="col-content" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {activeOrder.prescriptions.map((rx, rxIdx) => {
                const isSelected = selectedRxId === rx.id;
                if (!isSelected) return null;

                return (
                  <div key={rx.id}>
                    <div className="flex justify-between items-center" style={{ marginBottom: 12 }}>
                      <span className="text-xs font-bold text-muted uppercase">Line items inside Rx #{rxIdx + 1}</span>
                      <span className="text-xs text-muted">{rx.items.length} items assigned</span>
                    </div>

                    {rx.items.length === 0 ? (
                      <div className="empty-state" style={{ padding: '24px 12px' }}>
                        <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                          No products added to this prescription yet.<br />
                          Select a product from the <strong>Curaleaf Catalog (Column 3)</strong> to add it here.
                        </p>
                      </div>
                    ) : (
                      <div className="item-list">
                        {rx.items.map(item => {
                          const margin = lineMargin(item);
                          return (
                            <div className="item-block" key={item.productId}>
                              <div className="item-top">
                                <span className="font-semibold" style={{ fontSize: 13 }}>{item.name}</span>
                                <span className="font-bold">{money(lineRevenue(item))}</span>
                              </div>

                              <div className="item-meta">
                                <div className="qty-control">
                                  <button
                                    className="qty-btn"
                                    onClick={() =>
                                      dispatch({
                                        type: 'UPDATE_ITEM_QTY',
                                        orderId: activeOrder.id,
                                        rxId: rx.id,
                                        productId: item.productId,
                                        qty: item.qty - 1,
                                      })
                                    }
                                  >
                                    <Minus size={12} />
                                  </button>
                                  <span style={{ minWidth: 16, textAlign: 'center' }}>{item.qty}</span>
                                  <button
                                    className="qty-btn"
                                    onClick={() =>
                                      dispatch({
                                        type: 'UPDATE_ITEM_QTY',
                                        orderId: activeOrder.id,
                                        rxId: rx.id,
                                        productId: item.productId,
                                        qty: item.qty + 1,
                                      })
                                    }
                                  >
                                    <Plus size={12} />
                                  </button>
                                </div>

                                <div>
                                  <span className="text-faint">Cost: {money(lineCost(item))} &middot; </span>
                                  <span className={margin >= 25 ? 'text-green' : 'text-amber'}>
                                    {margin}% margin
                                  </span>
                                </div>

                                <button
                                  className="btn btn-sm btn-danger"
                                  style={{ padding: 4 }}
                                  onClick={() =>
                                    dispatch({
                                      type: 'REMOVE_ITEM_FROM_RX',
                                      orderId: activeOrder.id,
                                      rxId: rx.id,
                                      productId: item.productId,
                                    })
                                  }
                                >
                                  <X size={12} />
                                </button>
                              </div>

                              {/* Dispensing fee trigger if margin is low */}
                              {margin < 25 && (
                                <div className="fee-bar">
                                  <span className="text-amber flex items-center gap-xs">
                                    <AlertTriangle size={12} /> Low Margin. Append Fee:
                                  </span>
                                  <div className="flex gap-xs">
                                    {[0, 5, 10, 15].map(fee => (
                                      <button
                                        key={fee}
                                        className={`fee-btn${item.fee === fee ? ' active' : ''}`}
                                        onClick={() =>
                                          dispatch({
                                            type: 'SET_ITEM_FEE',
                                            orderId: activeOrder.id,
                                            rxId: rx.id,
                                            productId: item.productId,
                                            fee,
                                          })
                                        }
                                      >
                                        £{fee}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}

              <div className="divider" style={{ marginTop: 'auto' }} />

              {/* Overall Summary section */}
              <div className="card card-surface" style={{ margin: 0 }}>
                <h4 className="font-semibold text-sm" style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <CreditCard size={14} /> Overall Order Summary
                </h4>

                <div className="kv-line">
                  <span className="text-muted">Total Sub-orders (Rxs)</span>
                  <span className="font-semibold">{activeOrder.prescriptions.length}</span>
                </div>

                <div className="kv-line">
                  <span className="text-muted">Total Wholesale Cost</span>
                  <span>{money(orderCost(activeOrder))}</span>
                </div>

                {(() => {
                  const rev = orderRevenue(activeOrder);
                  const cost = orderCost(activeOrder);
                  const margin = marginPct(cost, rev);
                  return (
                    <div className="kv-line">
                      <span className="text-muted">Consolidated Margin</span>
                      <span className={`font-bold ${margin >= 25 ? 'text-green' : 'text-amber'}`}>
                        {margin}%
                      </span>
                    </div>
                  );
                })()}

                <div className="kv-line total" style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
                  <span>Order Grand Total</span>
                  <span className="text-green font-bold">{money(orderRevenue(activeOrder))}</span>
                </div>

                {/* Submit / Link Actions */}
                <div style={{ marginTop: 16 }}>
                  {(() => {
                    const noPatient = !activeOrder.patientId;
                    const missingCopy = activeOrder.prescriptions.some(rx => !rx.copyFileName);
                    const noItems = activeOrder.prescriptions.some(rx => rx.items.length === 0);
                    const disabled = noPatient || missingCopy || noItems;

                    return (
                      <div>
                        <button
                          className="btn btn-primary"
                          disabled={disabled}
                          style={{ width: '100%', padding: '12px' }}
                          onClick={() => {
                            dispatch({ type: 'SEND_PAYMENT_LINK', orderId: activeOrder.id });
                            dispatch({ type: 'ADD_TOAST', message: 'Worldpay payment request SMS/Email sent to patient.', toastType: 'success' });
                            dispatch({ type: 'SET_SCREEN', screen: 'review' });
                          }}
                        >
                          <Send size={14} /> Send Worldpay Payment Link
                        </button>
                        {disabled && (
                          <div className="text-xs text-amber" style={{ marginTop: 8, textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                            <AlertTriangle size={12} />
                            <span>
                              {noPatient && 'Link a CRM patient'}
                              {!noPatient && missingCopy && 'Upload copy for all prescriptions'}
                              {!noPatient && !missingCopy && noItems && 'Add products to all prescriptions'}
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              </div>
            </div>
          </div>

          {/* ═══ COLUMN 3: Searchable Curaleaf Product Catalog ═══ */}
          <div className="col-right">
            <div className="col-header">
              <span className="col-header-title">
                <ListFilter size={16} /> 3. Curaleaf Catalog
              </span>
            </div>

            <div className="col-content" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* Search bar */}
              <div style={{ position: 'relative' }}>
                <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }} />
                <input
                  className="input"
                  placeholder="Search products..."
                  value={catalogQuery}
                  onChange={e => setCatalogQuery(e.target.value)}
                  style={{ paddingLeft: 30 }}
                />
              </div>

              {/* Filter chips */}
              <div className="flex gap-xs" style={{ flexWrap: 'wrap' }}>
                {TYPE_FILTERS.map(t => (
                  <button
                    key={t}
                    className={`chip ${catalogTypeFilter === t ? 'chip-active' : ''}`}
                    style={{ padding: '2px 8px', fontSize: 10 }}
                    onClick={() => setCatalogTypeFilter(t)}
                  >
                    {t === 'All' ? 'All' : TYPE_LABELS[t] || t}
                  </button>
                ))}
              </div>

              {/* Product catalog list */}
              <div className="catalog-list">
                {filteredProducts.length === 0 ? (
                  <div className="text-center text-xs text-muted" style={{ padding: '20px 0' }}>
                    No products match filter.
                  </div>
                ) : (
                  filteredProducts.map(item => {
                    const margin = marginPct(item.cost, item.retail);
                    const isOutOfStock = item.stock === 'out';
                    
                    return (
                      <div 
                        key={item.id} 
                        className="catalog-item-card"
                        style={{ opacity: isOutOfStock ? 0.6 : 1 }}
                      >
                        <div className="catalog-item-header">
                          <span className="catalog-item-name">{item.name}</span>
                          <span className="pill pill-neutral" style={{ fontSize: 9, padding: '1px 5px' }}>
                            {TYPE_LABELS[item.type] || item.type}
                          </span>
                        </div>

                        <div className="catalog-item-meta">
                          <div className="stock-indicator">
                            <span className={getStockClass(item.stock)} />
                            <span style={{ fontSize: 11 }}>{STOCK_LABELS[item.stock]}</span>
                          </div>
                          
                          <div className="catalog-item-prices">
                            <span>Cost: {money(item.cost)}</span>
                            <span className="font-semibold text-primary">Price: {money(item.retail)}</span>
                          </div>
                        </div>

                        <div className="flex justify-between items-center" style={{ marginTop: 4 }}>
                          <span className={margin >= 25 ? 'text-green text-xs' : 'text-amber text-xs'}>
                            {margin}% base margin
                          </span>
                          
                          <button
                            className="btn btn-sm btn-primary"
                            disabled={isOutOfStock}
                            style={{ padding: '4px 8px' }}
                            onClick={() => handleAddToRx(item)}
                          >
                            <Plus size={12} /> Add to Rx
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>

        </div>
      )}
    </div>
  );
}
