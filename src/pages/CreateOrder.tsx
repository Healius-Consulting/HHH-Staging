import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, Banknote, CheckCircle, CreditCard, FileScan, FileText, Pencil, Plus, RefreshCw, Save, Search, Send, ShieldCheck, Trash2, Upload } from 'lucide-react';
import ProviderStatusNotice from '../components/ProviderStatusNotice';
import ManualPrescriptionEditor from '../components/ManualPrescriptionEditor';
import {
  useApp,
  money,
  lineRevenue,
  lineCost,
  lineMargin,
  orderRevenue,
  orderCost,
  marginPct,
  type LineItem,
} from '../context/AppContext';
import { isLocalPortalPreview } from '../dev/localPortalPreview';
import { createPortalOrder, createWorldpaySession, getCuraleafQuote, getCuraleafTrainingQuote, getDevCuraleafQuote, isApiConfigured, scanCuraleafClinicPrescription, uploadPrescriptionFile } from '../shared/api';
import { formatPatientDob } from '../utils/patientDob';
import { checkPatientIdentity } from '../utils/patientIdentity';

export default function CreateOrder() {
  const { state, dispatch } = useApp();
  const tenantPatients = state.crm.filter(patient => patient.organisationId === state.currentOrganisationId && patient.status !== 'Suspended');
  const organisation = state.organisations.find(org => org.id === state.currentOrganisationId) ?? state.organisations[0];
  const canUseWorldpay = organisation.worldpay.enabled && organisation.worldpay.status === 'connected';
  const selectedPaymentRoute = organisation.defaultPaymentRoute === 'worldpay' && canUseWorldpay ? 'worldpay' : 'pharmacy';
  const draftOrders = state.orders.filter(order => order.organisationId === state.currentOrganisationId && order.payment.status === 'none');
  const activeOrder = state.orders.find(order => order.organisationId === state.currentOrganisationId && order.id === state.activeOrderId && order.payment.status === 'none');
  const patient = activeOrder?.patientId ? tenantPatients.find(candidate => candidate.id === activeOrder.patientId) ?? null : null;
  const [selectedRxId, setSelectedRxId] = useState<number | null>(null);
  const [changingPatient, setChangingPatient] = useState(false);
  const [patientQuery, setPatientQuery] = useState('');
  const [patientSearchOpen, setPatientSearchOpen] = useState(false);
  const [patientActiveIndex, setPatientActiveIndex] = useState(0);
  const [confirmingDraftDelete, setConfirmingDraftDelete] = useState(false);
  const [quoteBusy, setQuoteBusy] = useState(false);
  const [quoteError, setQuoteError] = useState<{ title: string; detail: string } | null>(null);
  const [quotedSignature, setQuotedSignature] = useState<string | null>(null);
  const [quoteSummary, setQuoteSummary] = useState<{ shippingPrice: number; taxRate: number } | null>(null);
  const [quotedUnavailableProductIds, setQuotedUnavailableProductIds] = useState<string[]>([]);
  const [uploadingRxId, setUploadingRxId] = useState<number | null>(null);
  const [readingRxId, setReadingRxId] = useState<number | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [editingClinicFormularyRxId, setEditingClinicFormularyRxId] = useState<number | null>(null);

  useEffect(() => {
    if (!activeOrder?.prescriptions.length) return setSelectedRxId(null);
    if (!activeOrder.prescriptions.some(rx => rx.id === selectedRxId)) setSelectedRxId(activeOrder.prescriptions[0].id);
  }, [activeOrder, selectedRxId]);

  useEffect(() => {
    setChangingPatient(false);
    setPatientQuery('');
    setPatientSearchOpen(false);
    setPatientActiveIndex(0);
    setConfirmingDraftDelete(false);
    setQuoteError(null);
    setQuotedSignature(null);
    setQuoteSummary(null);
    setQuotedUnavailableProductIds([]);
    setEditingClinicFormularyRxId(null);
  }, [activeOrder?.id]);

  const matchingPatients = useMemo(() => {
    const query = patientQuery.trim().toLowerCase();
    return tenantPatients.filter(candidate => !query || [candidate.name, candidate.email, candidate.mobile, candidate.dob ?? '', formatPatientDob(candidate.dob)].some(value => value.toLowerCase().includes(query))).slice(0, 7);
  }, [patientQuery, tenantPatients]);

  const selectedRx = activeOrder?.prescriptions.find(rx => rx.id === selectedRxId) ?? null;
  const selectedRxIndex = activeOrder && selectedRx ? activeOrder.prescriptions.findIndex(rx => rx.id === selectedRx.id) : -1;
  const requiresLiveCuraleafEvidence = state.workspaceMode === 'live' && !isLocalPortalPreview;
  const identityCheck = selectedRx && patient ? checkPatientIdentity({
    selectedName: patient.name,
    selectedDob: patient.dob,
    prescriptionName: selectedRx.curaleafPatientName,
    prescriptionDob: selectedRx.curaleafPatientDob,
  }) : null;
  const readiness = activeOrder ? [
    { label: 'Approved patient linked', complete: Boolean(activeOrder.patientId) },
    { label: 'Prescription copies attached', complete: activeOrder.prescriptions.every(rx => Boolean(rx.copyFileName) && (!requiresLiveCuraleafEvidence || Boolean(rx.fileId))) },
    { label: 'Prescription source verified', complete: activeOrder.prescriptions.every(rx => rx.entryMode === 'manual' || Boolean(rx.clinicScanId && rx.curaleafPrescriptionId)) },
    { label: 'Prescription details complete', complete: activeOrder.prescriptions.every(rx => Boolean(rx.issueDate && rx.prescriber.trim() && (rx.entryMode === 'manual' ? rx.prescriberPin?.trim() : rx.prescriberId))) },

    { label: 'Patient identity matches', complete: Boolean(patient) && activeOrder.prescriptions.every(rx => checkPatientIdentity({ selectedName: patient!.name, selectedDob: patient!.dob, prescriptionName: rx.curaleafPatientName, prescriptionDob: rx.curaleafPatientDob }).status === 'match') },
    { label: 'Formulary medicines selected', complete: activeOrder.prescriptions.every(rx => rx.items.length > 0 && rx.items.every(item => item.formulaId && item.unitsNeededCount)) },
  ] : [];
  const prescriptionReady = readiness.every(item => item.complete);
  const wholesaleKnown = Boolean(activeOrder?.prescriptions.every(rx => rx.items.every(item => item.cost !== null)));
  const orderMargin = activeOrder && wholesaleKnown
    ? marginPct(orderCost(activeOrder), orderRevenue(activeOrder) - activeOrder.dispensingFee)
    : null;
  const currentQuoteItems = activeOrder?.prescriptions.flatMap(rx => rx.items.map(item => ({ packId: item.productId, quantity: item.qty }))) ?? [];
  const currentQuoteSignature = JSON.stringify(currentQuoteItems.slice().sort((a, b) => a.packId.localeCompare(b.packId)));

  useEffect(() => {
    setQuoteError(null);
    setQuotedSignature(null);
    setQuoteSummary(null);
    setQuotedUnavailableProductIds([]);
  }, [currentQuoteSignature]);

  const quoteCurrent = wholesaleKnown && quotedSignature === currentQuoteSignature;
  const currentUnavailableProductIds = quotedSignature === currentQuoteSignature ? quotedUnavailableProductIds : [];
  const quoteAvailable = quoteCurrent && currentUnavailableProductIds.length === 0;
  const readyForPayment = prescriptionReady && (!requiresLiveCuraleafEvidence || quoteAvailable);

  const initials = (name: string) => name.split(' ').map(word => word[0]).join('').toUpperCase().slice(0, 2);
  const gmcNumber = (value?: string) => {
    const number = value?.trim() ? Number(value) : null;
    return number && Number.isInteger(number) && number > 0 ? number : null;
  };
  const applyClinicScan = (rxId: number, scan: Awaited<ReturnType<typeof scanCuraleafClinicPrescription>>) => {
    if (!activeOrder || scan.status !== 'ready' || !scan.prescription || !scan.prescriber || !scan.matchedItems?.length) return false;
    const items: LineItem[] = scan.matchedItems.map(item => ({
      productId: item.packId,
      formulaId: item.formulaId,
      name: item.formulaName,
      qty: item.quantity,
      unitsNeededCount: item.unitsNeededCount,
      cost: null,
      retail: Number(item.patientPackPrice),
    }));
    dispatch({
      type: 'APPLY_CURALEAF_SCAN',
      orderId: activeOrder.id,
      rxId,
      scan: {
        scanId: scan.scanId,
        prescriptionId: scan.prescription.id,
        state: scan.prescription.state,
        serialNumber: scan.prescription.serialNumber,
        issueDate: scan.prescription.issueDate,
        expiryDate: scan.prescription.expiryDate,
        prescriberId: scan.prescriber.id,
        prescriberName: scan.prescriber.name,
        prescriberGmcNumber: scan.prescriber.gmcNumber?.toString() ?? '',
        prescriberGphcNumber: scan.prescriber.gphcNumber ?? '',
        patientName: scan.prescription.patient?.name,
        patientDob: scan.prescription.patient?.dob,
        items,
      },
    });
    setQuotedSignature(null);
    setQuoteSummary(null);
    setQuotedUnavailableProductIds([]);
    setQuoteError(null);
    return true;
  };

  const readClinicBarcode = async (rxId: number, fileId: string) => {
    if (!activeOrder) return;
    setReadingRxId(rxId);
    setScanError(null);
    try {
      const scan = await scanCuraleafClinicPrescription(state.currentOrganisationId, fileId);
      if (scan.status === 'processing') {
        dispatch({ type: 'ADD_TOAST', message: 'Curaleaf is still reading the barcode. Wait a moment, then check again.', toastType: 'info' });
        return;
      }
      if (!applyClinicScan(rxId, scan)) throw new Error('Curaleaf did not return the complete prescription and pack details.');
      dispatch({ type: 'ADD_TOAST', message: 'Curaleaf verified the barcode and supplied the prescription details.', toastType: 'success' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Curaleaf could not read this prescription barcode.';
      setScanError(message);
      dispatch({ type: 'ADD_TOAST', message, toastType: 'error' });
    } finally {
      setReadingRxId(null);
    }
  };

  const applySyntheticClinicScan = (rxId: number, fileName = `synthetic-curaleaf-clinic-${rxId}.pdf`) => {
    if (!activeOrder) return;
    const product = state.catalogue.find(item => item.supplierState === 'ACTIVE' && item.formulaId && item.packSize && item.retail > 0)
      ?? state.catalogue.find(item => item.formulaId && item.packSize)
      ?? {
        id: '00000000-0000-4000-8000-000000000002',
        formulaId: '00000000-0000-4000-8000-000000000001',
        name: 'Synthetic Curaleaf Clinic training medicine',
        packSize: 10,
        retail: 50,
        cost: 35,
      };
    const issued = new Date();
    const expiry = new Date(issued);
    expiry.setDate(expiry.getDate() + 28);
    const serial = `TRAINING-${issued.toISOString().slice(0, 10).replaceAll('-', '')}-${activeOrder.id}-${rxId}`;
    dispatch({ type: 'SET_RX_FILE', orderId: activeOrder.id, rxId, fileName, fileId: null });
    dispatch({
      type: 'APPLY_CURALEAF_SCAN',
      orderId: activeOrder.id,
      rxId,
      scan: {
        scanId: `training-scan-${activeOrder.id}-${rxId}`,
        prescriptionId: `training-prescription-${activeOrder.id}-${rxId}`,
        state: 'ACTIVE',
        serialNumber: serial,
        issueDate: issued.toISOString().slice(0, 10),
        expiryDate: expiry.toISOString().slice(0, 10),
        prescriberId: `training-prescriber-${rxId}`,
        prescriberName: 'Dr Curaleaf Training',
        prescriberGmcNumber: '7000001',
        prescriberGphcNumber: '',
        patientName: patient?.name ?? 'Training Patient',
        patientDob: patient?.dob ?? '1980-01-01',
        items: [{
          productId: product.id,
          formulaId: product.formulaId,
          name: product.name,
          qty: 1,
          unitsNeededCount: product.packSize ?? 1,
          cost: product.cost,
          retail: product.retail,
        }],
      },
    });
    dispatch({ type: 'ADD_TOAST', message: 'Synthetic Clinic barcode verified for training. Nothing was sent to Curaleaf.', toastType: 'info' });
  };

  const createPaymentRequest = async () => {
    if (!activeOrder || !readyForPayment) return;
    setCheckoutBusy(true);
    try {
      if (!isLocalPortalPreview && state.workspaceMode === 'live') {
        if (!quoteAvailable) throw new Error('A complete in-stock Curaleaf quote is required before creating the live order.');
        const lineItems = activeOrder.prescriptions.flatMap(rx => rx.items.map(item => ({
          packId: item.productId,
          quantity: item.qty,
        })));
        const persisted = activeOrder.backendId ? { id: activeOrder.backendId } : await createPortalOrder({
          organisationId: state.currentOrganisationId,
          patientId: activeOrder.patientId!,
          lineItems,
          prescriptions: activeOrder.prescriptions.map(rx => ({
            fileId: rx.fileId!,
            clinicScanId: rx.clinicScanId,
            curaleafPrescriptionId: rx.curaleafPrescriptionId,
            serialNumber: rx.serialNumber!,
            issueDate: rx.issueDate!,
            expiryDate: rx.expiryDate,
            patient: {
              name: rx.curaleafPatientName!,
              dob: rx.curaleafPatientDob!,
            },
            prescriber: {
              id: rx.prescriberId,
              pin: rx.prescriberPin ?? '',
              gmcNumber: gmcNumber(rx.prescriberGmcNumber),
              gphcNumber: rx.prescriberGphcNumber?.trim() || null,
              name: rx.prescriber,
              initials: rx.prescriber.split(/\s+/).map(part => part[0]).join('').toUpperCase().slice(0, 20),
            },
            items: rx.items.map(item => ({
              formulaId: item.formulaId!,
              unitsNeededCount: item.unitsNeededCount!,
              packId: item.productId,
              quantity: item.qty,
            })),
          })),
          dispensingFeePence: Math.round(activeOrder.dispensingFee * 100),
          currency: 'GBP',
        });
        if (!activeOrder.backendId) {
          dispatch({ type: 'SET_ORDER_BACKEND_ID', orderId: activeOrder.id, backendId: persisted.id });
          if ('lineItems' in persisted) dispatch({
            type: 'SYNC_ORDER_PATIENT_PRICES',
            orderId: activeOrder.id,
            items: persisted.lineItems.map(item => ({ productId: item.productId, patientPrice: item.unitPricePence / 100 })),
          });
        }
        if (selectedPaymentRoute === 'worldpay') {
          if (!canUseWorldpay) throw new Error('This pharmacy’s Worldpay connection is not verified. Change the default route in Settings.');
          const origin = window.location.origin;
          const session = await createWorldpaySession(persisted.id, {
            organisationId: state.currentOrganisationId,
            successUrl: `${origin}/?payment=success`,
            cancelUrl: `${origin}/?payment=cancelled`,
          });
          const provider = session.provider as { url?: string; _links?: { redirect?: { href?: string } } };
          const paymentUrl = provider.url ?? provider._links?.redirect?.href;
          if (paymentUrl) await navigator.clipboard.writeText(paymentUrl).catch(() => undefined);
          dispatch({ type: 'SEND_PAYMENT_LINK', orderId: activeOrder.id });
          dispatch({ type: 'ADD_TOAST', message: paymentUrl ? 'Worldpay checkout created and its secure link copied.' : 'Worldpay checkout created. It is awaiting the patient.', toastType: 'success' });
        } else {
          dispatch({ type: 'START_MANUAL_PAYMENT', orderId: activeOrder.id });
          dispatch({ type: 'ADD_TOAST', message: 'Order saved. Confirm the pharmacy payment before sending its prescriptions to Curaleaf.', toastType: 'success' });
        }
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
    const prescription = activeOrder.prescriptions.find(candidate => candidate.id === rxId);
    if (isLocalPortalPreview || state.workspaceMode !== 'live') {
      if (prescription?.entryMode === 'manual') {
        dispatch({ type: 'SET_RX_FILE', orderId: activeOrder.id, rxId, fileName: file.name, fileId: `training-file-${activeOrder.id}-${rxId}` });
        dispatch({ type: 'ADD_TOAST', message: 'Manual prescription attached for training. Nothing was uploaded.', toastType: 'info' });
      } else {
        applySyntheticClinicScan(rxId, file.name);
      }
      return;
    }
    setUploadingRxId(rxId);
    try {
      const contentType = file.type as 'application/pdf' | 'image/jpeg' | 'image/png';
      if (!['application/pdf', 'image/jpeg', 'image/png'].includes(contentType)) throw new Error('Use a PDF, JPG or PNG prescription file.');
      if (file.size > 16_000_000) throw new Error('Prescription files must be 16 MB or smaller.');
      const uploaded = await uploadPrescriptionFile({ organisationId: state.currentOrganisationId, filename: file.name, contentType, sizeBytes: file.size }, file);
      dispatch({ type: 'SET_RX_FILE', orderId: activeOrder.id, rxId, fileName: file.name, fileId: uploaded.id });
      if (prescription?.entryMode === 'manual') {
        dispatch({ type: 'ADD_TOAST', message: 'Manual prescription copy uploaded securely.', toastType: 'success' });
      } else {
        dispatch({ type: 'ADD_TOAST', message: 'Prescription uploaded securely. Curaleaf is reading its barcode now.', toastType: 'success' });
        await readClinicBarcode(rxId, uploaded.id);
      }
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
      const quotedPackIds = new Set(quote.items.map(item => item.packId));
      const missingPackIds = [...new Set(currentQuoteItems.map(item => item.packId).filter(packId => !quotedPackIds.has(packId)))];
      const lineNames = (packIds: string[]) => [...new Set(
        activeOrder.prescriptions.flatMap(rx => rx.items)
          .filter(item => packIds.includes(item.productId))
          .map(item => item.name),
      )];
      if (missingPackIds.length) {
        const names = lineNames(missingPackIds);
        setQuotedSignature(null);
        setQuoteSummary(null);
        setQuotedUnavailableProductIds([]);
        setQuoteError({
          title: 'Selected pack not quoted by Curaleaf',
          detail: state.workspaceMode === 'training'
            ? `Curaleaf returned no wholesale or availability line for ${names.join(', ') || 'the selected pack'}. The draft is unchanged and no supplier order has been sent.`
            : `Curaleaf returned no wholesale or availability line for ${names.join(', ') || 'the selected pack'}, although it remains listed in the catalogue. Keep the draft and retry later, or ask your HHH administrator to raise the pack with Curaleaf.`,
        });
        return;
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
      const unavailableProductIds = quote.items.filter(item => !item.inStock).map(item => item.packId);
      setQuotedSignature(currentQuoteSignature);
      setQuoteSummary({ shippingPrice: Number(quote.shippingPrice) || 0, taxRate: Number(quote.taxRate) || 0 });
      setQuotedUnavailableProductIds(unavailableProductIds);
      if (unavailableProductIds.length) {
        const names = lineNames(unavailableProductIds);
        setQuoteError({
          title: 'Selected pack is currently unavailable',
          detail: `Curaleaf returned pricing for ${names.join(', ') || 'the selected pack'} but marked it out of stock. Payment remains blocked; keep the draft and refresh later.`,
        });
        dispatch({ type: 'ADD_TOAST', message: 'Curaleaf returned pricing, but one or more selected packs are out of stock.', toastType: 'info' });
      } else {
        setQuoteError(null);
        dispatch({ type: 'ADD_TOAST', message: `Curaleaf quote refreshed for ${quote.items.length} product line${quote.items.length === 1 ? '' : 's'}.`, toastType: 'success' });
      }
    } catch (error) {
      setQuoteSummary(null);
      setQuotedSignature(null);
      setQuotedUnavailableProductIds([]);
      setQuoteError({
        title: 'Quote request could not be completed',
        detail: error instanceof Error ? error.message : 'The Curaleaf quote could not be loaded. Wait and retry, or contact your HHH administrator if this continues.',
      });
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

  const unresolvedOrderForPatient = useMemo(() => {
    if (!patient) return null;
    const now = new Date();
    return state.orders.find(order => {
      if (order.organisationId !== state.currentOrganisationId || order.patientId !== patient.id) return false;
      const entryDate = new Date(order.date);
      const expiryDate = new Date(entryDate);
      expiryDate.setDate(expiryDate.getDate() + 28);
      const isExpired = now > expiryDate;
      const hasRejection = order.quoteReview !== undefined;
      return isExpired || hasRejection;
    }) ?? null;

  }, [patient, state.currentOrganisationId, state.orders]);

  const handleRedoPrescription = (unresolvedOrder: typeof unresolvedOrderForPatient) => {
    if (!unresolvedOrder || !activeOrder) return;
    const itemsToPrefill = unresolvedOrder.prescriptions.flatMap(rx => rx.items);
    if (itemsToPrefill.length && activeOrder.prescriptions.length) {
      const targetRx = activeOrder.prescriptions[0];
      itemsToPrefill.forEach(item => {
        dispatch({
          type: 'ADD_ITEM_TO_RX',
          orderId: activeOrder.id,
          rxId: targetRx.id,
          item: {
            productId: item.productId,
            formulaId: item.formulaId,
            name: item.name,
            qty: item.qty,
            unitsNeededCount: item.unitsNeededCount,
            cost: item.cost,
            retail: item.retail,
          },
        });
      });
      dispatch({
        type: 'ADD_TOAST',
        message: `Pre-filled ${itemsToPrefill.length} prescribed items from Order #${unresolvedOrder.id}. Please attach the new prescription PDF for mandatory Curaleaf API authentication.`,
        toastType: 'info',
      });
    }
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

  const renderFormularyEditor = () => {
    if (!selectedRx || !activeOrder) return null;
    return (
      <ManualPrescriptionEditor
        view="formulary"
        prescription={selectedRx}
        catalogue={state.catalogue}
        onPrescriberChange={value => dispatch({ type: 'SET_RX_PRESCRIBER', orderId: activeOrder.id, rxId: selectedRx.id, prescriber: value })}
        onMetadataChange={(field, value) => dispatch({ type: 'SET_RX_METADATA', orderId: activeOrder.id, rxId: selectedRx.id, updates: { [field]: value } })}
        onAddItem={item => dispatch({ type: 'ADD_ITEM_TO_RX', orderId: activeOrder.id, rxId: selectedRx.id, item })}
        onRemoveItem={productId => dispatch({ type: 'REMOVE_ITEM_FROM_RX', orderId: activeOrder.id, rxId: selectedRx.id, productId })}
        onUpdateQuantity={(productId, qty) => dispatch({ type: 'UPDATE_ITEM_QTY', orderId: activeOrder.id, rxId: selectedRx.id, productId, qty })}
        onUpdateUnits={(productId, unitsNeededCount) => dispatch({ type: 'UPDATE_ITEM_UNITS', orderId: activeOrder.id, rxId: selectedRx.id, productId, unitsNeededCount })}
      />
    );
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

          {/* Unresolved Expired / Rejected Orders Banner */}
          {patient && unresolvedOrderForPatient ? (
            <div className="alert-box alert-warning" style={{ margin: '12px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <AlertTriangle size={20} />
                <div>
                  <strong>Unresolved Order #{unresolvedOrderForPatient.id} ({unresolvedOrderForPatient.quoteReview ? 'Curaleaf Exception / Rejected' : '28-Day Prescription Expired'})</strong>

                  <p style={{ margin: 0, fontSize: '0.85rem' }}>
                    {unresolvedOrderForPatient.prescriptions.flatMap(r => r.items).length} prescribed item(s) from previous cycle. Attach new prescription PDF for mandatory Curaleaf authentication.
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="button button-secondary button-sm"
                onClick={() => handleRedoPrescription(unresolvedOrderForPatient)}
              >
                <RefreshCw size={14} />
                <span>Deal with Order / Redo Prescription</span>
              </button>
            </div>
          ) : null}


          <button type="button" className="rx-mobile-review-bar" onClick={() => document.getElementById('rx-order-review')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
            <span><small>Patient total</small><strong>{money(orderRevenue(activeOrder))}</strong></span>
            <span>Review order <ArrowRight size={15} /></span>
          </button>

          <div className="rx-workbench-layout">
            <main className="rx-workbench-main">
              <section className="rx-surface rx-record-editor">
                <header className="rx-surface__header">
                  <div><span className="rx-step-number">02</span><span><small>Prescription records</small><strong>Attach and verify the selected Rx</strong></span></div>
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
                      <div className="rx-entry-mode" role="group" aria-label="Prescription entry route">
                        <button type="button" aria-pressed={selectedRx.entryMode === 'clinic'} onClick={() => { setEditingClinicFormularyRxId(null); dispatch({ type: 'SET_RX_ENTRY_MODE', orderId: activeOrder.id, rxId: selectedRx.id, mode: 'clinic' }); }}><FileScan size={15} /><span><strong>Curaleaf Clinic QR</strong><small>Preferred automatic route</small></span></button>
                        <button type="button" aria-pressed={selectedRx.entryMode === 'manual'} onClick={() => { setEditingClinicFormularyRxId(null); dispatch({ type: 'SET_RX_ENTRY_MODE', orderId: activeOrder.id, rxId: selectedRx.id, mode: 'manual' }); }}><Pencil size={15} /><span><strong>Manual prescription</strong><small>Copy from the signed document</small></span></button>
                      </div>
                      <div className="rx-clinic-note"><FileScan size={18} aria-hidden="true" /><span><strong>{selectedRx.entryMode === 'clinic' ? 'Scan the Curaleaf Clinic barcode' : 'Attach the complete signed prescription'}</strong><span>{selectedRx.entryMode === 'clinic' ? 'Attach the complete prescription with a clear barcode. Curaleaf supplies the serial, dates, prescriber, patient identity, formula and prescribed quantity.' : 'Use this only when the Clinic QR cannot be read. Copy every detail exactly as printed before taking payment.'}</span></span></div>
                      {isLocalPortalPreview && selectedRx.entryMode === 'clinic' ? <button type="button" className={`rx-document-control${selectedRx.clinicScanId ? ' uploaded' : ''}`} onClick={() => applySyntheticClinicScan(selectedRx.id)}>
                        {selectedRx.clinicScanId ? <CheckCircle size={18} /> : <FileScan size={18} />}<span><strong>{selectedRx.clinicScanId ? 'Synthetic Clinic barcode verified' : 'Use synthetic Clinic barcode'}</strong><small>Isolated local training fixture · nothing is uploaded or sent</small></span>
                      </button> : <label className={`rx-document-control${selectedRx.copyFileName ? ' uploaded' : ''}${readingRxId === selectedRx.id ? ' scanning' : ''}`}>
                        <input className="sr-only" type="file" accept=".pdf,image/jpeg,image/png" disabled={uploadingRxId !== null} onChange={event => { const file = event.target.files?.[0]; if (file) void attachPrescriptionFile(selectedRx.id, file); }} />
                        {selectedRx.clinicScanId ? <CheckCircle size={18} /> : readingRxId === selectedRx.id ? <RefreshCw size={18} className="spin" /> : <Upload size={18} />}<span><strong>{uploadingRxId === selectedRx.id ? 'Uploading securely…' : readingRxId === selectedRx.id ? 'Curaleaf is reading its barcode…' : selectedRx.copyFileName ?? (selectedRx.entryMode === 'manual' ? 'Attach signed prescription' : 'Attach barcode prescription')}</strong><small>{selectedRx.clinicScanId ? 'Barcode verified and linked to this prescription' : selectedRx.fileId ? 'Uploaded and server-verified' : 'PDF, JPG or PNG · maximum 16 MB'}</small></span>
                      </label>}
                      {selectedRx.entryMode === 'clinic' && !isLocalPortalPreview && selectedRx.fileId && !selectedRx.clinicScanId && readingRxId !== selectedRx.id ? <button type="button" className="btn btn-sm rx-scan-retry" onClick={() => void readClinicBarcode(selectedRx.id, selectedRx.fileId!)}><RefreshCw size={13} /> Check barcode again</button> : null}
                      {selectedRx.entryMode === 'clinic' && scanError ? <ProviderStatusNotice title="Barcode not verified" detail={`${scanError} Check that the full Curaleaf Clinic barcode is sharp and visible. If it still fails, use the manual route or contact your HHH administrator.`} /> : null}
                    </div>

                    <div className="rx-line-editor rx-prescription-details">
                      {selectedRx.entryMode === 'manual' ? (
                        <ManualPrescriptionEditor
                          view="details"
                          prescription={selectedRx}
                          catalogue={state.catalogue}
                          onPrescriberChange={value => dispatch({ type: 'SET_RX_PRESCRIBER', orderId: activeOrder.id, rxId: selectedRx.id, prescriber: value })}
                          onMetadataChange={(field, value) => dispatch({ type: 'SET_RX_METADATA', orderId: activeOrder.id, rxId: selectedRx.id, updates: { [field]: value } })}
                          onAddItem={item => dispatch({ type: 'ADD_ITEM_TO_RX', orderId: activeOrder.id, rxId: selectedRx.id, item })}
                          onRemoveItem={productId => dispatch({ type: 'REMOVE_ITEM_FROM_RX', orderId: activeOrder.id, rxId: selectedRx.id, productId })}
                          onUpdateQuantity={(productId, qty) => dispatch({ type: 'UPDATE_ITEM_QTY', orderId: activeOrder.id, rxId: selectedRx.id, productId, qty })}
                          onUpdateUnits={(productId, unitsNeededCount) => dispatch({ type: 'UPDATE_ITEM_UNITS', orderId: activeOrder.id, rxId: selectedRx.id, productId, unitsNeededCount })}
                        />
                      ) : selectedRx.clinicScanId ? (
                        <div className="rx-clinic-result" aria-label="Curaleaf verified prescription details">
                          <div className="rx-clinic-result__status"><ShieldCheck size={18} /><span><strong>{isLocalPortalPreview ? 'Synthetic Curaleaf response' : 'Verified by Curaleaf'}</strong><small>{isLocalPortalPreview ? 'Read-only local training fixture' : 'Read-only supplier record'} · {selectedRx.curaleafPrescriptionState}</small></span></div>
                          <dl>
                            <div><dt>Prescription serial</dt><dd>{selectedRx.serialNumber}</dd></div>
                            <div><dt>Prescriber</dt><dd>{selectedRx.prescriber}</dd></div>
                            <div><dt>Issued</dt><dd>{selectedRx.issueDate ? new Date(`${selectedRx.issueDate}T00:00:00`).toLocaleDateString('en-GB') : '—'}</dd></div>
                            <div><dt>Expires</dt><dd>{selectedRx.expiryDate ? new Date(`${selectedRx.expiryDate}T00:00:00`).toLocaleDateString('en-GB') : '—'}</dd></div>
                            <div><dt>Registration</dt><dd>{selectedRx.prescriberGmcNumber ? `GMC ${selectedRx.prescriberGmcNumber}` : selectedRx.prescriberGphcNumber ? `GPhC ${selectedRx.prescriberGphcNumber}` : 'Held by Curaleaf'}</dd></div>
                          </dl>
                        </div>
                      ) : <p className="rx-scan-waiting">No prescription fields need completing. They appear here after Curaleaf verifies the barcode.</p>}
                      {identityCheck && (selectedRx.clinicScanId || selectedRx.entryMode === 'manual' && (selectedRx.curaleafPatientName || selectedRx.curaleafPatientDob)) && identityCheck.status !== 'match' ? <ProviderStatusNotice title={identityCheck.status === 'mismatch' ? 'Patient details do not match' : 'Patient details unavailable'} detail={`${identityCheck.reason} Payment and Curaleaf submission remain blocked until the prescription and patient record match.`} /> : null}
                    </div>
                  </div>
                )}
              </section>

              <section className="rx-surface rx-formulary-stage">
                <header className="rx-surface__header">
                  <div><span className="rx-step-number">03</span><span><small>Formulary and packs</small><strong>{selectedRx?.entryMode === 'manual' ? 'Select the prescribed Curaleaf medicines' : editingClinicFormularyRxId === selectedRx?.id ? 'Correct the Curaleaf formula and pack match' : 'Review the Curaleaf formula and pack match'}</strong></span></div>
                  <div className="rx-formulary-actions">
                    {selectedRx?.items.length ? <span className="pill pill-green"><CheckCircle size={11} /> {selectedRx.entryMode === 'clinic' && editingClinicFormularyRxId !== selectedRx.id ? 'Matched automatically' : `${selectedRx.items.length} selected`}</span> : null}
                    {selectedRx?.entryMode === 'clinic' && selectedRx.clinicScanId ? (
                      editingClinicFormularyRxId === selectedRx.id ? (
                        <button type="button" className="btn btn-sm btn-primary" onClick={() => { setEditingClinicFormularyRxId(null); dispatch({ type: 'ADD_TOAST', message: 'Formulary corrections saved to this prescription draft.', toastType: 'success' }); }}><Save size={13} /> Save formulary</button>
                      ) : (
                        <button type="button" className="btn btn-sm" onClick={() => setEditingClinicFormularyRxId(selectedRx.id)}><Pencil size={13} /> Edit formulary</button>
                      )
                    ) : null}
                  </div>
                </header>
                {state.catalogueLoading ? <ProviderStatusNotice state="loading" title="Refreshing Curaleaf products" detail="The latest patient prices and pack information are being retrieved." /> : null}
                {state.catalogueError ? <ProviderStatusNotice title="Curaleaf information is temporarily delayed" detail="Wait and try again later. If this continues, contact your HHH administrator; pharmacy staff do not need to change the connection." /> : null}
                {!selectedRx ? <div className="rx-inline-empty"><FileText size={20} /><span><strong>Select a prescription record</strong><small>Its prescribed medicines will appear here.</small></span></div> : selectedRx.entryMode === 'manual' || editingClinicFormularyRxId === selectedRx.id ? renderFormularyEditor() : (
                  <div className="rx-line-editor">
                    <div className="rx-line-editor__heading"><span><small>Curaleaf formulary result</small><strong>{selectedRx.items.length} prescribed product{selectedRx.items.length === 1 ? '' : 's'}</strong></span><span>Matched automatically · read-only</span></div>
                    {selectedRx.items.length === 0 ? <div className="rx-inline-empty"><FileScan size={20} /><span><strong>Medicines appear after the barcode scan</strong><small>Curaleaf supplies the formula, prescribed quantity and matching pack automatically.</small></span></div> : (
                      <div className="rx-item-stack">
                        {selectedRx.items.map((item, index) => {
                          const margin = lineMargin(item);
                          const contribution = item.cost === null ? null : lineRevenue(item) - lineCost(item);
                          return (
                            <article className="rx-prescribed-item" key={item.productId}>
                              <header className="rx-prescribed-item__header">
                                <span className="rx-prescribed-item__index">Medicine {String(index + 1).padStart(2, '0')}</span>
                                <span className="rx-prescribed-item__identity"><strong>{item.name}</strong><small>Matched from the Curaleaf prescription</small></span>
                                <span className={`rx-prescribed-item__margin${margin !== null && margin < 25 ? ' low' : ''}`}><strong>{margin === null ? '—' : `${margin}%`}</strong><small>{margin === null ? 'quote pending' : 'margin'}</small></span>
                              </header>
                              <div className="rx-prescribed-item__pricing">
                                <div className="rx-prescribed-item__quantity rx-prescribed-item__quantity--readonly"><small>Curaleaf pack match</small><strong>{item.qty} {item.qty === 1 ? 'pack' : 'packs'}</strong><em>Read-only</em></div>
                                <div className="rx-prescribed-units"><small>Prescribed quantity</small><strong>{item.unitsNeededCount ?? '—'} {state.catalogue.find(product => product.id === item.productId)?.unit ?? 'units'}</strong><em>From barcode</em></div>
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
                )}
              </section>
            </main>

            <aside className="rx-checkout-rail">
              <section className="rx-checkout-panel" id="rx-order-review">
                <header><small>Order {activeOrder.id}</small><strong>Review and request payment</strong></header>
                <dl className="rx-order-totals"><div><dt>Prescription records</dt><dd>{activeOrder.prescriptions.length}</dd></div><div><dt>Wholesale total</dt><dd>{wholesaleKnown ? money(orderCost(activeOrder)) : state.workspaceMode === 'training' ? 'Not supplied' : 'Quote required'}</dd></div><div><dt>Patient-price subtotal</dt><dd>{money(orderRevenue(activeOrder) - activeOrder.dispensingFee)}</dd></div><div><dt>Product margin</dt><dd className={orderMargin === null ? '' : orderMargin >= 25 ? 'text-green' : 'text-amber'}>{orderMargin === null ? 'Pending' : `${orderMargin}%`}</dd></div></dl>
                <div className={`rx-checkout-readiness${quoteError ? ' has-error' : ''}`}>
                  <span className="section-label">{state.workspaceMode === 'training' ? 'Curaleaf test quote' : 'Live Curaleaf quote'}</span>
                  <span className={quoteAvailable ? 'complete' : ''}>{quoteAvailable ? <CheckCircle size={13} /> : <span className="rx-readiness-dot" />}{quoteAvailable ? 'Wholesale and stock verified' : quoteCurrent ? 'Pricing returned · stock unavailable' : state.workspaceMode === 'training' ? 'Optional availability and wholesale check' : 'Required for current quantities'}</span>
                  {quoteSummary && quoteCurrent ? <span className={quoteAvailable ? 'complete' : ''}>{quoteAvailable ? <CheckCircle size={13} /> : <span className="rx-readiness-dot" />} Shipping {money(quoteSummary.shippingPrice)} · tax {quoteSummary.taxRate}%</span> : null}
                  {quoteError ? <ProviderStatusNotice title={quoteError.title} detail={quoteError.detail} /> : null}
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
                  <div className="rx-payment-route-toggle" aria-label="Pharmacy payment route">
                    <div className="is-selected">{selectedPaymentRoute === 'worldpay' ? <CreditCard size={17} /> : <Banknote size={17} />}<span><strong>{selectedPaymentRoute === 'worldpay' ? 'Worldpay' : 'Pharmacy payment'}</strong><small>{selectedPaymentRoute === 'worldpay' ? 'Verified hosted checkout' : 'EPOS, cash or transfer'}</small></span><CheckCircle size={14} /></div>
                  </div>
                  <p className="rx-payment-route-note">This route is set in Pharmacy Settings and is locked when the order is saved. Changing Settings only affects future orders.</p>
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
