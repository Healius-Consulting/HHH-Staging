import { config } from './config.js';
import { firestore } from './firebase.js';
import { HttpError } from './http.js';
import { readIntegrationSecret, readPlatformSecret } from './secrets.js';

const REQUEST_TIMEOUT_MS = 12_000;
/** Soft limit from Curaleaf (Phil, 5 Aug 2026): ~1 request/second per pharmacy key. */
export const TENANT_REQUEST_SPACING_MS = 1000;



export type CuraleafCredential = {
  customerId: string;
  portalEmail: string;
  writeApiKey: string;
  readApiKey?: string;
};
type CuraleafResult = Record<string, unknown> | unknown[] | null;
const READ_METHODS = new Set(['GET', 'HEAD']);

export class CuraleafRequestError extends HttpError {
  constructor(
    status: number,
    message: string,
    public readonly ambiguousWrite = false,
    public readonly retryAfterSeconds: number | null = null,
    public readonly rateLimit: Record<string, string> = {},
  ) {
    super(status, message, 'CURALEAF_REQUEST_FAILED');
    this.name = 'CuraleafRequestError';
  }
}

function retryAfterSeconds(response: Response) {
  const value = response.headers.get('retry-after');
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, Math.ceil((date - Date.now()) / 1_000)) : null;
}

function rateLimitHeaders(response: Response) {
  const result: Record<string, string> = {};
  for (const name of ['retry-after', 'ratelimit-limit', 'ratelimit-remaining', 'ratelimit-reset', 'x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset']) {
    const value = response.headers.get(name);
    if (value) result[name] = value;
  }
  return result;
}

async function wait(milliseconds: number) {
  if (milliseconds <= 0) return;
  await new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function reserveTenantRequestSlot(organisationId: string) {
  const document = firestore.collection('curaleafRateLimits').doc(organisationId);
  const now = Date.now();
  const slot = await firestore.runTransaction(async transaction => {
    const snapshot = await transaction.get(document);
    const data = snapshot.data();
    const nextAllowedAt = Number(data?.nextAllowedAt ?? 0);
    const blockedUntil = Number(data?.blockedUntil ?? 0);
    const reservedAt = Math.max(now, nextAllowedAt, blockedUntil);
    transaction.set(document, {
      organisationId,
      nextAllowedAt: reservedAt + TENANT_REQUEST_SPACING_MS,
      updatedAt: new Date(now).toISOString(),
    }, { merge: true });
    return reservedAt;
  });
  await wait(slot - Date.now());
}

async function blockTenantRequests(organisationId: string, seconds: number) {
  const blockedUntil = Date.now() + Math.max(1, seconds) * 1_000;
  await firestore.collection('curaleafRateLimits').doc(organisationId).set({
    organisationId,
    blockedUntil,
    updatedAt: new Date().toISOString(),
  }, { merge: true });
}

function customerIds(value: unknown): string[] {
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap(customerIds);
  const object = value as Record<string, unknown>;
  return [typeof object.customerId === 'string' ? object.customerId : null, ...Object.values(object).flatMap(customerIds)].filter((item): item is string => Boolean(item));
}

async function curaleafApiKey(method: string): Promise<string> {
  if (READ_METHODS.has(method)) {
    return config.CURALEAF_READ_API_KEY
      ?? config.CURALEAF_WRITE_API_KEY
      ?? config.CURALEAF_API_KEY
      ?? readPlatformSecret(['CURALEAF_READ_API_KEY_EUROPE_WEST2', 'CURALEAF_WRITE_API_KEY_EUROPE_WEST2', 'CURALEAF_API_KEY_EUROPE_WEST2']);
  }
  return config.CURALEAF_WRITE_API_KEY
    ?? config.CURALEAF_API_KEY
    ?? readPlatformSecret(['CURALEAF_WRITE_API_KEY_EUROPE_WEST2', 'CURALEAF_API_KEY_EUROPE_WEST2']);
}

export async function curaleafPlatformRequest<T = CuraleafResult>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase();
  const apiKey = await curaleafApiKey(method);
  return curaleafFetch<T>(path, init, apiKey);
}

