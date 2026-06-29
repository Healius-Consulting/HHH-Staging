import { Upload, Plus, Minus, X, FileText, Send, CreditCard, User, CheckCircle } from 'lucide-react';
import {
  useApp,
  money,
  lineRevenue,
  lineCost,
  lineMargin,
  rxRevenue,
  orderRevenue,
  orderCost,
  marginPct,
  type LineItem,
} from '../context/AppContext';

export default function CreateOrder() {
  const { state, dispatch } = useApp();

  /* ── Active order chips (unpaid only) ── */
  const unpaidOrders = state.orders.filter(o => o.payment.status !== 'paid');
  const activeOrder = state.orders.find(o => o.id === state.activeOrderId);
  const patient = activeOrder?.patientId
    ? state.crm.find(c => c.id === activeOrder.patientId) ?? null
    : null;

  /* ── Initials helper ── */
  const initials = (name: string) =>
    name
      .split(' ')
      .map(w => w[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);

  return (
    <div className="page-body">
      <h2 className="page-title">Create Order</h2>
      <p className="page-subtitle">Build prescription sub-orders for a patient</p>

      {/* ── Order chips bar ── */}
      <div className="flex items-center gap-sm" style={{ flexWrap: 'wrap', marginBottom: 16 }}>
        {unpaidOrders.map(o => {
          const p = o.patientId ? state.crm.find(c => c.id === o.patientId) : null;
          return (
            <span
              key={o.id}
              className={`chip${o.id === state.activeOrderId ? ' active' : ''}`}
              onClick={() => dispatch({ type: 'SET_ACTIVE_ORDER', orderId: o.id })}
            >
              <User size={12} />
              {p ? p.name : 'Unlinked patient'}
            </span>
          );
        })}
        <button
          className="btn btn-sm"
          onClick={() => dispatch({ type: 'NEW_ORDER' })}
        >
          <Plus size={14} /> New patient order
        </button>
      </div>

      {/* ── Empty state ── */}
      {(!state.activeOrderId || !activeOrder) && (
        <div className="empty-state">
          <div className="empty-icon"><FileText size={22} /></div>
          No orders in progress. Start one with <strong>+ New patient order</strong> above.
        </div>
      )}

      {/* ── Main workspace ── */}
      {activeOrder && (
        <div className="split-layout">
          {/* ═══ LEFT: Main build area ═══ */}
          <div className="split-main">
            {/* ── Step 1: Link Patient ── */}
            <h3 className="card-title" style={{ marginBottom: 10 }}>1. Link patient</h3>

            {patient ? (
              <div className="patient-card" style={{ marginBottom: 20 }}>
                <div className="avatar">{initials(patient.name)}</div>
                <div className="flex-1">
                  <div className="flex items-center gap-sm" style={{ marginBottom: 2 }}>
                    <span className="font-semibold text-sm">{patient.name}</span>
                    <span className="pill pill-green">Linked</span>
                  </div>
                  <div className="text-xs text-muted">{patient.email}</div>
                  <div className="text-xs text-muted">{patient.mobile}</div>
                  <div className="text-xs text-faint">{patient.address}</div>
                </div>
              </div>
            ) : (
              <div style={{ marginBottom: 20 }}>
                <select
                  className="input select"
                  value=""
                  onChange={e => {
                    if (e.target.value) {
                      dispatch({
                        type: 'SET_ORDER_PATIENT',
                        orderId: activeOrder.id,
                        patientId: e.target.value,
                      });
                    }
                  }}
                >
                  <option value="">Select a patient…</option>
                  {state.crm.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.name} — {c.email}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* ── Step 2: Prescriptions ── */}
            <h3 className="card-title" style={{ marginBottom: 10 }}>2. Prescriptions</h3>

            {activeOrder.prescriptions.map((rx, rxIdx) => {
              const allProductIdsInRx = rx.items.map(i => i.productId);
              const availableProducts = state.catalogue.filter(
                p => !allProductIdsInRx.includes(p.id),
              );

              return (
                <div className="rx-card" key={rx.id}>
                  {/* Rx header */}
                  <div className="rx-header">
                    <span className="font-semibold text-sm">
                      <FileText size={14} style={{ marginRight: 4, verticalAlign: -2 }} />
                      Prescription #{rxIdx + 1}
                    </span>
                    {activeOrder.prescriptions.length > 1 && (
                      <button
                        className="btn btn-sm btn-danger"
                        onClick={() =>
                          dispatch({ type: 'REMOVE_RX', orderId: activeOrder.id, rxId: rx.id })
                        }
                      >
                        <X size={12} /> Remove
                      </button>
                    )}
                  </div>

                  {/* Upload zone */}
                  <div
                    className={`upload-zone${rx.copyFileName ? ' uploaded' : ''}`}
                    style={{ marginBottom: 10 }}
                    onClick={() => {
                      if (!rx.copyFileName) {
                        dispatch({
                          type: 'SET_RX_COPY',
                          orderId: activeOrder.id,
                          rxId: rx.id,
                          fileName: `prescription_scan_${rx.id}.pdf`,
                        });
                      }
                    }}
                  >
                    <div className="upload-icon">
                      {rx.copyFileName ? (
                        <CheckCircle size={18} />
                      ) : (
                        <Upload size={18} />
                      )}
                    </div>
                    <div>
                      {rx.copyFileName ? (
                        <span className="text-sm text-green font-semibold">
                          {rx.copyFileName}
                        </span>
                      ) : (
                        <span className="text-sm text-muted">
                          Upload prescription copy (PDF, JPG, PNG)
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Prescriber */}
                  <input
                    className="input"
                    placeholder="Prescriber name, e.g. Dr. A. Lee"
                    value={rx.prescriber}
                    onChange={e =>
                      dispatch({
                        type: 'SET_RX_PRESCRIBER',
                        orderId: activeOrder.id,
                        rxId: rx.id,
                        prescriber: e.target.value,
                      })
                    }
                    style={{ marginBottom: 10 }}
                  />

                  {/* Item list */}
                  {rx.items.length > 0 && (
                    <div className="item-list" style={{ marginBottom: 10 }}>
                      {rx.items.map(item => {
                        const margin = lineMargin(item);
                        return (
                          <div className="item-block" key={item.productId}>
                            <div className="item-top">
                              <span>{item.name}</span>
                              <span className="font-semibold">{money(lineRevenue(item))}</span>
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
                                <span className="font-semibold">{item.qty}</span>
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
                              <span className="text-faint">
                                Cost {money(lineCost(item))}
                              </span>
                              <span className={margin >= 25 ? 'text-green' : 'text-amber'}>
                                {margin}% margin
                              </span>
                              <button
                                className="btn btn-sm btn-danger"
                                onClick={() =>
                                  dispatch({
                                    type: 'REMOVE_ITEM_FROM_RX',
                                    orderId: activeOrder.id,
                                    rxId: rx.id,
                                    productId: item.productId,
                                  })
                                }
                              >
                                <X size={10} />
                              </button>
                            </div>

                            {/* Fee bar for low-margin items */}
                            {margin < 25 && (
                              <div className="fee-bar">
                                <span>Dispensing fee:</span>
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
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Add product */}
                  <select
                    className="input select"
                    value=""
                    onChange={e => {
                      const prod = state.catalogue.find(p => p.id === e.target.value);
                      if (prod) {
                        const newItem: LineItem = {
                          productId: prod.id,
                          name: prod.name,
                          qty: 1,
                          cost: prod.cost,
                          retail: prod.retail,
                          fee: 0,
                        };
                        dispatch({
                          type: 'ADD_ITEM_TO_RX',
                          orderId: activeOrder.id,
                          rxId: rx.id,
                          item: newItem,
                        });
                      }
                    }}
                  >
                    <option value="">+ Add product…</option>
                    {availableProducts.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.name} — {money(p.retail)}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}

            <button
              className="btn"
              onClick={() => dispatch({ type: 'ADD_RX', orderId: activeOrder.id })}
              style={{ marginTop: 4 }}
            >
              <Plus size={14} /> Add another prescription
            </button>
          </div>

          {/* ═══ RIGHT: Order summary sidebar ═══ */}
          <div className="split-side">
            <div className="card card-surface">
              <h3 className="card-title" style={{ marginBottom: 12 }}>
                <CreditCard size={14} style={{ marginRight: 4, verticalAlign: -2 }} />
                Order Summary
              </h3>

              {activeOrder.prescriptions.map((rx, rxIdx) => (
                <div key={rx.id} style={{ marginBottom: 10 }}>
                  <div className="text-xs font-semibold text-muted" style={{ marginBottom: 4 }}>
                    Rx #{rxIdx + 1}
                    {rx.prescriber && (
                      <span className="text-faint"> — {rx.prescriber}</span>
                    )}
                  </div>
                  {rx.items.length === 0 && (
                    <div className="text-xs text-faint" style={{ marginBottom: 4 }}>
                      No items yet
                    </div>
                  )}
                  {rx.items.map(item => (
                    <div className="kv-line" key={item.productId}>
                      <span className="text-xs">
                        {item.name} ×{item.qty}
                      </span>
                      <span className="text-xs font-semibold">{money(lineRevenue(item))}</span>
                    </div>
                  ))}
                  <div className="kv-line" style={{ borderTop: '1px solid var(--border)', paddingTop: 4, marginTop: 2 }}>
                    <span className="text-xs font-semibold">Rx subtotal</span>
                    <span className="text-xs font-semibold">{money(rxRevenue(rx))}</span>
                  </div>
                </div>
              ))}

              <div className="divider" />

              <div className="kv-line total">
                <span>Order total</span>
                <span>{money(orderRevenue(activeOrder))}</span>
              </div>

              <div className="kv-line">
                <span className="text-xs text-muted">Wholesale cost</span>
                <span className="text-xs">{money(orderCost(activeOrder))}</span>
              </div>

              {(() => {
                const rev = orderRevenue(activeOrder);
                const cost = orderCost(activeOrder);
                const margin = marginPct(cost, rev);
                return (
                  <div className="kv-line">
                    <span className="text-xs text-muted">Overall margin</span>
                    <span className={`text-xs font-semibold ${margin >= 25 ? 'text-green' : 'text-amber'}`}>
                      {margin}%
                    </span>
                  </div>
                );
              })()}

              <div className="divider" />

              {/* Payment section */}
              {activeOrder.payment.status === 'none' && (() => {
                const noPatient = !activeOrder.patientId;
                const missingCopy = activeOrder.prescriptions.some(rx => !rx.copyFileName);
                const noItems = activeOrder.prescriptions.some(rx => rx.items.length === 0);
                const disabled = noPatient || missingCopy || noItems;

                return (
                  <div>
                    <button
                      className="btn btn-primary"
                      disabled={disabled}
                      style={{ width: '100%' }}
                      onClick={() => {
                        dispatch({ type: 'SEND_PAYMENT_LINK', orderId: activeOrder.id });
                        dispatch({ type: 'SET_SCREEN', screen: 'review' });
                      }}
                    >
                      <Send size={14} /> Send payment link
                    </button>
                    {disabled && (
                      <div className="text-xs text-faint" style={{ marginTop: 6, textAlign: 'center' }}>
                        {noPatient && 'Link a patient'}
                        {!noPatient && missingCopy && 'Upload all Rx copies'}
                        {!noPatient && !missingCopy && noItems && 'Add items to every Rx'}
                      </div>
                    )}
                  </div>
                );
              })()}

              {activeOrder.payment.status === 'sent' && (
                <div className="flex items-center justify-between">
                  <span className="pill pill-amber">Payment link sent</span>
                  <span className="font-semibold text-sm">
                    {money(activeOrder.payment.amount)}
                  </span>
                </div>
              )}

              {activeOrder.payment.status === 'paid' && (
                <div className="flex items-center justify-between">
                  <span className="pill pill-green">Paid</span>
                  <span className="font-semibold text-sm">
                    {money(activeOrder.payment.amount)}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
