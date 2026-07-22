import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { AlertTriangle, ArrowRight, Banknote, CheckCircle, CreditCard, FileText, Minus, Plus, Search, Send, Trash2, Upload } from 'lucide-react';
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
  type PaymentRoute,
} from '../context/AppContext';

const TYPE_FILTERS = ['All', 'oil', 'flos', 'capsule', 'lozenge', 'vape'] as const;

export default function CreateOrder() {
  const { state, dispatch } = useApp();
  const tenantPatients = state.crm.filter(patient => patient.organisationId === state.currentOrganisationId && patient.status === 'HHH approved');
  const organisation = state.organisations.find(org => org.id === state.currentOrganisationId) ?? state.organisations[0];
  const canUseWorldpay = organisation.worldpay.enabled && organisation.worldpay.status === 'connected';
  const draftOrders = state.orders.filter(order => order.organisationId === state.currentOrganisationId && order.payment.status === 'none');
  const activeOrder = state.orders.find(order => order.organisationId === state.currentOrganisationId && order.id === state.activeOrderId && order.payment.status === 'none');
  const patient = activeOrder?.patientId ? tenantPatients.find(candidate => candidate.id === activeOrder.patientId) ?? null : null;
  const [selectedRxId, setSelectedRxId] = useState<number | null>(null);
  const [scanningRxId, setScanningRxId] = useState<number | null>(null);
  const [scanProgress, setScanProgress] = useState(0);
  const [catalogQuery, setCatalogQuery] = useState('');
  const [catalogTypeFilter, setCatalogTypeFilter] = useState<string>('All');
  const [selectedPaymentRoute, setSelectedPaymentRoute] = useState<Exclude<PaymentRoute, null>>(canUseWorldpay ? 'worldpay' : 'pharmacy');

  useEffect(() => {
    if (!activeOrder?.prescriptions.length) return setSelectedRxId(null);
    if (!activeOrder.prescriptions.some(rx => rx.id === selectedRxId)) setSelectedRxId(activeOrder.prescriptions[0].id);
  }, [activeOrder, selectedRxId]);

  useEffect(() => {
    setSelectedPaymentRoute(canUseWorldpay ? 'worldpay' : 'pharmacy');
  }, [activeOrder?.id, canUseWorldpay]);

  useEffect(() => {
    if (scanningRxId === null || !activeOrder) return;
    const interval = window.setInterval(() => setScanProgress(progress => Math.min(100, progress + Math.floor(Math.random() * 14) + 6)), 100);
    return () => window.clearInterval(interval);
  }, [activeOrder, scanningRxId]);

  useEffect(() => {
    if (scanProgress < 100 || scanningRxId === null || !activeOrder) return;
    const completedRxId = scanningRxId;
    setScanningRxId(null);
    dispatch({ type: 'SET_RX_COPY', orderId: activeOrder.id, rxId: completedRxId, fileName: `prescription_scan_${completedRxId}.pdf` });
    dispatch({ type: 'ADD_TOAST', message: `Prescription copy prescription_scan_${completedRxId}.pdf verified and attached.`, toastType: 'success' });
  }, [activeOrder, dispatch, scanProgress, scanningRxId]);

  const filteredProducts = useMemo(() => state.catalogue.filter(item => {
    const matchesQuery = !catalogQuery.trim() || item.name.toLowerCase().includes(catalogQuery.toLowerCase());
    return matchesQuery && (catalogTypeFilter === 'All' || item.type === catalogTypeFilter);
  }), [catalogQuery, catalogTypeFilter, state.catalogue]);

  const selectedRx = activeOrder?.prescriptions.find(rx => rx.id === selectedRxId) ?? null;
  const selectedRxIndex = activeOrder && selectedRx ? activeOrder.prescriptions.findIndex(rx => rx.id === selectedRx.id) : -1;
  const priceOverrides = state.formularyPrices[state.currentOrganisationId] ?? {};
  const patientPriceFor = (item: CatalogueItem) => priceOverrides[item.id] ?? item.retail;
  const readiness = activeOrder ? [
    { label: 'Approved patient linked', complete: Boolean(activeOrder.patientId) },
    { label: 'Prescription copies attached', complete: activeOrder.prescriptions.every(rx => Boolean(rx.copyFileName)) },
    { label: 'Prescriber recorded', complete: activeOrder.prescriptions.every(rx => Boolean(rx.prescriber.trim())) },
    { label: 'Products assigned', complete: activeOrder.prescriptions.every(rx => rx.items.length > 0) },
  ] : [];
  const readyForPayment = readiness.every(item => item.complete);

  const initials = (name: string) => name.split(' ').map(word => word[0]).join('').toUpperCase().slice(0, 2);
  const stockClass = (stock: CatalogueItem['stock']) => `stock-dot stock-${stock}`.replace('stock-in', 'stock-in').replace('stock-low', 'stock-low').replace('stock-out', 'stock-out');

  const startScan = (rxId: number) => {
    setScanningRxId(rxId);
    setScanProgress(0);
    dispatch({ type: 'ADD_TOAST', message: 'Reading prescription document…', toastType: 'info' });
  };

  const addToRx = (item: CatalogueItem) => {
    if (!activeOrder || !selectedRx) return;
    if (selectedRx.items.some(line => line.productId === item.id)) return;
    const lineItem: LineItem = { productId: item.id, name: item.name, qty: 1, cost: item.cost, retail: patientPriceFor(item) };
    dispatch({ type: 'ADD_ITEM_TO_RX', orderId: activeOrder.id, rxId: selectedRx.id, item: lineItem });
    dispatch({ type: 'ADD_TOAST', message: `Added “${item.name}” to Rx ${selectedRxIndex + 1}.`, toastType: 'success' });
  };

  const createPaymentRequest = () => {
    if (!activeOrder || !readyForPayment) return;
    if (selectedPaymentRoute === 'worldpay') {
      if (!canUseWorldpay) return;
      dispatch({ type: 'SEND_PAYMENT_LINK', orderId: activeOrder.id });
      dispatch({ type: 'ADD_TOAST', message: 'Worldpay payment request created. The order will remain in Payments until the provider confirms the transaction.', toastType: 'success' });
    } else {
      dispatch({ type: 'START_MANUAL_PAYMENT', orderId: activeOrder.id });
      dispatch({ type: 'ADD_TOAST', message: 'Pharmacy-managed payment selected. Confirm receipt from the Payments workspace after funds are received.', toastType: 'success' });
    }
    dispatch({ type: 'SET_SCREEN', screen: 'review' });
  };

  return (
    <div className="page-body rx-workbench">
      <section className="rx-draft-bar" aria-label="Prescription draft sessions">
        <div className="rx-draft-bar__title"><span className="section-label">Draft sessions</span><strong>{draftOrders.length} open</strong></div>
        <div className="rx-draft-tabs" role="tablist" aria-label="Open prescription drafts">
          {draftOrders.map(order => {
            const draftPatient = order.patientId ? tenantPatients.find(candidate => candidate.id === order.patientId) : null;
            const active = order.id === state.activeOrderId;
            return (
              <button type="button" role="tab" aria-selected={active} key={order.id} className={`rx-draft-tab${active ? ' active' : ''}`} onClick={() => dispatch({ type: 'SET_ACTIVE_ORDER', orderId: order.id })}>
                <span className="rx-draft-tab__avatar">{draftPatient ? initials(draftPatient.name) : '—'}</span>
                <span><strong>{draftPatient?.name ?? `Unlinked draft #${order.id}`}</strong><small>{order.prescriptions.length} record{order.prescriptions.length === 1 ? '' : 's'}</small></span>
              </button>
            );
          })}
        </div>
        <button type="button" className="btn btn-sm btn-primary rx-new-draft" onClick={() => dispatch({ type: 'NEW_ORDER' })}><Plus size={14} /> New prescription</button>
      </section>

      {!activeOrder ? (
        <div className="empty-state"><div className="empty-icon"><FileText size={32} /></div><h3>No active prescription</h3><p className="empty-desc">Start a prescription, link an approved patient and add the supplied prescription records.</p></div>
      ) : (
        <>
          <section className="rx-patient-band">
            <div className="rx-patient-band__identity">
              <span className="rx-step-number">01</span>
              {patient ? (
                <><span className="avatar">{initials(patient.name)}</span><span><small>Approved patient</small><strong>{patient.name}</strong><em>{patient.email} · {patient.mobile}</em></span><span className="pill pill-green"><CheckCircle size={11} /> Linked</span></>
              ) : (
                <label className="rx-patient-picker">
                  <span><small>Start here</small><strong>Link an approved patient</strong></span>
                  <select className="input select" value="" onChange={event => {
                    if (!event.target.value) return;
                    const linkedPatient = tenantPatients.find(candidate => candidate.id === event.target.value);
                    dispatch({ type: 'SET_ORDER_PATIENT', orderId: activeOrder.id, patientId: event.target.value });
                    if (linkedPatient) dispatch({ type: 'ADD_TOAST', message: `Linked patient “${linkedPatient.name}”.`, toastType: 'success' });
                  }}><option value="">Choose patient…</option>{tenantPatients.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.name} · {candidate.email}</option>)}</select>
                </label>
              )}
            </div>
            <div className="rx-readiness-summary" aria-label="Prescription readiness">
              {readiness.map(item => <span key={item.label} className={item.complete ? 'complete' : ''}>{item.complete ? <CheckCircle size={13} /> : <span className="rx-readiness-dot" />}{item.label}</span>)}
            </div>
          </section>

          <div className="rx-workbench-layout">
            <main className="rx-workbench-main">
              <section className="rx-surface rx-record-editor">
                <header className="rx-surface__header">
                  <div><span className="rx-step-number">02</span><span><small>Prescription records</small><strong>Verify and build the selected Rx</strong></span></div>
                  <button type="button" className="btn btn-sm" onClick={() => dispatch({ type: 'ADD_RX', orderId: activeOrder.id })}><Plus size={13} /> Add record</button>
                </header>
                <div className="rx-record-tabs" role="tablist" aria-label="Prescription records">
                  {activeOrder.prescriptions.map((rx, index) => {
                    const active = rx.id === selectedRxId;
                    return <button key={rx.id} type="button" role="tab" aria-selected={active} className={active ? 'active' : ''} onClick={() => setSelectedRxId(rx.id)}><FileText size={14} /><span><strong>Rx {index + 1}</strong><small>{rx.items.length} item{rx.items.length === 1 ? '' : 's'}</small></span><span className={`rx-record-state${rx.copyFileName && rx.prescriber.trim() ? ' complete' : ''}`} aria-hidden="true" /></button>;
                  })}
                </div>

                {selectedRx && (
                  <div className="rx-record-body">
                    <div className="rx-record-evidence">
                      <div className="rx-record-evidence__heading"><span><small>Editing</small><strong>Prescription {selectedRxIndex + 1}</strong></span>{activeOrder.prescriptions.length > 1 && <button type="button" className="icon-button danger" aria-label={`Delete prescription ${selectedRxIndex + 1}`} title="Delete prescription record" onClick={() => { dispatch({ type: 'REMOVE_RX', orderId: activeOrder.id, rxId: selectedRx.id }); dispatch({ type: 'ADD_TOAST', message: `Removed Rx ${selectedRxIndex + 1}.`, toastType: 'info' }); }}><Trash2 size={14} /></button>}</div>
                      <button type="button" className={`rx-document-control${selectedRx.copyFileName ? ' uploaded' : ''}${scanningRxId === selectedRx.id ? ' scanning' : ''}`} aria-label={selectedRx.copyFileName ? `Prescription ${selectedRxIndex + 1} copy uploaded: ${selectedRx.copyFileName}` : scanningRxId === selectedRx.id ? `Scanning prescription ${selectedRxIndex + 1}: ${scanProgress}%` : `Scan prescription ${selectedRxIndex + 1} copy`} disabled={Boolean(selectedRx.copyFileName) || scanningRxId !== null} onClick={() => startScan(selectedRx.id)}>
                        {selectedRx.copyFileName ? <CheckCircle size={18} /> : <Upload size={18} />}<span><strong>{scanningRxId === selectedRx.id ? `Reading document · ${scanProgress}%` : selectedRx.copyFileName ?? 'Attach prescription copy'}</strong><small>{selectedRx.copyFileName ? 'Document attached and ready for review' : 'PDF, JPG or PNG · maximum 10 MB'}</small></span>
                      </button>
                      {scanningRxId === selectedRx.id && <div className="rx-scan-track"><span style={{ transform: `scaleX(${scanProgress / 100})` }} /></div>}
                      <label className="rx-prescriber-field"><span>Prescribing clinician</span><input className="input" placeholder="e.g. Dr A. Lee" value={selectedRx.prescriber} onChange={event => dispatch({ type: 'SET_RX_PRESCRIBER', orderId: activeOrder.id, rxId: selectedRx.id, prescriber: event.target.value })} /></label>
                    </div>

                    <div className="rx-line-editor">
                      <div className="rx-line-editor__heading"><span><small>Contents</small><strong>{selectedRx.items.length} prescribed product{selectedRx.items.length === 1 ? '' : 's'}</strong></span><span>WX → PX pricing</span></div>
                      {selectedRx.items.length === 0 ? <div className="rx-inline-empty"><FileText size={20} /><span><strong>This prescription is empty</strong><small>Add a product from the formulary below.</small></span></div> : (
                        <div className="rx-item-stack">
                          {selectedRx.items.map((item, index) => {
                            const margin = lineMargin(item);
                            const contribution = lineRevenue(item) - lineCost(item);
                            return (
                              <article className="rx-prescribed-item" key={item.productId}>
                                <header className="rx-prescribed-item__header">
                                  <span className="rx-prescribed-item__index">Medicine {String(index + 1).padStart(2, '0')}</span>
                                  <span className="rx-prescribed-item__identity"><strong>{item.name}</strong><small>Curaleaf formulary product</small></span>
                                  <span className={`rx-prescribed-item__margin${margin >= 25 ? '' : ' low'}`}><strong>{margin}%</strong><small>margin</small></span>
                                  <button type="button" className="icon-button danger rx-line-delete" aria-label={`Delete ${item.name} from prescription`} title="Delete product" onClick={() => dispatch({ type: 'REMOVE_ITEM_FROM_RX', orderId: activeOrder.id, rxId: selectedRx.id, productId: item.productId })}><Trash2 size={15} /></button>
                                </header>
                                <div className="rx-prescribed-item__pricing">
                                  <div className="rx-prescribed-item__quantity"><small>Quantity</small><div className="rx-quantity-control" role="group" aria-label={`Quantity for ${item.name}`}><button type="button" disabled={item.qty <= 1} aria-label={`Reduce ${item.name} quantity`} onClick={() => dispatch({ type: 'UPDATE_ITEM_QTY', orderId: activeOrder.id, rxId: selectedRx.id, productId: item.productId, qty: item.qty - 1 })}><Minus size={14} /></button><span aria-live="polite"><strong>{item.qty}</strong><small>{item.qty === 1 ? 'unit' : 'units'}</small></span><button type="button" aria-label={`Increase ${item.name} quantity`} onClick={() => dispatch({ type: 'UPDATE_ITEM_QTY', orderId: activeOrder.id, rxId: selectedRx.id, productId: item.productId, qty: item.qty + 1 })}><Plus size={14} /></button></div></div>
                                  <div className="rx-price-flow" aria-label={`Pricing for ${item.name}`}>
                                    <span className="rx-price-node rx-price-node--wx"><small>WX unit</small><strong>{money(item.cost)}</strong><em>{money(lineCost(item))} line</em></span>
                                    <ArrowRight className="rx-price-flow__arrow" size={16} aria-hidden="true" />
                                    <span className="rx-price-node rx-price-node--px"><small>PX unit</small><strong>{money(item.retail)}</strong><em>{money(lineRevenue(item))} line</em></span>
                                  </div>
                                  <span className={`rx-prescribed-item__contribution${margin >= 25 ? '' : ' low'}`}><small>Gross margin</small><strong>{contribution >= 0 ? '+' : '−'}{money(Math.abs(contribution))}</strong><em>{item.retail - item.cost >= 0 ? '+' : '−'}{money(Math.abs(item.retail - item.cost))} per unit</em></span>
                                </div>
                              </article>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </section>

              <section className="rx-surface rx-formulary">
                <header className="rx-surface__header"><div><span className="rx-step-number">03</span><span><small>Curaleaf formulary</small><strong>Add products to Rx {selectedRxIndex + 1}</strong></span></div><span className="rx-formulary-result">{filteredProducts.length} products</span></header>
                <div className="rx-formulary-tools"><label className="rx-search"><Search size={15} /><input className="input" placeholder="Search product or strength" aria-label="Search Curaleaf formulary" value={catalogQuery} onChange={event => setCatalogQuery(event.target.value)} /></label><div className="rx-type-filter" role="group" aria-label="Filter formulary by type">{TYPE_FILTERS.map(type => <button type="button" key={type} aria-pressed={catalogTypeFilter === type} onClick={() => setCatalogTypeFilter(type)}>{type === 'All' ? 'All' : TYPE_LABELS[type] || type}</button>)}</div></div>
                <div className="rx-catalogue" role="list">
                  {filteredProducts.length === 0 ? <div className="rx-inline-empty"><Search size={20} /><span><strong>No matching products</strong><small>Change the search or category filter.</small></span></div> : filteredProducts.map((item, index) => {
                    const patientPrice = patientPriceFor(item);
                    const margin = marginPct(item.cost, patientPrice);
                    const outOfStock = item.stock === 'out';
                    const added = Boolean(selectedRx?.items.some(line => line.productId === item.id));
                    return <div role="listitem" className={`rx-catalogue-row${outOfStock ? ' unavailable' : ''}`} key={item.id} style={{ '--stagger-index': index } as CSSProperties}><div className="rx-catalogue-row__name"><strong>{item.name}</strong><span>{TYPE_LABELS[item.type] || item.type}</span></div><div className="stock-indicator"><span className={stockClass(item.stock)} /><span>{STOCK_LABELS[item.stock]}</span></div><div className="rx-catalogue-row__price"><span>{money(item.cost)} WX</span><strong>{money(patientPrice)} PX</strong></div><span className={margin >= 25 ? 'text-green' : 'text-amber'}>{margin}% margin</span><button type="button" className="btn btn-sm" disabled={outOfStock || added || !selectedRx} onClick={() => addToRx(item)}>{added ? <><CheckCircle size={13} /> Added</> : <><Plus size={13} /> Add</>}</button></div>;
                  })}
                </div>
              </section>
            </main>

            <aside className="rx-checkout-rail">
              <section className="rx-checkout-panel">
                <header><small>Order {activeOrder.id}</small><strong>Review and request payment</strong></header>
                <dl className="rx-order-totals"><div><dt>Prescription records</dt><dd>{activeOrder.prescriptions.length}</dd></div><div><dt>WX total</dt><dd>{money(orderCost(activeOrder))}</dd></div><div><dt>Product subtotal</dt><dd>{money(orderRevenue(activeOrder) - activeOrder.dispensingFee)}</dd></div><div><dt>Product margin</dt><dd className={marginPct(orderCost(activeOrder), orderRevenue(activeOrder) - activeOrder.dispensingFee) >= 25 ? 'text-green' : 'text-amber'}>{marginPct(orderCost(activeOrder), orderRevenue(activeOrder) - activeOrder.dispensingFee)}%</dd></div></dl>
                <div className="rx-dispensing-charge">
                  <span><strong>Dispensing charge</strong><small>Optional pharmacy charge · patient collection only</small></span>
                  <div className="rx-dispensing-presets" role="group" aria-label="Set dispensing charge">{[0, 5, 10, 15].map(amount => <button type="button" key={amount} aria-pressed={activeOrder.dispensingFee === amount} onClick={() => dispatch({ type: 'SET_ORDER_DISPENSING_FEE', orderId: activeOrder.id, amount })}>{money(amount)}</button>)}</div>
                  <label className="rx-dispensing-custom"><span>Custom</span><span className="money-input"><span>£</span><input type="number" min="0" step="0.01" value={activeOrder.dispensingFee} onFocus={event => event.currentTarget.select()} onChange={event => dispatch({ type: 'SET_ORDER_DISPENSING_FEE', orderId: activeOrder.id, amount: Math.max(0, Number(event.target.value)) })} aria-label="Custom dispensing charge" /></span></label>
                </div>
                <div className="rx-patient-total"><span><small>Patient total</small><em>{money(orderRevenue(activeOrder) - activeOrder.dispensingFee)} products + {money(activeOrder.dispensingFee)} dispensing</em></span><strong>{money(orderRevenue(activeOrder))}</strong></div>
                <div className="rx-checkout-readiness"><span className="section-label">Ready to continue</span>{readiness.map(item => <span key={item.label} className={item.complete ? 'complete' : ''}>{item.complete ? <CheckCircle size={13} /> : <span className="rx-readiness-dot" />}{item.label}</span>)}</div>
                <div className="rx-payment-actions">
                  <span className="section-label">Payment route</span>
                  <div className="rx-payment-route-toggle" role="radiogroup" aria-label="Choose payment route">
                    <button type="button" role="radio" aria-checked={selectedPaymentRoute === 'worldpay'} disabled={!canUseWorldpay} onClick={() => setSelectedPaymentRoute('worldpay')}><CreditCard size={17} /><span><strong>Worldpay</strong><small>{organisation.worldpay.enabled ? organisation.worldpay.status === 'connected' ? 'Online checkout' : 'Link account first' : 'Not enabled'}</small></span>{selectedPaymentRoute === 'worldpay' && canUseWorldpay ? <CheckCircle size={14} /> : null}</button>
                    <button type="button" role="radio" aria-checked={selectedPaymentRoute === 'pharmacy'} onClick={() => setSelectedPaymentRoute('pharmacy')}><Banknote size={17} /><span><strong>Pharmacy payment</strong><small>EPOS, cash or transfer</small></span>{selectedPaymentRoute === 'pharmacy' ? <CheckCircle size={14} /> : null}</button>
                  </div>
                  <p className="rx-payment-route-note">Choosing a route does not send anything. Review the total, then create the payment request below.</p>
                  <button type="button" className="btn btn-primary rx-create-payment" disabled={!readyForPayment || (selectedPaymentRoute === 'worldpay' && !canUseWorldpay)} onClick={createPaymentRequest}><Send size={15} />{selectedPaymentRoute === 'worldpay' ? 'Create Worldpay request' : 'Continue with pharmacy payment'}</button>
                </div>
                {!readyForPayment && <p className="rx-checkout-blocker"><AlertTriangle size={13} /> Complete the outstanding checks before requesting payment.</p>}
              </section>
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