async function curaleafFetch<T = CuraleafResult>(path: string, init: RequestInit, apiKey: string, organisationId?: string): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(new URL(path.replace(/^\//, ''), `${config.CURALEAF_BASE_URL}/`), {
      ...init,
      method,
      signal: controller.signal,
      headers: { Accept: 'application/json', 'X-API-Key': apiKey, ...init.headers },
    });
    const text = await response.text();
    let body: T;
    try {
      body = text ? JSON.parse(text) as T : null as T;
    } catch {
      throw new CuraleafRequestError(502, 'Curaleaf returned an invalid JSON response.');
    }
    if (!response.ok) {
      const retryAfter = retryAfterSeconds(response);
      if (response.status === 429 && organisationId) await blockTenantRequests(organisationId, retryAfter ?? 60);
      throw new CuraleafRequestError(
        response.status,
        `Curaleaf rejected the request (${response.status}).`,
        false,
        retryAfter,
        rateLimitHeaders(response),
      );
    }
    return body;
  } catch (error) {
    if (error instanceof CuraleafRequestError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new CuraleafRequestError(504, 'Curaleaf request timed out.', !['GET', 'HEAD'].includes(method));
    }
    throw new CuraleafRequestError(502, 'Curaleaf could not be reached.', !['GET', 'HEAD'].includes(method));
  } finally {
    clearTimeout(timeout);
  }
}

export async function curaleafRequest<T = CuraleafResult>(organisationId: string, path: string, init: RequestInit = {}): Promise<T> {
  const credential = await readIntegrationSecret<Record<string, string>>(organisationId, 'curaleaf');
  if (!credential.customerId || !credential.portalEmail || !credential.writeApiKey) {
    throw new HttpError(409, 'This pharmacy must update its Curaleaf API keys before the integration can be used.', 'CREDENTIAL_UPDATE_REQUIRED');
  }
  const method = (init.method ?? 'GET').toUpperCase();
  const apiKey = READ_METHODS.has(method) ? credential.readApiKey || credential.writeApiKey : credential.writeApiKey;
  await reserveTenantRequestSlot(organisationId);
  const body = await curaleafFetch<T>(path, init, apiKey, organisationId);
  const unexpectedCustomer = customerIds(body).find(id => id !== credential.customerId);
  if (unexpectedCustomer) throw new CuraleafRequestError(502, 'Curaleaf returned data for a different pharmacy customer.');
  return body;
}

async function readAllPages<T>(
  request: <R>(path: string) => Promise<R>,
  path: string,
  collectionKey: string,
  pageSize = 200,
) {
  const records: T[] = [];
  let totalRecordCount = Number.POSITIVE_INFINITY;
  for (let pageNumber = 0; records.length < totalRecordCount && pageNumber < 100; pageNumber += 1) {
    const query = new URLSearchParams({ pageNumber: String(pageNumber), pageSize: String(pageSize) });
    const page = await request<{ totalRecordCount?: number; [key: string]: unknown }>(`${path}?${query}`);
    const items = page[collectionKey];
    if (!Array.isArray(items)) throw new CuraleafRequestError(502, `Curaleaf returned an invalid ${collectionKey} page.`);
    records.push(...items as T[]);
    totalRecordCount = Number(page.totalRecordCount ?? records.length);
    if (items.length === 0) break;
  }
  return { records, totalRecordCount: Number.isFinite(totalRecordCount) ? totalRecordCount : records.length };
}

export function curaleafPlatformList<T>(path: string, collectionKey: string, pageSize = 200) {
  return readAllPages<T>(requestPath => curaleafPlatformRequest(requestPath), path, collectionKey, pageSize);
}

