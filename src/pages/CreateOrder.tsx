import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { AlertTriangle, ArrowRight, Banknote, CheckCircle, CreditCard, FileText, Minus, Pencil, Plus, RefreshCw, Search, Send, Trash2, Upload } from 'lucide-react';
import ProviderStatusNotice from '../components/ProviderStatusNotice';
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
  type LineItem,
  type CatalogueItem,
  type PaymentRoute,
} from '../context/AppContext';
import { isLocalPortalPreview } from '../dev/localPortalPreview';
import { createPortalOrder, getCuraleafQuote, getCuraleafTrainingQuote, getDevCuraleafQuote, isApiConfigured, uploadPrescriptionFile } from '../shared/api';
import { formatPatientDob } from '../utils/patientDob';

const TYPE_FILTERS = ['All', 'oil', 'flos', 'capsule', 'lozenge', 'vape', 'other'] as const;

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
  const [changingPatient, setChangingPatient] = useState(false);
  const [patientQuery, setPatientQuery] = useState('');
  const [patientSearchOpen, setPatientSearchOpen] = useState(false);
  const [patientActiveIndex, setPatientActiveIndex] = useState(0);
  const [confirmingDraftDelete, setConfirmingDraftDelete] = useState(false);
  const [quoteBusy, setQuoteBusy] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [quotedSignature, setQuotedSignature] = useState<string | null>(null);
  const [quoteSummary, setQuoteSummary] = useState<{ shippingPrice: number; taxRate: number } | null>(null);
  const [uploadingRxId, setUploadingRxId] = useState<number | null>(null);
  const [checkoutBusy, setCheckoutBusy] = useState(false);

  useEffect(() => {
    if (!activeOrder?.prescriptions.length) return setSelectedRxId(null);
    if (!activeOrder.prescriptions.some(rx => rx.id === selectedRxId)) setSelectedRxId(activeOrder.prescriptions[0].id);
  }, [activeOrder, selectedRxId]);

  useEffect(() => {
    setSelectedPaymentRoute(canUseWorldpay ? 'worldpay' : 'pharmacy');
    setChangingPatient(false);
    setPatientQuery('');
    setPatientSearchOpen(false);
    setPatientActiveIndex(0);
    setConfirmingDraftDelete(false);
    setQuoteError(null);
    setQuotedSignature(null);
    setQuoteSummary(null);
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

  const matchingPatients = useMemo(() => {
    const query = patientQuery.trim().toLowerCase();
    return tenantPatients.filter(candidate => !query || [candidate.name, candidate.email, candidate.mobile, candidate.dob ?? '', formatPatientDob(candidate.dob)].some(value => value.toLowerCase().includes(query))).slice(0, 7);
  }, [patientQuery, tenantPatients]);

  const selectedRx = activeOrder?.prescriptions.find(rx => rx.id === selectedRxId) ?? null;
  const selectedRxIndex = activeOrder && selectedRx ? activeOrder.prescriptions.findIndex(rx => rx.id === selectedRx.id) : -1;
  const requiresLiveCuraleafEvidence = state.workspaceMode === 'live' && !isLocalPortalPreview;
  const readiness = activeOrder ? [
    { label: 'Approved patient linked', complete: Boolean(activeOrder.patientId) },
    { label: 'Prescription copies attached', complete: activeOrder.prescriptions.every(rx => Boolean(rx.copyFileName) && (!requiresLiveCuraleafEvidence || Boolean(rx.fileId))) },
    { label: 'Prescriber recorded', complete: activeOrder.prescriptions.every(rx => Boolean(rx.prescriber.trim())) },
    ...(requiresLiveCuraleafEvidence ? [{ label: 'Curaleaf prescription details', complete: activeOrder.prescriptions.every(rx => Boolean(rx.serialNumber?.trim() && rx.issueDate && rx.prescriberPin?.trim())) }] : []),
    { label: 'Products assigned', complete: activeOrder.prescriptions.every(rx => rx.items.length > 0 && (!requiresLiveCuraleafEvidence || rx.items.every(item => item.formulaId && item.unitsNeededCount))) },
  ] : [];
  const readyForPayment = readiness.every(item => item.complete);
  const wholesaleKnown = Boolean(activeOrder?.prescriptions.every(rx => rx.items.every(item => item.cost !== null)));
  const orderMargin = activeOrder && wholesaleKnown
    ? marginPct(orderCost(activeOrder), orderRevenue(activeOrder) - activeOrder.dispensingFee)
    : null;
  const currentQuoteItems = activeOrder?.prescriptions.flatMap(rx => rx.items.map(item => ({ packId: item.productId, quantity: item.qty }))) ?? [];
  const currentQuoteSignature = JSON.stringify(currentQuoteItems.slice().sort((a, b) => a.packId.localeCompare(b.packId)));
  const quoteCurrent = wholesaleKnown && quotedSignature === currentQuoteSignature;

  const initials = (name: string) => name.split(' ').map(word => word[0]).join('').toUpperCase().slice(0, 2);
  const availabilityLabel = (item: CatalogueItem) => item.availability === 'in'
    ? 'In stock at last quote'
    : item.availability === 'out'
      ? 'Out of stock at last quote'
      : 'Availability checked at quote';

  const startScan = (rxId: number) => {
    setScanningRxId(rxId);
    setScanProgress(0);
    dispatch({ type: 'ADD_TOAST', message: 'Reading prescription document…', toastType: 'info' });
  };

  const addToRx = (item: CatalogueItem) => {
    if (!activeOrder || !selectedRx) return;
    if (selectedRx.items.some(line => line.productId === item.id)) return;
    const lineItem: LineItem = { productId: item.id, formulaId: item.formulaId, name: item.name, qty: 1, unitsNeededCount: 1, cost: item.cost, retail: item.retail };
    dispatch({ type: 'ADD_ITEM_TO_RX', orderId: activeOrder.id, rxId: selectedRx.id, item: lineItem });
    dispatch({ type: 'ADD_TOAST', message: `Added “${item.name}” to Rx ${selectedRxIndex + 1}.`, toastType: 'success' });
  };

  const createPaymentRequest = async () => {
    if (!activeOrder || !readyForPayment) return;
    setCheckoutBusy(true);
    try {
      if (!isLocalPortalPreview && state.workspaceMode === 'live') {
        if (!quoteCurrent) throw new Error('Refresh the Curaleaf quote before creating the live order.');
        if (selectedPaymentRoute === 'worldpay') throw new Error('Worldpay checkout is not connected to this screen yet. Choose pharmacy payment for the live Curaleaf workflow.');
        const lineItems = activeOrder.prescriptions.flatMap(rx => rx.items.map(item => ({
          packId: item.productId,
          quantity: item.qty,
        })));
        const persisted = activeOrder.backendId ? { id: activeOrder.backendId } : await createPortalOrder({
          organisationId: state.currentOrganisationId,
          patientId: activeOrder.patientId!,
          lineItems,
          dispensingFeePence: Math.round(activeOrder.dispensingFee * 100),
          currency: 'GBP',
          paymentRoute: 'manual',
        });
        if (!activeOrder.backendId) {
          dispatch({ type: 'SET_ORDER_BACKEND_ID', orderId: activeOrder.id, backendId: persisted.id });
          if ('lineItems' in persisted) dispatch({
            type: 'SYNC_ORDER_PATIENT_PRICES',
            orderId: activeOrder.id,
            items: persisted.lineItems.map(item => ({ productId: item.productId, patientPrice: item.unitPricePence / 100 })),
          });
        }
        dispatch({ type: 'START_MANUAL_PAYMENT', orderId: activeOrder.id });
        dispatch({ type: 'ADD_TOAST', message: 'Order saved. Confirm the pharmacy payment before sending its prescriptions to Curaleaf.', toastType: 'success' });
      } else if (selectedPaymentRoute === 'worldpay') {
        if (!canUseWorldpay) return;
        dispatch({ type: 'SEND_PAYMENT_LINK', orderId: activeOrder.id });
        dispatch({ type: 'ADD_TOAST', message: 'Training Worldpay request created. No external payment was sent.', toastType: 'success' });
      } else {
        dispatch({ type: 'START_MANUAL_PAYMENT', orderId: activeOrder.id });
        dispatch({ type: 'ADD_TOAST', message: 'Training pharmacy payment selected. No external record was created.', toastType: 'success' });
      }
      dispatch({ type: 'SET_SCREEN', screen: 'review' });
    } catch (error) {
      dispatch({ type: 'ADD_TOAST', message: error instanceof Error ? error.message : 'The order could not be created.', toastType: 'error' });
    } finally {
      setCheckoutBusy(false);
    }
  };

  const attachPrescriptionFile = async (rxId: number, file: File) => {
    if (!activeOrder) return;
    if (isLocalPortalPreview || state.workspaceMode !== 'live') {
      dispatch({ type: 'SET_RX_FILE', orderId: activeOrder.id, rxId, fileName: file.name, fileId: null });
      dispatch({ type: 'ADD_TOAST', message: `${file.name} attached to the training record only.`, toastType: 'info' });
      return;
    }
    setUploadingRxId(rxId);
    try {
      const contentType = file.type as 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp';
      if (!['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(contentType)) throw new Error('Use a PDF, JPG, PNG or WebP prescription file.');
      const uploaded = await uploadPrescriptionFile({ organisationId: state.currentOrganisationId, filename: file.name, contentType }, file);
      dispatch({ type: 'SET_RX_FILE', orderId: activeOrder.id, rxId, fileName: file.name, fileId: uploaded.id });
      dispatch({ type: 'ADD_TOAST', message: 'Prescription copy uploaded securely and linked to this order.', toastType: 'success' });
    } catch (error) {
      dispatch({ type: 'ADD_TOAST', message: error instanceof Error ? error.message : 'Prescription upload failed.', toastType: 'error' });
    } finally {
      setUploadingRxId(null);
    }
  };

  const refreshQuote = async () => {
    if (!activeOrder || !currentQuoteItems.length || !isApiConfigured) return;
    setQuoteBusy(true);
    setQuoteError(null);
    try {
      const quote = isLocalPortalPreview
        ? await getDevCuraleafQuote(currentQuoteItems)
        : state.workspaceMode === 'live'
          ? await getCuraleafQuote(state.currentOrganisationId, currentQuoteItems)
          : await getCuraleafTrainingQuote(state.currentOrganisationId, currentQuoteItems);
      if (!quote.items.length) {
        throw new Error(state.workspaceMode === 'training'
          ? 'The Curaleaf test environment did not return quote lines for these packs. You can continue the training workflow; no supplier order will be sent.'
          : 'Curaleaf has not returned quote prices yet. Your draft is unchanged; wait and try again, or contact your HHH administrator if this continues.');
      }
      dispatch({
        type: 'APPLY_CURALEAF_QUOTE',
        items: quote.items.map(item => ({
          productId: item.packId,
          wholesalePrice: Number(item.wholesalePackPrice),
          patientPrice: Number(item.patientPackPrice),
          inStock: item.inStock,
        })),
      });
      setQuotedSignature(currentQuoteSignature);
      setQuoteSummary({ shippingPrice: Number(quote.shippingPrice) || 0, taxRate: Number(quote.taxRate) || 0 });
      dispatch({ type: 'ADD_TOAST', message: `Curaleaf quote refreshed for ${quote.items.length} product line${quote.items.length === 1 ? '' : 's'}.`, toastType: 'success' });
    } catch (error) {
      setQuoteSummary(null);
      setQuoteError(error instanceof Error ? error.message : 'The Curaleaf quote could not be loaded. Wait and retry, or contact your HHH administrator if this continues.');
    } finally {
      setQuoteBusy(false);
    }
  };

  const selectPatient = (patientId: string) => {
    if (!activeOrder || !patientId) return;
    if (patientId === activeOrder.patientId) {
      setChangingPatient(false);
      setPatientQuery('');
      setPatientSearchOpen(false);
      return;
    }
    const linkedPatient = tenantPatients.find(candidate => candidate.id === patientId);
    if (!linkedPatient) return;
    const replacingPatient = Boolean(activeOrder.patientId);
    dispatch({ type: 'SET_ORDER_PATIENT', orderId: activeOrder.id, patientId });
    dispatch({ type: 'ADD_TOAST', message: replacingPatient ? `Draft reassigned to ${linkedPatient.name}.` : `Linked patient “${linkedPatient.name}”.`, toastType: 'success' });
    setChangingPatient(false);
    setPatientQuery('');
    setPatientSearchOpen(false);
  };

  const beginPatientChange = () => {
    setPatientQuery('');
    setPatientActiveIndex(0);
    setPatientSearchOpen(true);
    setChangingPatient(true);
  };

  const cancelPatientChange = () => {
    setChangingPatient(false);
    setPatientQuery('');
    setPatientSearchOpen(false);
    setPatientActiveIndex(0);
  };

  const renderPatientSearch = (mode: 'link' | 'change') => {
    if (!activeOrder) return null;
    return (
      <div className={`rx-patient-change${mode === 'link' ? ' is-linking' : ''}`}>
        <label className="rx-patient-change__heading" htmlFor={`rx-patient-${activeOrder.id}`}>
          <small>{mode === 'change' ? 'Change linked patient' : 'Link patient'}</small>
          <strong>{mode === 'change' ? 'Search approved patients' : 'Find an approved patient'}</strong>
          <span>Type a name, email address or mobile number.</span>
        </label>
        <div className="rx-patient-combobox" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPatientSearchOpen(false); }}>
          <div className="rx-patient-combobox__field">
            <Search size={15} aria-hidden="true" />
            <input
              id={`rx-patient-${activeOrder.id}`}
              className="input"
              value={patientQuery}
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={patientSearchOpen}
              aria-controls={`rx-patient-results-${activeOrder.id}`}
              aria-activedescendant={patientSearchOpen && matchingPatients[patientActiveIndex] ? `rx-patient-option-${matchingPatients[patientActiveIndex].id}` : undefined}
              placeholder="Search approved patients…"
              autoComplete="off"
              onFocus={() => setPatientSearchOpen(true)}
              onChange={event => { setPatientQuery(event.target.value); setPatientActiveIndex(0); setPatientSearchOpen(true); }}
              onKeyDown={event => {
                if (event.key === 'ArrowDown' && matchingPatients.length) { event.preventDefault(); setPatientSearchOpen(true); setPatientActiveIndex(index => Math.min(index + 1, matchingPatients.length - 1)); }
                if (event.key === 'ArrowUp' && matchingPatients.length) { event.preventDefault(); setPatientActiveIndex(index => Math.max(index - 1, 0)); }
                if (event.key === 'Enter' && patientSearchOpen && matchingPatients[patientActiveIndex]) { event.preventDefault(); selectPatient(matchingPatients[patientActiveIndex].id); }
                if (event.key === 'Escape') { event.preventDefault(); setPatientSearchOpen(false); }
              }}
            />
          </div>
          {patientSearchOpen && (
            <div id={`rx-patient-results-${activeOrder.id}`} className="rx-patient-results" role="listbox" aria-label="Matching approved patients">
              {matchingPatients.length ? matchingPatients.map((candidate, index) => (
                <button
                  id={`rx-patient-option-${candidate.id}`}
                  type="button"
                  role="option"
                  aria-selected={index === patientActiveIndex}
                  className={index === patientActiveIndex ? 'active' : ''}
                  key={candidate.id}
                  onMouseEnter={() => setPatientActiveIndex(index)}
                  onClick={() => selectPatient(candidate.id)}
                >
                  <span className="rx-patient-result__avatar" aria-hidden="true">{initials(candidate.name)}</span>
                  <span><strong>{candidate.name}</strong><small className="rx-patient-result__dob">DOB {formatPatientDob(candidate.dob)}</small><small>{candidate.email} · {candidate.mobile}</small></span>
                  {candidate.id === patient?.id ? <em>Current</em> : null}
                </button>
              )) : <span className="rx-patient-results__empty">No approved patients match “{patientQuery.trim()}”.</span>}
            </div>
          )}
        </div>
        {mode === 'change' ? <button type="button" className="btn btn-sm rx-patient-change__cancel" onClick={cancelPatientChange}>Cancel</button> : null}
      </div>
    );
  };

  const deleteDraft = () => {
    if (!activeOrder) return;
    const deletedOrderId = activeOrder.id;
    dispatch({ type: 'CLEAR_ORDER', orderId: deletedOrderId });
    dispatch({ type: 'ADD_TOAST', message: `Draft order ${deletedOrderId} deleted.`, toastType: 'info' });
    setConfirmingDraftDelete(false);
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
          <section className={`rx-patient-band${changingPatient || !patient ? ' is-changing-patient' : ''}`}>
            <div className="rx-patient-band__identity">
              <span className="rx-step-number">01</span>
              {patient ? (
                changingPatient ? (
                  renderPatientSearch('change')
                ) : (
                  <><span className="avatar">{initials(patient.name)}</span><span className="rx-patient-identity-copy"><small>Approved patient</small><strong>{patient.name}</strong><em>DOB {formatPatientDob(patient.dob)} · {patient.email} · {patient.mobile}</em></span><span className="pill pill-green"><CheckCircle size={11} /> Linked</span><div className="rx-patient-actions"><button type="button" className="btn btn-sm" onClick={beginPatientChange}><Pencil size={12} /> Change patient</button><button type="button" className="icon-button danger" aria-label="Delete this prescription draft" title="Delete draft" onClick={() => setConfirmingDraftDelete(true)}><Trash2 size={14} /></button></div></>
                )
              ) : (
                renderPatientSearch('link')
              )}
            </div>
            <div className="rx-readiness-summary" aria-label="Prescription readiness">
              {readiness.map(item => <span key={item.label} className={item.complete ? 'complete' : ''}>{item.complete ? <CheckCircle size={13} /> : <span className="rx-readiness-dot" />}{item.label}</span>)}
            </div>
            {confirmingDraftDelete && (
              <div className="rx-draft-delete-confirm" role="alert">
                <span><Trash2 size={16} /><span><strong>Delete this draft?</strong><small>The linked patient and every unfinished prescription record in this draft will be removed.</small></span></span>
                <div><button type="button" className="btn btn-sm" onClick={() => setConfirmingDraftDelete(false)}>Keep draft</button><button type="button" className="btn btn-sm btn-danger" onClick={deleteDraft}>Delete draft</button></div>
              </div>
            )}
          </section>

          <button type="button" className="rx-mobile-review-bar" onClick={() => document.getElementById('rx-order-review')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
            <span><small>Patient total</small><strong>{money(orderRevenue(activeOrder))}</strong></span>
            <span>Review order <ArrowRight size={15} /></span>
          </button>

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
                      {isLocalPortalPreview ? <button type="button" className={`rx-document-control${selectedRx.copyFileName ? ' uploaded' : ''}${scanningRxId === selectedRx.id ? ' scanning' : ''}`} aria-label={selectedRx.copyFileName ? `Prescription ${selectedRxIndex + 1} copy uploaded: ${selectedRx.copyFileName}` : scanningRxId === selectedRx.id ? `Scanning prescription ${selectedRxIndex + 1}: ${scanProgress}%` : `Scan prescription ${selectedRxIndex + 1} copy`} disabled={Boolean(selectedRx.copyFileName) || scanningRxId !== null} onClick={() => startScan(selectedRx.id)}>
                        {selectedRx.copyFileName ? <CheckCircle size={18} /> : <Upload size={18} />}<span><strong>{scanningRxId === selectedRx.id ? `Reading document · ${scanProgress}%` : selectedRx.copyFileName ?? 'Attach training prescription'}</strong><small>{selectedRx.copyFileName ? 'Training document attached' : 'Simulated locally; nothing is uploaded'}</small></span>
                      </button> : <label className={`rx-document-control${selectedRx.copyFileName ? ' uploaded' : ''}`}>
                        <input className="sr-only" type="file" accept=".pdf,image/jpeg,image/png,image/webp" disabled={uploadingRxId !== null} onChange={event => { const file = event.target.files?.[0]; if (file) void attachPrescriptionFile(selectedRx.id, file); }} />
                        {selectedRx.copyFileName ? <CheckCircle size={18} /> : <Upload size={18} />}<span><strong>{uploadingRxId === selectedRx.id ? 'Uploading securely…' : selectedRx.copyFileName ?? 'Attach prescription copy'}</strong><small>{selectedRx.fileId ? 'Uploaded and linked to the live order' : 'PDF, JPG, PNG or WebP · maximum 10 MB'}</small></span>
                      </label>}
                      {scanningRxId === selectedRx.id && <div className="rx-scan-track"><span style={{ transform: `scaleX(${scanProgress / 100})` }} /></div>}
                      <label className="rx-prescriber-field"><span>Prescribing clinician</span><input className="input" placeholder="e.g. Dr A. Lee" value={selectedRx.prescriber} onChange={event => dispatch({ type: 'SET_RX_PRESCRIBER', orderId: activeOrder.id, rxId: selectedRx.id, prescriber: event.target.value })} /></label>
                      <label className="rx-prescriber-field"><span>Prescription serial number</span><input className="input" value={selectedRx.serialNumber ?? ''} onChange={event => dispatch({ type: 'SET_RX_METADATA', orderId: activeOrder.id, rxId: selectedRx.id, updates: { serialNumber: event.target.value } })} /></label>
                      <label className="rx-prescriber-field"><span>Issue date</span><input className="input" type="date" value={selectedRx.issueDate ?? ''} onChange={event => dispatch({ type: 'SET_RX_METADATA', orderId: activeOrder.id, rxId: selectedRx.id, updates: { issueDate: event.target.value } })} /></label>
                      <label className="rx-prescriber-field"><span>Prescriber PIN</span><input className="input" value={selectedRx.prescriberPin ?? ''} onChange={event => dispatch({ type: 'SET_RX_METADATA', orderId: activeOrder.id, rxId: selectedRx.id, updates: { prescriberPin: event.target.value } })} /></label>
                      <label className="rx-prescriber-field"><span>GMC number <small>(if applicable)</small></span><input className="input" inputMode="numeric" value={selectedRx.prescriberGmcNumber ?? ''} onChange={event => dispatch({ type: 'SET_RX_METADATA', orderId: activeOrder.id, rxId: selectedRx.id, updates: { prescriberGmcNumber: event.target.value } })} /></label>
                      <label className="rx-prescriber-field"><span>GPhC number <small>(if applicable)</small></span><input className="input" value={selectedRx.prescriberGphcNumber ?? ''} onChange={event => dispatch({ type: 'SET_RX_METADATA', orderId: activeOrder.id, rxId: selectedRx.id, updates: { prescriberGphcNumber: event.target.value } })} /></label>
                    </div>

                    <div className="rx-line-editor">
                      <div className="rx-line-editor__heading"><span><small>Contents</small><strong>{selectedRx.items.length} prescribed product{selectedRx.items.length === 1 ? '' : 's'}</strong></span><span>Curaleaf price · quoted cost</span></div>
                      {selectedRx.items.length === 0 ? <div className="rx-inline-empty"><FileText size={20} /><span><strong>This prescription is empty</strong><small>Add a product from the formulary below.</small></span></div> : (
                        <div className="rx-item-stack">
                          {selectedRx.items.map((item, index) => {
                            const margin = lineMargin(item);
                            const contribution = item.cost === null ? null : lineRevenue(item) - lineCost(item);
                            return (
                              <article className="rx-prescribed-item" key={item.productId}>
                                <header className="rx-prescribed-item__header">
                                  <span className="rx-prescribed-item__index">Medicine {String(index + 1).padStart(2, '0')}</span>
                                  <span className="rx-prescribed-item__identity"><strong>{item.name}</strong><small>Curaleaf formulary product</small></span>
                                  <span className={`rx-prescribed-item__margin${margin !== null && margin < 25 ? ' low' : ''}`}><strong>{margin === null ? '—' : `${margin}%`}</strong><small>{margin === null ? 'quote pending' : 'margin'}</small></span>
                                  <button type="button" className="icon-button danger rx-line-delete" aria-label={`Delete ${item.name} from prescription`} title="Delete product" onClick={() => dispatch({ type: 'REMOVE_ITEM_FROM_RX', orderId: activeOrder.id, rxId: selectedRx.id, productId: item.productId })}><Trash2 size={15} /></button>
                                </header>
                                <div className="rx-prescribed-item__pricing">
                                  <div className="rx-prescribed-item__quantity"><small>Packs to order</small><div className="rx-quantity-control" role="group" aria-label={`Pack quantity for ${item.name}`}><button type="button" disabled={item.qty <= 1} aria-label={`Reduce ${item.name} pack quantity`} onClick={() => dispatch({ type: 'UPDATE_ITEM_QTY', orderId: activeOrder.id, rxId: selectedRx.id, productId: item.productId, qty: item.qty - 1 })}><Minus size={14} /></button><span aria-live="polite"><strong>{item.qty}</strong><small>{item.qty === 1 ? 'pack' : 'packs'}</small></span><button type="button" aria-label={`Increase ${item.name} pack quantity`} onClick={() => dispatch({ type: 'UPDATE_ITEM_QTY', orderId: activeOrder.id, rxId: selectedRx.id, productId: item.productId, qty: item.qty + 1 })}><Plus size={14} /></button></div></div>
                                  <label className="rx-dispensing-custom"><span>Prescribed {state.catalogue.find(product => product.id === item.productId)?.unit ?? 'units'}</span><span className="money-input"><input type="number" min="1" step="1" value={item.unitsNeededCount ?? 1} onChange={event => dispatch({ type: 'UPDATE_ITEM_UNITS', orderId: activeOrder.id, rxId: selectedRx.id, productId: item.productId, unitsNeededCount: Number(event.target.value) })} aria-label={`Prescribed units for ${item.name}`} /></span></label>
                                  <div className="rx-price-flow rx-price-flow--readonly" aria-label={`Pricing for ${item.name}`}>
                                    <span className="rx-price-node rx-price-node--px"><small>Patient price</small><strong>{money(item.retail)}</strong><em>Set by Curaleaf · {money(lineRevenue(item))} line</em></span>
                                    <span className="rx-price-node rx-price-node--wx"><small>Wholesale cost</small><strong>{item.cost === null ? 'Quote required' : money(item.cost)}</strong><em>{item.cost === null ? 'Order-specific' : `${money(lineCost(item))} line`}</em></span>
                                  </div>
                                  <span className={`rx-prescribed-item__contribution${margin !== null && margin < 25 ? ' low' : ''}`}><small>Gross margin</small>{contribution === null ? <><strong>Pending quote</strong><em>Calculated when Curaleaf returns wholesale cost</em></> : <><strong>{contribution >= 0 ? '+' : '−'}{money(Math.abs(contribution))}</strong><em>{item.retail - item.cost! >= 0 ? '+' : '−'}{money(Math.abs(item.retail - item.cost!))} per unit</em></>}</span>
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
                <header className="rx-surface__header"><div><span className="rx-step-number">03</span><span><small>{state.workspaceMode === 'training' ? 'Curaleaf test formulary' : 'Live Curaleaf formulary'}</small><strong>Add products to Rx {selectedRxIndex + 1}</strong></span></div><span className="rx-formulary-result">{filteredProducts.length} products</span></header>
                {state.catalogueLoading ? <ProviderStatusNotice state="loading" title="Refreshing Curaleaf products" detail="The latest patient prices and pack information are being retrieved." /> : null}
                {state.catalogueError ? <ProviderStatusNotice title="Curaleaf information is temporarily delayed" detail="Wait and try again later. If this continues, contact your HHH administrator; pharmacy staff do not need to change the connection." /> : null}
                <div className="rx-formulary-tools"><label className="rx-search"><Search size={15} /><input className="input" placeholder="Search product or strength" aria-label="Search Curaleaf formulary" value={catalogQuery} onChange={event => setCatalogQuery(event.target.value)} /></label><div className="rx-type-filter" role="group" aria-label="Filter formulary by type">{TYPE_FILTERS.map(type => <button type="button" key={type} aria-pressed={catalogTypeFilter === type} onClick={() => setCatalogTypeFilter(type)}>{type === 'All' ? 'All' : TYPE_LABELS[type] || type}</button>)}</div></div>
                <div className="rx-catalogue" role="list">
                  {filteredProducts.length === 0 ? <div className="rx-inline-empty"><Search size={20} /><span><strong>No matching products</strong><small>Change the search or category filter.</small></span></div> : filteredProducts.map((item, index) => {
                    const patientPrice = item.retail;
                    const margin = marginPct(item.cost, patientPrice);
                    const outOfStock = item.availability === 'out' || item.supplierState !== 'ACTIVE' || patientPrice <= 0;
                    const added = Boolean(selectedRx?.items.some(line => line.productId === item.id));
                    return <div role="listitem" className={`rx-catalogue-row${outOfStock ? ' unavailable' : ''}`} key={item.id} style={{ '--stagger-index': index } as CSSProperties}><div className="rx-catalogue-row__name"><strong>{item.name}</strong><span>{TYPE_LABELS[item.type] || item.type}{item.packSize !== undefined ? ` · ${item.packSize} ${item.unit ?? 'units'} per pack` : ''}</span></div><div className={`stock-indicator stock-${item.availability}`}><span /><span>{availabilityLabel(item)}</span></div><div className="rx-catalogue-row__price"><strong>{patientPrice > 0 ? money(patientPrice) : 'Not supplied'}</strong><span>{patientPrice > 0 ? 'Patient price · Curaleaf' : 'Awaiting Curaleaf price'}</span></div><span className={margin === null ? '' : margin >= 25 ? 'text-green' : 'text-amber'}>{margin === null ? 'Wholesale on quote' : `${margin}% margin`}</span><button type="button" className="btn btn-sm" disabled={outOfStock || added || !selectedRx} onClick={() => addToRx(item)}>{added ? <><CheckCircle size={13} /> Added</> : <><Plus size={13} /> Add</>}</button></div>;
                  })}
                </div>
              </section>
            </main>

            <aside className="rx-checkout-rail">
              <section className="rx-checkout-panel" id="rx-order-review">
                <header><small>Order {activeOrder.id}</small><strong>Review and request payment</strong></header>
                <dl className="rx-order-totals"><div><dt>Prescription records</dt><dd>{activeOrder.prescriptions.length}</dd></div><div><dt>Wholesale total</dt><dd>{wholesaleKnown ? money(orderCost(activeOrder)) : state.workspaceMode === 'training' ? 'Not supplied' : 'Quote required'}</dd></div><div><dt>Patient-price subtotal</dt><dd>{money(orderRevenue(activeOrder) - activeOrder.dispensingFee)}</dd></div><div><dt>Product margin</dt><dd className={orderMargin === null ? '' : orderMargin >= 25 ? 'text-green' : 'text-amber'}>{orderMargin === null ? 'Pending' : `${orderMargin}%`}</dd></div></dl>
                <div className={`rx-checkout-readiness${quoteError ? ' has-error' : ''}`}>
                  <span className="section-label">{state.workspaceMode === 'training' ? 'Curaleaf test quote' : 'Live Curaleaf quote'}</span>
                  <span className={quoteCurrent ? 'complete' : ''}>{quoteCurrent ? <CheckCircle size={13} /> : <span className="rx-readiness-dot" />}{quoteCurrent ? 'Wholesale and stock verified' : state.workspaceMode === 'training' ? 'Optional availability and wholesale check' : 'Required for current quantities'}</span>
                  {quoteSummary && quoteCurrent ? <span className="complete"><CheckCircle size={13} /> Shipping {money(quoteSummary.shippingPrice)} · tax {quoteSummary.taxRate}%</span> : null}
                  {quoteError ? <ProviderStatusNotice title="Quote not available yet" detail={quoteError} /> : null}
                  <button type="button" className="btn btn-sm" disabled={quoteBusy || !currentQuoteItems.length} onClick={() => void refreshQuote()}><RefreshCw size={13} className={quoteBusy ? 'spin' : ''} /> {quoteBusy ? 'Requesting quote…' : quoteCurrent ? 'Refresh Curaleaf quote' : 'Get Curaleaf quote'}</button>
                </div>
                <div className="rx-dispensing-charge">
                  <span><strong>Dispensing charge</strong><small>Optional pharmacy charge · patient collection only</small></span>
                  <div className="rx-dispensing-presets" role="group" aria-label="Set dispensing charge">{[5, 10, 15].map(amount => <button type="button" key={amount} aria-pressed={activeOrder.dispensingFee === amount} onClick={() => dispatch({ type: 'SET_ORDER_DISPENSING_FEE', orderId: activeOrder.id, amount })}>{money(amount)}</button>)}<button type="button" aria-pressed={activeOrder.dispensingFee === 0} onClick={() => dispatch({ type: 'SET_ORDER_DISPENSING_FEE', orderId: activeOrder.id, amount: 0 })}>No charge</button></div>
                  <label className="rx-dispensing-custom"><span>Custom</span><span className="money-input"><span>£</span><input type="number" min="0" max="100" step="0.01" value={activeOrder.dispensingFee} onFocus={event => event.currentTarget.select()} onChange={event => dispatch({ type: 'SET_ORDER_DISPENSING_FEE', orderId: activeOrder.id, amount: Math.max(0, Math.min(100, Number(event.target.value))) })} aria-label="Custom dispensing charge" /></span></label>
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
                  <button type="button" className="btn btn-primary rx-create-payment" disabled={checkoutBusy || !readyForPayment || (selectedPaymentRoute === 'worldpay' && !canUseWorldpay)} onClick={() => void createPaymentRequest()}><Send size={15} />{checkoutBusy ? 'Saving order…' : selectedPaymentRoute === 'worldpay' ? 'Create Worldpay request' : 'Continue with pharmacy payment'}</button>
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
