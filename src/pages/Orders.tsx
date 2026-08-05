import { useCallback, useEffect, useMemo, useState, type RefObject } from 'react';
import { AlertCircle, CheckCircle, Clock, Download, FileText, Package, Printer, RefreshCw, Search, Truck, X } from 'lucide-react';
import { PHARMACY, RX_STATUS_LABELS, lineRevenue, money, useApp, type Prescription, type RxStatus } from '../context/AppContext';
import { useModalFocus } from '../accessibility/useModalFocus';
import ProviderStatusNotice from '../components/ProviderStatusNotice';
import { useCuraleafActivity } from '../integrations/useCuraleafActivity';
import { approveCuraleafQuoteReview, createCuraleafSupportCase, getCuraleafSupportCases, updateCuraleafSupportCase } from '../shared/api';
import type { CuraleafActivity, CuraleafPurchaseOrder, CuraleafSupportCase } from '../shared/contracts';
import { compactPatientName } from '../utils/patientName';
import { formatPatientDob } from '../utils/patientDob';

const TRACK_STEPS = ['Submitted', 'Approved', 'Dispatched', 'Received', 'Ready', 'Collected'] as const;
const STATUS_TABS: Array<{ key: RxStatus | 'all'; label: string; shortLabel: string }> = [
  { key: 'all', label: 'All stages', shortLabel: 'All' },
  { key: 'awaiting-approval', label: 'Awaiting approval', shortLabel: 'Awaiting' },
  { key: 'approved', label: 'Approved', shortLabel: 'Approved' },
  { key: 'dispatched', label: 'Dispatched', shortLabel: 'Dispatched' },
  { key: 'partially-received', label: 'Partially received', shortLabel: 'Partial' },
  { key: 'received', label: 'Checks required', shortLabel: 'Received' },
  { key: 'ready', label: 'Ready for collection', shortLabel: 'Ready' },
  { key: 'collected', label: 'Collected', shortLabel: 'Collected' },
];

const STATUS_PILL: Record<RxStatus, string> = {
  draft: 'pill-neutral',
  'awaiting-approval': 'pill-info', approved: 'pill-info', dispatched: 'pill-amber',
  'partially-received': 'pill-amber', received: 'pill-info', ready: 'pill-green', collected: 'pill-neutral',
};

interface FlatSubOrder {
  key: string;
  orderId: number;
  patientName: string;
  patientDob: string;
  date: Date;
  rxIdx: number;
  rx: Prescription;
}

function completedStep(status: RxStatus) {
  return ({ draft: 0, 'awaiting-approval': 0, approved: 1, dispatched: 2, 'partially-received': 3, received: 3, ready: 4, collected: 5 } as Record<RxStatus, number>)[status];
}