export function curaleafList<T>(organisationId: string, path: string, collectionKey: string, pageSize = 200) {
  return readAllPages<T>(requestPath => curaleafRequest(organisationId, requestPath), path, collectionKey, pageSize);
}

export async function curaleafConnectionStatus(organisationId: string) {
  try {
    const credential = await readIntegrationSecret<Record<string, string>>(organisationId, 'curaleaf');
    if (!credential.customerId || !credential.portalEmail || !credential.writeApiKey) {
      return { configured: true, connected: false, writeConfigured: false, status: 'credential_update_required' as const, environment: config.CURALEAF_BASE_URL.includes('.dev') ? 'test' : 'production', checkedAt: new Date().toISOString(), message: 'Enter this pharmacy’s Curaleaf API key to restore the connection.' };
    }
    const response = await curaleafRequest<Record<string, unknown>>(organisationId, '/v1/formulas/?pageSize=1');
    return { configured: true, connected: true, writeConfigured: true, status: 'connected' as const, environment: config.CURALEAF_BASE_URL.includes('.dev') ? 'test' : 'production', checkedAt: new Date().toISOString(), message: 'Curaleaf pharmacy access verified.', sampleAvailable: Boolean(response) };
  } catch (error) {
    const missingConfiguration = error instanceof HttpError && error.code === 'INTEGRATION_NOT_CONNECTED';
    return { configured: !missingConfiguration, connected: false, writeConfigured: false, status: missingConfiguration ? 'not_configured' as const : 'attention' as const, environment: config.CURALEAF_BASE_URL.includes('.dev') ? 'test' : 'production', checkedAt: new Date().toISOString(), message: error instanceof Error ? error.message : 'Connection check failed.' };
  }
}

export async function uploadCuraleafFile(organisationId: string, path: string, file: Buffer, contentType: string, filename: string) {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(file)], { type: contentType }), filename);
  return curaleafRequest<Record<string, unknown> | null>(organisationId, path, { method: 'POST', body: form });
}

export type ManualPrescriptionInput = {
  serialNumber: string;
  issueDate: string;
  prescriber: { pin: string; gmcNumber: number | null; gphcNumber: string | null; name: string; initials: string };
  items: Array<{ formulaId: string; unitsNeededCount: number; packId: string; quantity: number }>;
  customerReference: string;
  file: { bytes: Buffer; contentType: string; filename: string };
  quote: Record<string, unknown>;
};

export type CuraleafPrescriptionState = 'ACTIVE' | 'FULFILLED' | 'EXPIRED' | 'CANCELLED' | 'PENDING';
export type CuraleafPurchaseOrderState = 'CREATED' | 'PROCESSING' | 'FULLY_ALLOCATED' | 'CANCELLED';
const prescriptionStates = new Set<CuraleafPrescriptionState>(['ACTIVE', 'FULFILLED', 'EXPIRED', 'CANCELLED', 'PENDING']);
const purchaseOrderStates = new Set<CuraleafPurchaseOrderState>(['CREATED', 'PROCESSING', 'FULLY_ALLOCATED', 'CANCELLED']);

export type CuraleafPurchaseOrderRecord = {
  id: string;
  customerReference: string | null;
  state: CuraleafPurchaseOrderState;
  courier: 'DX' | 'POLAR_SPEED' | 'CURALEAF' | 'TRANSFER' | 'OTHER';
  items: Array<Record<string, unknown>>;
  [key: string]: unknown;
};

export type CuraleafShipmentRecord = {
  id: string;
  purchaseOrderId: string;
  purchaseOrderCustomerReference: string | null;
  createdAt: string;
  items: Array<Record<string, unknown>>;
  [key: string]: unknown;
};

async function prescriptionBySerial(organisationId: string, serialNumber: string) {
  const lookup = await curaleafRequest<{ prescription: Record<string, unknown> }>(organisationId, `/v1/prescriptions/${encodeURIComponent(serialNumber)}/`);
  const prescription = lookup.prescription;
  if (typeof prescription.id !== 'string' || typeof prescription.state !== 'string' || !prescriptionStates.has(prescription.state as CuraleafPrescriptionState)) {
    throw new CuraleafRequestError(502, 'Curaleaf returned an invalid prescription response.');
  }
  return prescription as Record<string, unknown> & { id: string; state: CuraleafPrescriptionState };
}

export async function prescriptionById(organisationId: string, prescriptionId: string) {
  const prescription = await curaleafRequest<Record<string, unknown>>(organisationId, `/v1/prescriptions/${encodeURIComponent(prescriptionId)}/`);
  if (
    typeof prescription.id !== 'string'
    || typeof prescription.serialNumber !== 'string'
    || typeof prescription.prescriberId !== 'string'
    || typeof prescription.prescriberName !== 'string'
    || typeof prescription.issueDate !== 'string'
    || typeof prescription.expiryDate !== 'string'
    || typeof prescription.state !== 'string'
    || !prescriptionStates.has(prescription.state as CuraleafPrescriptionState)
    || !Array.isArray(prescription.items)
  ) {
    throw new CuraleafRequestError(502, 'Curaleaf returned an invalid prescription detail response.');
  }
  return prescription as Record<string, unknown> & {
    id: string;
    serialNumber: string;
    prescriberId: string;
    prescriberName: string;
    issueDate: string;
    expiryDate: string;
    state: CuraleafPrescriptionState;
    items: Array<Record<string, unknown>>;
  };
}

export async function prescriberById(organisationId: string, prescriberId: string) {
  const prescriber = await curaleafRequest<Record<string, unknown>>(organisationId, `/v1/prescribers/${encodeURIComponent(prescriberId)}/`);
  if (
    typeof prescriber.id !== 'string'
    || typeof prescriber.pin !== 'string'
    || typeof prescriber.name !== 'string'
    || typeof prescriber.initials !== 'string'
  ) {
    throw new CuraleafRequestError(502, 'Curaleaf returned an invalid prescriber response.');
  }
  return prescriber as Record<string, unknown> & {
    id: string;
    pin: string;
    name: string;
    initials: string;
    gmcNumber: number | null;
    gphcNumber: string | null;
  };
}

function prescriptionPatientIdentity(prescription: Record<string, unknown>) {
  const nested = prescription.patient && typeof prescription.patient === 'object'
    ? prescription.patient as Record<string, unknown>
    : {};
  const firstName = [nested.firstName, prescription.patientFirstName].find(value => typeof value === 'string') as string | undefined;
  const surname = [nested.surname, nested.lastName, prescription.patientSurname, prescription.patientLastName].find(value => typeof value === 'string') as string | undefined;
  const combinedName = [nested.name, nested.fullName, prescription.patientName, prescription.patientFullName].find(value => typeof value === 'string') as string | undefined;
  const name = combinedName?.trim() || [firstName, surname].filter(Boolean).join(' ').trim();
  const dob = [
    nested.dob,
    nested.dateOfBirth,
    prescription.patientDob,
    prescription.patientDOB,
    prescription.patientDateOfBirth,
  ].find(value => typeof value === 'string') as string | undefined;
  return name && dob ? { name, dob } : null;
}