export default function Orders() {
  const { state, dispatch } = useApp();
  const [statusFilter, setStatusFilter] = useState<RxStatus | 'all'>('all');
  const [query, setQuery] = useState('');
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [printingRx, setPrintingRx] = useState<{ rx: Prescription; patientName: string } | null>(null);
  const [receiptDrafts, setReceiptDrafts] = useState<Record<string, Record<string, number>>>({});
  const [supportCases, setSupportCases] = useState<CuraleafSupportCase[]>([]);
  const printDialogRef = useModalFocus<HTMLDivElement>(Boolean(printingRx), () => setPrintingRx(null));
  const {
    activity: curaleafActivity,
    enabled: showCuraleafAccount,
    error: curaleafError,
    loading: curaleafLoading,
    refresh: refreshCuraleafActivity,
  } = useCuraleafActivity(state.currentOrganisationId, state.workspaceMode);

  const refreshSupportCases = useCallback(async () => {
    if (state.workspaceMode !== 'live') return;
    try { setSupportCases(await getCuraleafSupportCases(state.currentOrganisationId)); } catch { /* Account feed notice covers supplier availability. */ }
  }, [state.currentOrganisationId, state.workspaceMode]);

  useEffect(() => { void refreshSupportCases(); }, [refreshSupportCases]);

  const allSubOrders = useMemo(() => {
    const list: FlatSubOrder[] = [];
    state.orders.filter(order => order.organisationId === state.currentOrganisationId && order.payment.status === 'paid').forEach(order => {
      const patient = order.patientId ? state.crm.find(candidate => candidate.organisationId === state.currentOrganisationId && candidate.id === order.patientId) : null;
      const patientName = patient?.name ?? (order.patientId ? 'Unknown patient' : 'Unassigned');
      const patientDob = patient?.dob ?? '';
      order.prescriptions.forEach((rx, index) => list.push({ key: `${order.id}-${rx.id}`, orderId: order.id, patientName, patientDob, date: order.date, rxIdx: index + 1, rx }));
    });
    return list.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [state.crm, state.currentOrganisationId, state.orders]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return allSubOrders
      .filter(item => statusFilter === 'all' || item.rx.status === statusFilter)
      .filter(item => !needle || `${item.patientName} ${item.patientDob} ${formatPatientDob(item.patientDob)} ${item.orderId} ${item.rx.poRef ?? ''} ${RX_STATUS_LABELS[item.rx.status]}`.toLowerCase().includes(needle))
      .sort((a, b) => (sortOrder === 'newest' ? 1 : -1) * (new Date(b.date).getTime() - new Date(a.date).getTime()));
  }, [allSubOrders, query, sortOrder, statusFilter]);

  useEffect(() => {
    if (!filtered.some(item => item.key === selectedKey)) setSelectedKey(filtered[0]?.key ?? null);
  }, [filtered, selectedKey]);

  const selected = filtered.find(item => item.key === selectedKey) ?? filtered[0] ?? null;
  const fmtDate = (date: Date) => new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const rxTotal = (rx: Prescription) => rx.items.reduce((total, item) => total + lineRevenue(item), 0);

  const receiptValuesFor = (item: FlatSubOrder) => receiptDrafts[item.key] ?? Object.fromEntries((item.rx.receivedItems ?? []).map(line => [line.productId, line.quantityReceived]));
  const recordReceipt = (item: FlatSubOrder, receiveAll: boolean) => {
    const values = receiptValuesFor(item);
    dispatch({ type: 'RECORD_GOODS_RECEIPT', orderId: item.orderId, rxId: item.rx.id, lines: item.rx.items.map(line => ({ productId: line.productId, quantityReceived: receiveAll ? line.qty : values[line.productId] ?? 0 })) });
  };

  const requestCancellation = async (purchaseOrder: CuraleafPurchaseOrder) => {
    const localOrder = state.orders.find(order => order.organisationId === state.currentOrganisationId && order.prescriptions.some(rx => rx.poRef === purchaseOrder.customerReference));
    if (!localOrder?.backendId) {
      dispatch({ type: 'ADD_TOAST', message: 'The matching HHH order could not be identified. Contact an HHH administrator with the Curaleaf reference.', toastType: 'error' });
      return;
    }
    try {
      await createCuraleafSupportCase({ organisationId: state.currentOrganisationId, orderId: localOrder.backendId, reason: 'purchase_order_cancellation', note: 'Cancellation requested from the supplier-orders workspace. Contact Curaleaf customer service using the established pharmacy account channel.', purchaseOrderId: purchaseOrder.id });
      await refreshSupportCases();
      dispatch({ type: 'ADD_TOAST', message: 'Cancellation request recorded. The order remains active until Curaleaf confirms cancellation.', toastType: 'warning' });
    } catch (error) { dispatch({ type: 'ADD_TOAST', message: error instanceof Error ? error.message : 'The cancellation request could not be recorded.', toastType: 'error' }); }
  };

  const changeSupportStatus = async (supportCase: CuraleafSupportCase, status: 'contacted' | 'resolved') => {
    try {
      const updated = await updateCuraleafSupportCase(supportCase.id, { organisationId: state.currentOrganisationId, status, note: supportCase.note });
      setSupportCases(current => current.map(item => item.id === updated.id ? updated : item));
    } catch (error) { dispatch({ type: 'ADD_TOAST', message: error instanceof Error ? error.message : 'The support case could not be updated.', toastType: 'error' }); }
  };

  return (
    <div className="page-body supplier-workbench">
      <section className="operations-brief supplier-brief">
        <div className="operations-brief__lead"><p className="section-label">Supplier fulfilment</p><h2>Track orders through receipt and collection</h2><p>{allSubOrders.length} prescription order{allSubOrders.length === 1 ? '' : 's'} currently in the patient-linked ledger. Curaleaf account records are shown separately and are never merged across pharmacies.</p></div>
      </section>

      {showCuraleafAccount ? (
        <CuraleafAccountRecords
          activity={curaleafActivity}
          error={curaleafError}
          loading={curaleafLoading}
          onRefresh={() => void refreshCuraleafActivity()}
          onRequestCancellation={purchaseOrder => void requestCancellation(purchaseOrder)}
        />
      ) : null}

      {showCuraleafAccount && supportCases.length > 0 ? <CuraleafSupportCases cases={supportCases} onStatus={changeSupportStatus} /> : null}

      <section className="supplier-filter-bar" aria-label="Filter supplier orders">
        <label className="supplier-search"><Search size={15} /><input className="input" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search patient, DOB, order or supplier reference" aria-label="Search supplier orders" /></label>
        <label className="workspace-filter-field"><span>Stage</span><select className="input select" value={statusFilter} onChange={event => setStatusFilter(event.target.value as RxStatus | 'all')}>{STATUS_TABS.map(option => <option value={option.key} key={option.key}>{option.label}</option>)}</select></label>
        <label className="workspace-filter-field"><span>Sort</span><select className="input select" value={sortOrder} onChange={event => setSortOrder(event.target.value as 'newest' | 'oldest')}><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select></label>
      </section>

      {filtered.length === 0 ? <div className="empty-state"><div className="empty-icon"><Package size={28} /></div><h3>No matching supplier orders</h3><p className="empty-desc">Clear the search or choose another stage.</p></div> : (
        <div className="supplier-workbench__layout">
          <section className="supplier-queue" aria-label="Supplier order queue">
            <header><span><small>All orders</small><strong>{filtered.length} matching</strong></span><span>{sortOrder === 'newest' ? 'Newest first' : 'Oldest first'}</span></header>
            <div className="supplier-queue__rows">
              {filtered.map(item => {
                const progress = item.rx.status === 'collected' ? 100 : Math.round((completedStep(item.rx.status) / (TRACK_STEPS.length - 1)) * 100);
                return <button type="button" key={item.key} className={`supplier-queue-row${selected?.key === item.key ? ' selected' : ''}`} aria-pressed={selected?.key === item.key} onClick={() => setSelectedKey(item.key)}>
                  <span className="supplier-queue-row__icon">{item.rx.status === 'dispatched' ? <Truck size={16} /> : item.rx.status === 'ready' || item.rx.status === 'collected' ? <CheckCircle size={16} /> : <Package size={16} />}</span>
                  <span className="supplier-queue-row__identity"><strong title={item.patientName} aria-label={item.patientName}>{compactPatientName(item.patientName)}</strong><small>DOB {formatPatientDob(item.patientDob)} · Order {item.orderId} · Rx {item.rxIdx}</small></span>
                  <span className="supplier-queue-row__meta"><strong>{money(rxTotal(item.rx))}</strong><small>{fmtDate(item.date)}</small></span>
                  <span className="supplier-queue-row__timeline" aria-label={`${RX_STATUS_LABELS[item.rx.status]}, ${progress}% complete`}><span><i style={{ width: `${progress}%` }} /></span><small>{RX_STATUS_LABELS[item.rx.status]}</small></span>
                </button>;
              })}
            </div>
          </section>

          {selected && <SupplierOrderDetail
            item={selected}
            values={receiptValuesFor(selected)}
            onQuantity={(productId, value) => setReceiptDrafts(current => ({ ...current, [selected.key]: { ...receiptValuesFor(selected), [productId]: value } }))}
            onRecordReceipt={receiveAll => recordReceipt(selected, receiveAll)}
            onPrint={() => setPrintingRx({ rx: selected.rx, patientName: selected.patientName })}
            onDispatch={action => dispatch({ type: action, orderId: selected.orderId, rxId: selected.rx.id })}
            onInvoice={() => dispatch({ type: 'ADD_TOAST', message: `Invoice ${selected.rx.invoiceRef ?? ''} is ready for the document service integration.`, toastType: 'info' })}
            onApproveQuote={async note => {
              const localOrder = state.orders.find(order => order.id === selected.orderId);
              if (!localOrder?.backendId) return;
              try {
                await approveCuraleafQuoteReview(localOrder.backendId, { organisationId: state.currentOrganisationId, note });
                dispatch({ type: 'ADD_TOAST', message: 'Latest Curaleaf supplier cost approved. Retry supplier placement from the payment workspace.', toastType: 'success' });
              } catch (error) { dispatch({ type: 'ADD_TOAST', message: error instanceof Error ? error.message : 'The latest quote could not be approved.', toastType: 'error' }); }
            }}
          />}
        </div>
      )}

      {printingRx && <PrintDialog dialogRef={printDialogRef} printingRx={printingRx} onClose={() => setPrintingRx(null)} onPrint={() => { dispatch({ type: 'ADD_TOAST', message: 'Dispensing label sent to the ZPL printer queue.', toastType: 'success' }); setPrintingRx(null); }} />}
    </div>
  );
}