export async function scanClinicPrescription(
  organisationId: string,
  input: {
    prescriptionId?: string;
    file?: { bytes: Buffer; contentType: string; filename: string };
  },
) {
  let prescriptionId = input.prescriptionId;
  if (!prescriptionId) {
    if (!input.file) throw new HttpError(400, 'Attach the Curaleaf Clinic prescription before scanning.', 'PRESCRIPTION_FILE_REQUIRED');
    prescriptionId = await uploadClinicPrescriptionImage(organisationId, input.file);
  }
  const prescription = await prescriptionById(organisationId, prescriptionId);
  const prescriber = await prescriberById(organisationId, prescription.prescriberId);
  const items = prescription.items.map(item => {
    if (
      typeof item.formulaId !== 'string'
      || typeof item.formulaName !== 'string'
      || typeof item.unit !== 'string'
      || !Number.isInteger(item.unitsNeededCount)
      || Number(item.unitsNeededCount) <= 0
      || !Number.isInteger(item.unitsAssignedCount)
    ) {
      throw new CuraleafRequestError(502, 'Curaleaf returned an invalid prescription line.');
    }
    return {
      formulaId: item.formulaId,
      formulaName: item.formulaName,
      unit: item.unit,
      unitsNeededCount: Number(item.unitsNeededCount),
      unitsAssignedCount: Number(item.unitsAssignedCount),
    };
  });
  if (!items.length) throw new CuraleafRequestError(502, 'Curaleaf returned a prescription without medicine lines.');
  const patient = prescriptionPatientIdentity(prescription);
  return {
    prescription: {
      id: prescription.id,
      serialNumber: prescription.serialNumber,
      state: prescription.state,
      issueDate: prescription.issueDate,
      expiryDate: prescription.expiryDate,
      prescriberId: prescription.prescriberId,
      prescriberName: prescription.prescriberName,
      items,
      patient,
    },
    prescriber: {
      id: prescriber.id,
      pin: prescriber.pin,
      name: prescriber.name,
      initials: prescriber.initials,
      gmcNumber: typeof prescriber.gmcNumber === 'number' ? prescriber.gmcNumber : null,
      gphcNumber: typeof prescriber.gphcNumber === 'string' ? prescriber.gphcNumber : null,
    },
  };
}

export async function uploadClinicPrescriptionImage(
  organisationId: string,
  file: { bytes: Buffer; contentType: string; filename: string },
) {
  const upload = await uploadCuraleafFile(
    organisationId,
    '/v1/prescription-from-image/',
    file.bytes,
    file.contentType,
    file.filename,
  );
  const prescriptionId = upload && typeof upload.id === 'string' ? upload.id : undefined;
  if (!prescriptionId) {
    throw new CuraleafRequestError(502, 'Curaleaf did not return a prescription reference for this barcode image.', true);
  }
  return prescriptionId;
}

export async function findCuraleafPurchaseOrder(organisationId: string, customerReference: string) {
  const query = new URLSearchParams({ searchQuery: customerReference, pageNumber: '0', pageSize: '200' });
  const page = await curaleafRequest<{ purchaseOrders: CuraleafPurchaseOrderRecord[] }>(organisationId, `/v1/purchase-orders/?${query}`);
  if (!Array.isArray(page.purchaseOrders)) throw new CuraleafRequestError(502, 'Curaleaf returned an invalid purchase-order page.');
  const purchaseOrder = page.purchaseOrders.find(order => order.customerReference === customerReference) ?? null;
  if (purchaseOrder && (typeof purchaseOrder.id !== 'string' || !purchaseOrderStates.has(purchaseOrder.state))) {
    throw new CuraleafRequestError(502, 'Curaleaf returned an invalid purchase-order response.');
  }
  return purchaseOrder;
}

export async function findCuraleafShipments(organisationId: string, purchaseOrderId: string) {
  const query = new URLSearchParams({ purchaseOrderId, pageNumber: '0', pageSize: '200' });
  const page = await curaleafRequest<{ shipments: CuraleafShipmentRecord[] }>(organisationId, `/v1/shipments/?${query}`);
  if (!Array.isArray(page.shipments)) throw new CuraleafRequestError(502, 'Curaleaf returned an invalid shipment page.');
  const shipments = page.shipments.filter(shipment => shipment.purchaseOrderId === purchaseOrderId);
  if (shipments.some(shipment => typeof shipment.id !== 'string' || typeof shipment.createdAt !== 'string' || !Array.isArray(shipment.items))) {
    throw new CuraleafRequestError(502, 'Curaleaf returned an invalid shipment response.');
  }
  return shipments;
}

async function ensurePurchaseOrder(organisationId: string, customerReference: string, items: Array<{ packId: string; quantity: number }>) {
  const existing = await findCuraleafPurchaseOrder(organisationId, customerReference);
  if (existing) return existing;
  await curaleafRequest(organisationId, '/v1/purchase-orders/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ customerReference, items: items.map(({ packId, quantity }) => ({ productId: packId, count: quantity })) }),
  });
  // Curaleaf documents no response body for the POST. Re-read the collection
  // instead of guessing an ID or state; eventual consistency may yield null.
  return findCuraleafPurchaseOrder(organisationId, customerReference);
}

async function ensureClinicPurchaseOrder(organisationId: string, customerReference: string, prescriptionId: string) {
  const existing = await findCuraleafPurchaseOrder(organisationId, customerReference);
  if (existing) return existing;
  await curaleafRequest(organisationId, '/v1/purchase-order-from-prescriptions/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ customerReference, prescriptionIds: [prescriptionId] }),
  });
  return findCuraleafPurchaseOrder(organisationId, customerReference);
}

export async function submitManualPrescription(organisationId: string, input: ManualPrescriptionInput) {
  const query = new URLSearchParams({ searchQuery: input.prescriber.pin, pageSize: '20' });
  let prescribers = await curaleafRequest<{ prescribers: Array<Record<string, unknown>> }>(organisationId, `/v1/prescribers/?${query}`);
  let prescriber = prescribers.prescribers.find(item => item.pin === input.prescriber.pin || item.gphcNumber === input.prescriber.gphcNumber || item.gmcNumber === input.prescriber.gmcNumber);
  if (!prescriber) {
    await curaleafRequest(organisationId, '/v1/prescribers/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input.prescriber) });
    prescribers = await curaleafRequest(organisationId, `/v1/prescribers/?${query}`);
    prescriber = prescribers.prescribers.find(item => item.pin === input.prescriber.pin || item.gphcNumber === input.prescriber.gphcNumber || item.gmcNumber === input.prescriber.gmcNumber);
  }
  if (!prescriber || typeof prescriber.id !== 'string') throw new CuraleafRequestError(502, 'Curaleaf did not return the prescriber created for this prescription.', true);

  await curaleafRequest(organisationId, '/v1/prescriptions/', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ serialNumber: input.serialNumber, issueDate: input.issueDate, prescriberId: prescriber.id, items: input.items.map(({ formulaId, unitsNeededCount }) => ({ formulaId, unitsNeededCount })) }),
  });
  const prescription = await prescriptionBySerial(organisationId, input.serialNumber);
  await uploadCuraleafFile(organisationId, `/v1/prescriptions/${prescription.id}/file/`, input.file.bytes, input.file.contentType, input.file.filename);
  if (prescription.state !== 'ACTIVE') {
    return { status: 'prescription_pending' as const, prescriptionState: prescription.state, prescriptionId: prescription.id, prescriberId: prescriber.id, customerReference: input.customerReference, quote: input.quote };
  }
  const purchaseOrder = await ensurePurchaseOrder(organisationId, input.customerReference, input.items);
  return {
    status: 'purchase_order_submitted' as const,
    prescriptionState: prescription.state,
    prescriptionId: prescription.id,
    prescriberId: prescriber.id,
    customerReference: input.customerReference,
    purchaseOrderId: purchaseOrder?.id ?? null,
    purchaseOrderState: purchaseOrder?.state ?? null,
    quote: input.quote,
  };
}