function providerDate(value: string) {
  if (!value) return 'Not supplied';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function providerStateClass(state: string) {
  if (['ACTIVE', 'FULFILLED', 'FULLY_ALLOCATED', 'DISPATCHED'].includes(state)) return 'pill-green';
  if (['PENDING', 'CREATED', 'PROCESSING'].includes(state)) return 'pill-info';
  if (['EXPIRED', 'CANCELLED'].includes(state)) return 'pill-neutral';
  return 'pill-amber';
}

function CuraleafAccountRecords({
  activity,
  error,
  loading,
  onRefresh,
  onRequestCancellation,
}: {
  activity: CuraleafActivity | null;
  error: boolean;
  loading: boolean;
  onRefresh: () => void;
  onRequestCancellation: (purchaseOrder: CuraleafPurchaseOrder) => void;
}) {
  const purchaseOrders = activity?.purchaseOrders ?? [];
  const orderedPacks = purchaseOrders.flatMap(order => order.items).reduce((total, item) => total + item.packsOrderedCount, 0);
  const allocatedPacks = purchaseOrders.flatMap(order => order.items).reduce((total, item) => total + item.packsAllocatedCount, 0);
  const fetchedAt = activity?.fetchedAt
    ? new Date(activity.fetchedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
    : null;

  return <section className="curaleaf-account-records" aria-labelledby="curaleaf-account-title">
    <header className="curaleaf-account-records__header">
      <span>
        <small>Supplier account feed</small>
        <strong id="curaleaf-account-title">Curaleaf purchase orders for this pharmacy</strong>
        <em>Provider prescriptions now have their own dedicated pharmacy workspace.</em>
      </span>
      <button type="button" className="btn btn-sm" disabled={loading} onClick={onRefresh}>
        <RefreshCw className={loading ? 'spin' : undefined} size={13} />
        {loading ? 'Refreshing' : 'Refresh'}
      </button>
    </header>

    {error ? <ProviderStatusNotice
      title="Curaleaf records are temporarily unavailable"
      detail="Wait and try again. If this continues, contact your HHH administrator; pharmacy staff do not need to change the API connection."
      action={<button type="button" className="btn btn-sm" onClick={onRefresh}>Try again</button>}
    /> : null}

    {!error && loading && !activity ? <ProviderStatusNotice
      state="loading"
      title="Refreshing Curaleaf account records"
      detail="Retrieving this pharmacy’s prescribers, prescriptions, purchase orders and shipments."
    /> : null}

    {activity ? <>
      <dl className="curaleaf-account-summary" aria-label="Curaleaf account record counts">
        <div><dt>Purchase orders</dt><dd>{activity.purchaseOrderTotal}</dd></div>
        <div><dt>Shipments</dt><dd>{activity.shipmentTotal}</dd></div>
        <div><dt>Ordered packs</dt><dd>{orderedPacks}</dd></div>
        <div><dt>Allocated packs</dt><dd>{allocatedPacks}</dd></div>
      </dl>

      <div className="curaleaf-account-records__groups">
        <section className="curaleaf-record-group" aria-labelledby="curaleaf-purchase-orders-title">
          <header><span><small>Provider purchase orders</small><strong id="curaleaf-purchase-orders-title">{purchaseOrders.length} returned</strong></span></header>
          {purchaseOrders.length ? <div className="curaleaf-record-list">
            {purchaseOrders.map(order => {
              const ordered = order.items.reduce((total, item) => total + item.packsOrderedCount, 0);
              const allocated = order.items.reduce((total, item) => total + item.packsAllocatedCount, 0);
              return <article className="curaleaf-record-row curaleaf-record-row--purchase-order" key={order.id}>
                <span className="curaleaf-record-row__identity">
                  <small>Customer reference</small>
                  <strong>{order.customerReference || 'Not supplied'}</strong>
                  <em>{order.id}</em>
                </span>
                <span><small>Issued</small><strong>{providerDate(order.issuedDate || order.createdAt)}</strong></span>
                <span><small>Lines</small><strong>{order.items.length}</strong></span>
                <span><small>Allocation</small><strong>{allocated} / {ordered} packs</strong></span>
                <span><small>Courier</small><strong>{order.courier.replaceAll('_', ' ')}</strong></span>
                <span className={`pill ${providerStateClass(order.state)}`}>{order.state}</span>
                {order.state === 'CREATED' ? <button type="button" className="btn btn-sm" onClick={() => onRequestCancellation(order)}>Request cancellation</button> : null}
              </article>;
            })}
          </div> : <p className="curaleaf-record-empty">No purchase orders were returned for this pharmacy account.</p>}
        </section>
      </div>

      <footer>
        <span>Last refreshed {fetchedAt}. Curaleaf changes are polled server-side every ten seconds, with an hourly repair mirror.</span>
        <span>Only orders belonging to this pharmacy’s configured Curaleaf customer are accepted.</span>
      </footer>
    </> : null}
  </section>;
}

function CuraleafSupportCases({ cases, onStatus }: { cases: CuraleafSupportCase[]; onStatus: (supportCase: CuraleafSupportCase, status: 'contacted' | 'resolved') => void }) {
  return <section className="card" aria-labelledby="curaleaf-support-title">
    <header className="admin-directory-head"><div><p className="section-label">Customer-service workflow</p><h2 id="curaleaf-support-title">Curaleaf cases</h2><p>Use the pharmacy’s established Curaleaf support channel. A local request never cancels a supplier order by itself.</p></div><AlertCircle size={20} /></header>
    <div className="curaleaf-record-list">{cases.map(supportCase => <article className="curaleaf-record-row" key={supportCase.id}>
      <span className="curaleaf-record-row__identity"><small>{supportCase.reason.replaceAll('_', ' ')}</small><strong>Order {supportCase.orderId}</strong><em>{supportCase.note}</em></span>
      <span className={`pill ${supportCase.status === 'resolved' ? 'pill-green' : supportCase.status === 'contacted' ? 'pill-info' : 'pill-amber'}`}>{supportCase.status}</span>
      {supportCase.status === 'open' ? <button type="button" className="btn btn-sm" onClick={() => onStatus(supportCase, 'contacted')}>Mark contacted</button> : null}
      {supportCase.status !== 'resolved' ? <button type="button" className="btn btn-sm" onClick={() => onStatus(supportCase, 'resolved')}>Mark resolved</button> : null}
    </article>)}</div>
  </section>;
}

function SupplierOrderDetail({ item, values, onQuantity, onRecordReceipt, onPrint, onDispatch, onInvoice, onApproveQuote }: {
  item: FlatSubOrder;
  values: Record<string, number>;
  onQuantity: (productId: string, value: number) => void;
  onRecordReceipt: (receiveAll: boolean) => void;
  onPrint: () => void;
  onDispatch: (action: 'MARK_READY_FOR_COLLECTION' | 'HANDOVER_TO_PATIENT') => void;
  onInvoice: () => void;
  onApproveQuote: (note: string) => Promise<void>;
}) {
  const { rx } = item;
  const { state } = useApp();
  const order = state.orders.find(candidate => candidate.id === item.orderId);
  const [quoteApprovalNote, setQuoteApprovalNote] = useState('Reviewed the latest Curaleaf supplier cost and approved placement.');
  const readyDays = rx.status === 'ready' && rx.readyAt ? Math.floor((Date.now() - new Date(rx.readyAt).getTime()) / 86400000) : 0;
  const done = completedStep(rx.status);
  const canReceive = rx.status === 'dispatched' || rx.status === 'partially-received';

  return <article className="supplier-detail" aria-label={`Supplier order for ${item.patientName}`}>
    <header className="supplier-detail__header">
      <span><small>Order {item.orderId} · Rx {item.rxIdx}</small><strong>{item.patientName}</strong><em>DOB {formatPatientDob(item.patientDob)} · Prescriber: {rx.prescriber || 'Pending'}</em></span>
      <span><strong>{money(rx.items.reduce((total, line) => total + lineRevenue(line), 0))}</strong><span className={`pill ${STATUS_PILL[rx.status]}`}>{RX_STATUS_LABELS[rx.status]}</span></span>
    </header>

    {readyDays >= 10 && <div className="supplier-alert"><Clock size={16} /><span><strong>Collection follow-up required</strong><small>Ready for {readyDays} days.</small></span></div>}

    {order?.quoteReview?.status !== 'approved' ? order?.quoteReview?.type === 'supplier_cost_changed' ? <div className="supplier-alert"><AlertCircle size={16} /><span><strong>Supplier cost changed after payment</strong><small>Review the latest wholesale, shipping or tax difference before placement.</small><input className="input" value={quoteApprovalNote} onChange={event => setQuoteApprovalNote(event.target.value)} /><button type="button" className="btn btn-sm" disabled={!quoteApprovalNote.trim()} onClick={() => void onApproveQuote(quoteApprovalNote.trim())}>Approve latest supplier cost</button></span></div> : order?.quoteReview ? <div className="supplier-alert"><AlertCircle size={16} /><span><strong>{order.quoteReview.type === 'out_of_stock' ? 'Curaleaf pack out of stock' : 'Patient price changed after payment'}</strong><small>{order.quoteReview.type === 'out_of_stock' ? 'Wait for a fresh in-stock quote or cancel the order.' : 'Cancel/refund and recreate this order at the new patient price.'}</small></span></div> : null : null}

    <section className="supplier-progress" aria-label="Fulfilment progress">
      {TRACK_STEPS.map((step, index) => <div key={step} className={index < done || rx.status === 'collected' ? 'complete' : index === done ? 'current' : ''}><span>{index < done || rx.status === 'collected' ? <CheckCircle size={13} /> : index + 1}</span><small>{step}</small></div>)}
    </section>

    <dl className="supplier-facts">
      <div><dt>{rx.status === 'awaiting-approval' ? 'Submission reference' : 'Supplier reference'}</dt><dd>{rx.poRef || 'Pending Curaleaf approval'}</dd></div>
      <div><dt>Ordered</dt><dd>{new Date(item.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</dd></div>
      <div><dt>Courier visibility</dt><dd>{rx.status === 'awaiting-approval' || rx.status === 'approved' ? 'Not dispatched' : 'Dispatch confirmed; Curaleaf does not provide courier tracking.'}</dd></div>
      <div><dt>Invoice</dt><dd>{rx.invoiceRef ? <button type="button" className="table-link" onClick={onInvoice}><Download size={12} /> {rx.invoiceRef}</button> : 'Not issued'}</dd></div>
    </dl>

    <section className="supplier-products">
      <header><span><small>{rx.placed ? 'Curaleaf order lines' : 'Prescribed products'}</small><strong>{rx.items.length} line{rx.items.length === 1 ? '' : 's'}</strong></span><span>Ordered / received</span></header>
      {rx.items.map(line => <div className="supplier-product-row" key={line.productId}>
        <span><strong>{line.name}</strong><small>{money(line.retail)} patient price · {line.cost === null ? 'wholesale pending quote' : `${money(line.cost)} wholesale`}</small></span>
        {canReceive ? <label><span className="sr-only">Quantity received for {line.name}</span><input className="input" type="number" min={0} max={line.qty} value={values[line.productId] ?? 0} onChange={event => onQuantity(line.productId, Math.max(0, Math.min(line.qty, Number(event.target.value))))} /><small>of {line.qty}</small></label> : <strong>{values[line.productId] ?? (['received', 'ready', 'collected'].includes(rx.status) ? line.qty : 0)} / {line.qty}</strong>}
      </div>)}
    </section>

    <footer className="supplier-detail__actions">
      {canReceive && <><button type="button" className="btn" onClick={() => onRecordReceipt(false)}>Save partial receipt</button><button type="button" className="btn btn-primary" onClick={() => onRecordReceipt(true)}>Receive all items</button></>}
      {rx.status === 'received' && <button type="button" className="btn btn-primary" onClick={() => onDispatch('MARK_READY_FOR_COLLECTION')}><CheckCircle size={14} /> Checks complete — mark ready</button>}
      {rx.status === 'ready' && <><button type="button" className="btn" onClick={onPrint}><Printer size={14} /> Print dispensing label</button><button type="button" className="btn btn-primary" onClick={() => onDispatch('HANDOVER_TO_PATIENT')}><CheckCircle size={14} /> Handover to patient</button></>}
      {!canReceive && !['received', 'ready'].includes(rx.status) && <span className="supplier-detail__waiting"><FileText size={14} /> No pharmacy action is required at this stage.</span>}
    </footer>
  </article>;
}

function PrintDialog({ dialogRef, printingRx, onClose, onPrint }: { dialogRef: RefObject<HTMLDivElement | null>; printingRx: { rx: Prescription; patientName: string }; onClose: () => void; onPrint: () => void }) {
  return <><div className="drawer-backdrop" aria-hidden="true" onClick={onClose} /><div ref={dialogRef} className="print-label-dialog" role="dialog" aria-modal="true" aria-labelledby="print-dialog-title" tabIndex={-1}>
    <header><span><small>Printer queue</small><strong id="print-dialog-title">Dispensing label preview</strong></span><button type="button" className="icon-button" aria-label="Close print preview" onClick={onClose}><X size={16} /></button></header>
    <div className="dispensing-label"><strong>{PHARMACY.name.toUpperCase()}</strong><span>Patient: {printingRx.patientName}</span><span>Date: {new Date().toLocaleDateString('en-GB')}</span>{printingRx.rx.items.map(line => <div key={line.productId}><b>{line.name} × {line.qty}</b><small>Patient price: {money(line.retail * line.qty)}</small></div>)}<em>Use as directed by the clinician. Keep out of reach and sight of children. Controlled Drug.</em><code>|||||| | |||| ||| ||</code><small>{printingRx.rx.poRef || 'PO-BATCH-REF'}</small></div>
    <footer><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="button" className="btn btn-primary" onClick={onPrint}><Printer size={14} /> Send to printer</button></footer>
  </div></>;
}