export async function reconcileManualPrescription(
  organisationId: string,
  input: { serialNumber: string; customerReference: string; items: Array<{ packId: string; quantity: number }>; allowPurchaseOrderCreate?: boolean },
) {
  const [prescription, existingPurchaseOrder] = await Promise.all([
    prescriptionBySerial(organisationId, input.serialNumber),
    findCuraleafPurchaseOrder(organisationId, input.customerReference),
  ]);
  if (existingPurchaseOrder) {
    return {
      status: 'purchase_order_submitted' as const,
      prescriptionState: prescription.state,
      prescriptionId: prescription.id,
      purchaseOrderId: existingPurchaseOrder.id,
      purchaseOrderState: existingPurchaseOrder.state,
    };
  }
  if (prescription.state === 'PENDING') {
    return { status: 'prescription_pending' as const, prescriptionState: prescription.state, prescriptionId: prescription.id };
  }
  if (prescription.state === 'EXPIRED' || prescription.state === 'CANCELLED') {
    return { status: 'prescription_closed' as const, prescriptionState: prescription.state, prescriptionId: prescription.id };
  }
  if (prescription.state === 'FULFILLED') {
    return { status: 'reconciliation_required' as const, prescriptionState: prescription.state, prescriptionId: prescription.id };
  }
  if (input.allowPurchaseOrderCreate === false) {
    return { status: 'purchase_order_confirmation_pending' as const, prescriptionState: prescription.state, prescriptionId: prescription.id };
  }
  const purchaseOrder = await ensurePurchaseOrder(organisationId, input.customerReference, input.items);
  return {
    status: 'purchase_order_submitted' as const,
    prescriptionState: prescription.state,
    prescriptionId: prescription.id,
    purchaseOrderId: purchaseOrder?.id ?? null,
    purchaseOrderState: purchaseOrder?.state ?? null,
  };
}

type ClinicPrescriptionInput = {
  prescriptionId?: string;
  serialNumber: string;
  expectedPrescriberId?: string;
  expectedPrescriberPin?: string;
  expectedItems: Array<{ formulaId: string; unitsNeededCount: number }>;
  customerReference: string;
  quoteItems: Array<{ packId: string; quantity: number }>;
};

function formulaQuantities(items: Array<{ formulaId: string; unitsNeededCount: number }>) {
  const quantities = new Map<string, number>();
  items.forEach(item => quantities.set(item.formulaId, (quantities.get(item.formulaId) ?? 0) + item.unitsNeededCount));
  return quantities;
}

function exactFormulaQuantities(expected: Array<{ formulaId: string; unitsNeededCount: number }>, actual: Array<Record<string, unknown>>) {
  const actualItems = actual.flatMap(item =>
    typeof item.formulaId === 'string' && Number.isInteger(item.unitsNeededCount) && Number(item.unitsNeededCount) > 0
      ? [{ formulaId: item.formulaId, unitsNeededCount: Number(item.unitsNeededCount) }]
      : []
  );
  const left = formulaQuantities(expected);
  const right = formulaQuantities(actualItems);
  return actualItems.length === actual.length && left.size === right.size && [...left].every(([formulaId, quantity]) => right.get(formulaId) === quantity);
}

export async function reconcileClinicPrescription(
  organisationId: string,
  input: ClinicPrescriptionInput & { allowPurchaseOrderCreate?: boolean },
) {
  let prescription: Awaited<ReturnType<typeof prescriptionById>>;
  if (input.prescriptionId) {
    prescription = await prescriptionById(organisationId, input.prescriptionId);
  } else {
    let summary: Awaited<ReturnType<typeof prescriptionBySerial>>;
    try {
      summary = await prescriptionBySerial(organisationId, input.serialNumber);
    } catch (error) {
      if (error instanceof CuraleafRequestError && error.status === 404) {
        return { status: 'prescription_processing' as const };
      }
      throw error;
    }
    prescription = await prescriptionById(organisationId, summary.id);
  }
  const [prescriber, existingPurchaseOrder] = await Promise.all([
    prescriberById(organisationId, prescription.prescriberId),
    findCuraleafPurchaseOrder(organisationId, input.customerReference),
  ]);
  if (prescription.serialNumber !== input.serialNumber) {
    return { status: 'prescription_mismatch' as const, reason: 'SERIAL_NUMBER_MISMATCH', prescriptionId: prescription.id, prescriptionState: prescription.state };
  }
  if (
    (input.expectedPrescriberId && prescriber.id !== input.expectedPrescriberId)
    || (input.expectedPrescriberPin && prescriber.pin !== input.expectedPrescriberPin)
  ) {
    return { status: 'prescription_mismatch' as const, reason: 'PRESCRIBER_MISMATCH', prescriptionId: prescription.id, prescriptionState: prescription.state, prescriberId: prescriber.id, prescriberName: prescriber.name };
  }
  if (!exactFormulaQuantities(input.expectedItems, prescription.items)) {
    return { status: 'prescription_mismatch' as const, reason: 'PRESCRIPTION_ITEMS_MISMATCH', prescriptionId: prescription.id, prescriptionState: prescription.state, prescriberId: prescriber.id, prescriberName: prescriber.name };
  }
  if (existingPurchaseOrder) {
    return {
      status: 'purchase_order_submitted' as const,
      prescriptionId: prescription.id,
      prescriptionState: prescription.state,
      prescriberId: prescriber.id,
      prescriberName: prescriber.name,
      purchaseOrderId: existingPurchaseOrder.id,
      purchaseOrderState: existingPurchaseOrder.state,
    };
  }
  if (prescription.state === 'EXPIRED' || prescription.state === 'CANCELLED') {
    return { status: 'prescription_closed' as const, prescriptionId: prescription.id, prescriptionState: prescription.state, prescriberId: prescriber.id, prescriberName: prescriber.name };
  }
  if (prescription.state === 'FULFILLED') {
    return { status: 'reconciliation_required' as const, prescriptionId: prescription.id, prescriptionState: prescription.state, prescriberId: prescriber.id, prescriberName: prescriber.name };
  }
  if (input.allowPurchaseOrderCreate === false) {
    return { status: 'purchase_order_confirmation_pending' as const, prescriptionId: prescription.id, prescriptionState: prescription.state, prescriberId: prescriber.id, prescriberName: prescriber.name };
  }
  try {
    const purchaseOrder = await ensureClinicPurchaseOrder(organisationId, input.customerReference, prescription.id);
    return {
      status: 'purchase_order_submitted' as const,
      prescriptionId: prescription.id,
      prescriptionState: prescription.state,
      prescriberId: prescriber.id,
      prescriberName: prescriber.name,
      purchaseOrderId: purchaseOrder?.id ?? null,
      purchaseOrderState: purchaseOrder?.state ?? null,
    };
  } catch (error) {
    if (prescription.state === 'PENDING' && error instanceof CuraleafRequestError && [400, 409].includes(error.status)) {
      return { status: 'prescription_pending' as const, prescriptionId: prescription.id, prescriptionState: prescription.state, prescriberId: prescriber.id, prescriberName: prescriber.name };
    }
    throw error;
  }
}

export async function submitClinicPrescription(
  organisationId: string,
  input: ClinicPrescriptionInput & { file?: { bytes: Buffer; contentType: string; filename: string }; quote: Record<string, unknown> },
) {
  let prescriptionId = input.prescriptionId;
  if (!prescriptionId) {
    if (!input.file) throw new HttpError(400, 'Attach the Curaleaf Clinic prescription before submitting.', 'PRESCRIPTION_FILE_REQUIRED');
    const upload = await uploadCuraleafFile(organisationId, '/v1/prescription-from-image/', input.file.bytes, input.file.contentType, input.file.filename);
    prescriptionId = upload && typeof upload.id === 'string' ? upload.id : undefined;
  }
  const reconciliation = await reconcileClinicPrescription(organisationId, { ...input, prescriptionId, allowPurchaseOrderCreate: true });
  return { ...reconciliation, customerReference: input.customerReference, quote: input.quote };
}
