import { config } from './config.js';
import { firestore } from './firebase.js';
import { HttpError } from './http.js';
import { readIntegrationSecret, readPlatformSecret } from './secrets.js';

const REQUEST_TIMEOUT_MS = 12_000;
/** Soft limit from Curaleaf (Phil, 5 Aug 2026): ~1 request/second per pharmacy key. */
export const TENANT_REQUEST_SPACING_MS = 1000;



export type CuraleafCredential = {
  customerId: string;
  writeApiKey: string;
  readApiKey?: string;
  /** Legacy field; no longer required for connection or validation. */
  portalEmail?: string;
};

export type CuraleafValidationCheck = {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
};

export type CuraleafValidationReport = {
  passed: boolean;
  checkedAt: string;
  observedCustomerId: string | null;
  productSampleCount: number;
  checks: CuraleafValidationCheck[];
  message: string;
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
  if (!credential.customerId || !credential.writeApiKey) {
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

function environmentLabel() {
  return config.CURALEAF_BASE_URL.includes('.dev') ? 'test' as const : 'production' as const;
}

/** Run API + customer-match checks against stored (or just-written) pharmacy credentials. */
export async function validateCuraleafCredentials(organisationId: string): Promise<CuraleafValidationReport> {
  const checkedAt = new Date().toISOString();
  const checks: CuraleafValidationCheck[] = [];
  let observedCustomerId: string | null = null;
  let productSampleCount = 0;

  let credential: Record<string, string>;
  try {
    credential = await readIntegrationSecret<Record<string, string>>(organisationId, 'curaleaf');
  } catch {
    return {
      passed: false,
      checkedAt,
      observedCustomerId: null,
      productSampleCount: 0,
      checks: [{ id: 'credentials', label: 'Credentials present', passed: false, detail: 'No Curaleaf credentials are stored for this pharmacy.' }],
      message: 'Store Curaleaf credentials before running validation.',
    };
  }

  const expectedCustomerId = typeof credential.customerId === 'string' ? credential.customerId.trim() : '';
  const writeApiKey = typeof credential.writeApiKey === 'string' ? credential.writeApiKey.trim() : '';
  if (!expectedCustomerId || !writeApiKey) {
    return {
      passed: false,
      checkedAt,
      observedCustomerId: null,
      productSampleCount: 0,
      checks: [{ id: 'credentials', label: 'Credentials present', passed: false, detail: 'Customer ID and write API key are both required.' }],
      message: 'Enter the pharmacy PHAR / customer ID and API key.',
    };
  }

  try {
    await reserveTenantRequestSlot(organisationId);
    const productsPage = await curaleafFetch<{ products?: unknown[]; totalRecordCount?: number }>(
      '/v1/products/?pageNumber=0&pageSize=25',
      {},
      writeApiKey,
      organisationId,
    );
    const products = Array.isArray(productsPage.products) ? productsPage.products : null;
    if (!products) {
      checks.push({ id: 'api_key', label: 'API key accepted', passed: false, detail: 'Curaleaf returned an invalid products response.' });
    } else {
      productSampleCount = products.length;
      checks.push({
        id: 'api_key',
        label: 'API key accepted',
        passed: true,
        detail: `Products endpoint returned ${productSampleCount} sample product${productSampleCount === 1 ? '' : 's'}.`,
      });
      const observedIds = [...new Set(products.flatMap(product => customerIds(product)))];
      observedCustomerId = observedIds[0] ?? null;
      if (productSampleCount === 0) {
        checks.push({
          id: 'customer_match',
          label: 'Customer / PHAR match',
          passed: false,
          detail: 'Product catalogue was empty, so the customer ID could not be confirmed against Curaleaf data.',
        });
      } else if (!observedCustomerId) {
        checks.push({
          id: 'customer_match',
          label: 'Customer / PHAR match',
          passed: false,
          detail: 'Products were returned without a customerId field to verify.',
        });
      } else if (observedIds.some(id => id !== expectedCustomerId)) {
        checks.push({
          id: 'customer_match',
          label: 'Customer / PHAR match',
          passed: false,
          detail: `Curaleaf returned customer ${observedIds.find(id => id !== expectedCustomerId)} but the form has ${expectedCustomerId}.`,
        });
      } else {
        checks.push({
          id: 'customer_match',
          label: 'Customer / PHAR match',
          passed: true,
          detail: `All sampled products belong to customer ${observedCustomerId}.`,
        });
      }
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Products request failed.';
    checks.push({ id: 'api_key', label: 'API key accepted', passed: false, detail });
    checks.push({ id: 'customer_match', label: 'Customer / PHAR match', passed: false, detail: 'Skipped because the products request failed.' });
  }

  try {
    await reserveTenantRequestSlot(organisationId);
    await curaleafFetch('/v1/formulas/?pageNumber=0&pageSize=1', {}, writeApiKey, organisationId);
    checks.push({ id: 'formulas', label: 'Formulas connectivity', passed: true, detail: 'Formulas endpoint responded successfully.' });
  } catch (error) {
    checks.push({
      id: 'formulas',
      label: 'Formulas connectivity',
      passed: false,
      detail: error instanceof Error ? error.message : 'Formulas request failed.',
    });
  }

  const passed = checks.length > 0 && checks.every(check => check.passed);
  return {
    passed,
    checkedAt,
    observedCustomerId,
    productSampleCount,
    checks,
    message: passed
      ? 'All Curaleaf validation checks passed. Approve the connection to complete setup.'
      : 'One or more Curaleaf validation checks failed. Review the results before approving.',
  };
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
  const environment = environmentLabel();
  const connectionSnapshot = await firestore.collection('integrationConnections').doc(`${organisationId}--curaleaf`).get();
  const connection = connectionSnapshot.data();
  const storedValidation = connection?.lastValidation && typeof connection.lastValidation === 'object'
    ? connection.lastValidation as CuraleafValidationReport
    : undefined;
  const connectionStatus = typeof connection?.status === 'string' ? connection.status : null;
  const approved = connectionStatus === 'connected';

  try {
    const credential = await readIntegrationSecret<Record<string, string>>(organisationId, 'curaleaf');
    if (!credential.customerId || !credential.writeApiKey) {
      return {
        configured: true,
        connected: false,
        writeConfigured: false,
        approved: false,
        status: 'credential_update_required' as const,
        environment,
        checkedAt: new Date().toISOString(),
        message: 'Enter this pharmacy’s Curaleaf API key to restore the connection.',
        validation: storedValidation,
        maskedIdentifier: typeof connection?.maskedIdentifier === 'string' ? connection.maskedIdentifier : undefined,
      };
    }

    if (approved) {
      const response = await curaleafRequest<Record<string, unknown>>(organisationId, '/v1/formulas/?pageSize=1');
      return {
        configured: true,
        connected: true,
        writeConfigured: true,
        approved: true,
        status: 'connected' as const,
        environment,
        checkedAt: new Date().toISOString(),
        message: 'Curaleaf pharmacy access verified and approved.',
        sampleAvailable: Boolean(response),
        validation: storedValidation,
        maskedIdentifier: typeof connection?.maskedIdentifier === 'string' ? connection.maskedIdentifier : undefined,
      };
    }

    if (connectionStatus === 'validated' && storedValidation?.passed) {
      return {
        configured: true,
        connected: false,
        writeConfigured: true,
        approved: false,
        status: 'validated' as const,
        environment,
        checkedAt: storedValidation.checkedAt ?? new Date().toISOString(),
        message: 'Validation passed — approve Curaleaf to complete this setup step.',
        validation: storedValidation,
        maskedIdentifier: typeof connection?.maskedIdentifier === 'string' ? connection.maskedIdentifier : undefined,
      };
    }

    return {
      configured: true,
      connected: false,
      writeConfigured: true,
      approved: false,
      status: (connectionStatus === 'attention' ? 'attention' : 'validated') as 'attention' | 'validated',
      environment,
      checkedAt: storedValidation?.checkedAt ?? new Date().toISOString(),
      message: storedValidation?.message ?? 'Credentials are stored. Run Test & save, then approve after checks pass.',
      validation: storedValidation,
      maskedIdentifier: typeof connection?.maskedIdentifier === 'string' ? connection.maskedIdentifier : undefined,
    };
  } catch (error) {
    const missingConfiguration = error instanceof HttpError && error.code === 'INTEGRATION_NOT_CONNECTED';
    return {
      configured: !missingConfiguration,
      connected: false,
      writeConfigured: false,
      approved: false,
      status: missingConfiguration ? 'not_configured' as const : 'attention' as const,
      environment,
      checkedAt: new Date().toISOString(),
      message: error instanceof Error ? error.message : 'Connection check failed.',
      validation: storedValidation,
      maskedIdentifier: typeof connection?.maskedIdentifier === 'string' ? connection.maskedIdentifier : undefined,
    };
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

export function clinicPrescriptionReadyForPurchaseOrder(state: CuraleafPrescriptionState) {
  return state === 'ACTIVE';
}
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

type CuraleafProductFormulaRecord = {
  id?: unknown;
  formulaId?: unknown;
  formulaName?: unknown;
  formulaUnit?: unknown;
  state?: unknown;
};

export type PrescriptionFormulaMatch = {
  matches: boolean;
  mode: 'exact' | 'retired_supplier_alias' | 'none';
  aliases: Array<{ expectedFormulaId: string; supplierFormulaId: string }>;
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
  // Read the complete supplier history rather than relying on searchQuery.
  // Curaleaf retains CANCELLED purchase orders and they can fall outside the
  // first page or a provider-side default search filter.
  const page = await curaleafList<CuraleafPurchaseOrderRecord>(organisationId, '/v1/purchase-orders/', 'purchaseOrders');
  const matches = page.records.filter(order => order.customerReference === customerReference);
  if (matches.some(order => typeof order.id !== 'string' || !purchaseOrderStates.has(order.state))) {
    throw new CuraleafRequestError(502, 'Curaleaf returned an invalid purchase-order response.');
  }
  if (matches.length > 1) {
    throw new CuraleafRequestError(502, 'Curaleaf returned multiple purchase orders for the same customer reference.');
  }
  return matches[0] ?? null;
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

async function ensureClinicPurchaseOrder(organisationId: string, customerReference: string, prescriptionId: string) {
  const existing = await findCuraleafPurchaseOrder(organisationId, customerReference);
  if (existing) return { purchaseOrder: existing, created: false };
  await curaleafRequest(organisationId, '/v1/purchase-order-from-prescriptions/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ customerReference, prescriptionIds: [prescriptionId] }),
  });
  return { purchaseOrder: await findCuraleafPurchaseOrder(organisationId, customerReference), created: true };
}

export function prescriptionLinkedPurchaseOrderPayload(customerReference: string, prescriptionId: string) {
  return {
    customerReference,
    prescriptionIds: [prescriptionId],
  };
}

export function manualPurchaseOrderPayload(
  customerReference: string,
  items: Array<{ packId: string; quantity: number }>,
) {
  return {
    customerReference,
    items: items.map(item => ({ productId: item.packId, count: item.quantity })),
  };
}

export async function submitManualPrescription(organisationId: string, input: ManualPrescriptionInput) {
  const registered = await registerManualPrescription(organisationId, input);
  if (registered.prescriptionState !== 'ACTIVE') {
    return { status: 'prescription_pending' as const, ...registered, customerReference: input.customerReference, quote: input.quote };
  }
  if (!await configuredCuraleafPrescriberExists(organisationId, registered.prescriberId)) {
    throw new HttpError(409, 'The prescriber must be configured and verified before a Curaleaf purchase order can be sent.', 'PRESCRIBER_NOT_CONFIGURED');
  }
  const placement = await ensureClinicPurchaseOrder(organisationId, input.customerReference, registered.prescriptionId);
  if (!placement.purchaseOrder) {
    return {
      status: 'purchase_order_confirmation_pending' as const,
      ...registered,
      customerReference: input.customerReference,
      purchaseOrderId: null,
      purchaseOrderState: null,
      placementRequest: {
        endpoint: '/v1/purchase-order-from-prescriptions/',
        disposition: placement.created ? 'sent' as const : 'existing_not_replayed' as const,
        prescriptionIds: placement.created ? [registered.prescriptionId] : null,
        items: null,
      },
      quote: input.quote,
    };
  }
  return {
    status: 'purchase_order_submitted' as const,
    ...registered,
    customerReference: input.customerReference,
    purchaseOrderId: placement.purchaseOrder?.id ?? null,
    purchaseOrderState: placement.purchaseOrder?.state ?? null,
    placementRequest: {
      endpoint: '/v1/purchase-order-from-prescriptions/',
      disposition: placement.created ? 'sent' : 'existing_not_replayed',
      prescriptionIds: [registered.prescriptionId],
      items: null,
    },
    quote: input.quote,
  };
}

type PrescriberIdentity = {
  pin: string;
  gmcNumber: number | null;
  gphcNumber: string | null;
  name: string;
};

function normalIdentity(value: unknown) {
  return String(value ?? '').trim().toLocaleLowerCase('en-GB');
}

export function prescriberDirectoryMatch(record: Record<string, unknown>, input: PrescriberIdentity) {
  if (record.active !== true || normalIdentity(record.name) !== normalIdentity(input.name)) return false;
  return normalIdentity(record.pin) === normalIdentity(input.pin)
    || Boolean(input.gphcNumber && normalIdentity(record.gphcNumber) === normalIdentity(input.gphcNumber))
    || Boolean(input.gmcNumber && Number(record.gmcNumber) === input.gmcNumber);
}

async function configuredPrescriberDocument(input: PrescriberIdentity) {
  const directory = await firestore.collection('prescriberDirectory').where('active', '==', true).limit(500).get();
  return directory.docs.find(document => prescriberDirectoryMatch(document.data(), input)) ?? null;
}

async function configuredCuraleafPrescriberExists(organisationId: string, prescriberId: string) {
  const directory = await firestore.collection('prescriberDirectory').where('active', '==', true).limit(500).get();
  return directory.docs.some(document => {
    const ids = document.data().curaleafIds;
    return ids && typeof ids === 'object' && (ids as Record<string, unknown>)[organisationId] === prescriberId;
  });
}

/** Registers a manual prescription and its prescriber without creating stock. */
export async function registerManualPrescription(
  organisationId: string,
  input: Pick<ManualPrescriptionInput, 'serialNumber' | 'issueDate' | 'prescriber' | 'items' | 'file'>,
) {
  const configuredPrescriber = await configuredPrescriberDocument(input.prescriber);
  if (!configuredPrescriber) {
    throw new HttpError(409, 'Add and select this prescriber from the active prescriber directory before submitting the prescription.', 'PRESCRIBER_NOT_CONFIGURED');
  }
  const matchesPrescriber = (item: Record<string, unknown>) => item.pin === input.prescriber.pin
    || Boolean(input.prescriber.gphcNumber && item.gphcNumber === input.prescriber.gphcNumber)
    || Boolean(input.prescriber.gmcNumber && item.gmcNumber === input.prescriber.gmcNumber);
  const query = new URLSearchParams({ searchQuery: input.prescriber.pin, pageSize: '20' });
  let prescribers = await curaleafRequest<{ prescribers: Array<Record<string, unknown>> }>(organisationId, `/v1/prescribers/?${query}`);
  let prescriber = prescribers.prescribers.find(matchesPrescriber);
  if (!prescriber) {
    await curaleafRequest(organisationId, '/v1/prescribers/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input.prescriber) });
    prescribers = await curaleafRequest(organisationId, `/v1/prescribers/?${query}`);
    prescriber = prescribers.prescribers.find(matchesPrescriber);
  }
  if (!prescriber || typeof prescriber.id !== 'string') throw new CuraleafRequestError(502, 'Curaleaf did not return the prescriber created for this prescription.', true);
  const existingIds = configuredPrescriber.data().curaleafIds && typeof configuredPrescriber.data().curaleafIds === 'object'
    ? configuredPrescriber.data().curaleafIds as Record<string, string>
    : {};
  await configuredPrescriber.ref.set({
    curaleafIds: { ...existingIds, [organisationId]: prescriber.id },
    updatedAt: new Date().toISOString(),
  }, { merge: true });

  let prescription: Awaited<ReturnType<typeof prescriptionBySerial>>;
  try {
    prescription = await prescriptionBySerial(organisationId, input.serialNumber);
  } catch (error) {
    if (!(error instanceof CuraleafRequestError) || error.status !== 404) throw error;
    await curaleafRequest(organisationId, '/v1/prescriptions/', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serialNumber: input.serialNumber, issueDate: input.issueDate, prescriberId: prescriber.id, items: input.items.map(({ formulaId, unitsNeededCount }) => ({ formulaId, unitsNeededCount })) }),
    });
    prescription = await prescriptionBySerial(organisationId, input.serialNumber);
  }
  const prescriptionDetails = await prescriptionById(organisationId, prescription.id);
  let formulaMatch = prescriptionFormulaMatch(input.items, prescriptionDetails.items);
  if (prescriptionDetails.prescriberId === prescriber.id && !formulaMatch.matches) {
    const productPage = await curaleafList<CuraleafProductFormulaRecord>(organisationId, '/v1/products/', 'products');
    formulaMatch = prescriptionFormulaMatch(input.items, prescriptionDetails.items, productPage.records);
  }
  if (prescriptionDetails.prescriberId !== prescriber.id || !formulaMatch.matches) {
    throw new HttpError(409, 'The existing Curaleaf prescription does not match the saved prescriber and medicine lines.', 'PRESCRIPTION_MISMATCH');
  }
  await uploadCuraleafFile(organisationId, `/v1/prescriptions/${prescription.id}/file/`, input.file.bytes, input.file.contentType, input.file.filename);
  return {
    prescriptionState: prescriptionDetails.state,
    prescriptionId: prescriptionDetails.id,
    prescriberId: prescriber.id,
    formulaMatchMode: formulaMatch.mode,
    formulaAliases: formulaMatch.aliases,
  };
}

export async function reconcileManualPrescription(
  organisationId: string,
  input: { serialNumber: string; customerReference: string; items: Array<{ packId: string; quantity: number }>; expectedPrescriberId?: string; allowPurchaseOrderCreate?: boolean },
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
      placementRequest: {
        endpoint: '/v1/purchase-order-from-prescriptions/',
        disposition: 'existing_not_replayed' as const,
        prescriptionIds: null,
        items: null,
      },
    };
  }
  const prescriptionDetails = await prescriptionById(organisationId, prescription.id);
  const prescriber = await prescriberById(organisationId, prescriptionDetails.prescriberId);
  if (!input.expectedPrescriberId || prescriptionDetails.prescriberId !== input.expectedPrescriberId) {
    return { status: 'prescription_mismatch' as const, reason: 'PRESCRIBER_MISMATCH', prescriptionState: prescription.state, prescriptionId: prescription.id, prescriberId: prescriber.id, prescriberName: prescriber.name };
  }
  if (!await configuredCuraleafPrescriberExists(organisationId, input.expectedPrescriberId)) {
    return { status: 'prescription_mismatch' as const, reason: 'PRESCRIBER_NOT_CONFIGURED', prescriptionState: prescription.state, prescriptionId: prescription.id, prescriberId: prescriber.id, prescriberName: prescriber.name };
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
  const placement = await ensureClinicPurchaseOrder(organisationId, input.customerReference, prescription.id);
  if (!placement.purchaseOrder) {
    return { status: 'purchase_order_confirmation_pending' as const, prescriptionState: prescription.state, prescriptionId: prescription.id, prescriberId: prescriber.id, prescriberName: prescriber.name };
  }
  return {
    status: 'purchase_order_submitted' as const,
    prescriptionState: prescription.state,
    prescriptionId: prescription.id,
    purchaseOrderId: placement.purchaseOrder?.id ?? null,
    purchaseOrderState: placement.purchaseOrder?.state ?? null,
    placementRequest: {
      endpoint: '/v1/purchase-order-from-prescriptions/',
      disposition: placement.created ? 'sent' as const : 'existing_not_replayed' as const,
      prescriptionIds: placement.created ? [prescription.id] : null,
      items: null,
    },
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

function medicineIdentity(name: unknown, unit: unknown) {
  if (typeof name !== 'string' || typeof unit !== 'string') return null;
  const normalisedName = name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-GB');
  const normalisedUnit = unit.trim().toLocaleLowerCase('en-GB');
  return normalisedName && normalisedUnit ? `${normalisedName}\u0000${normalisedUnit}` : null;
}

/**
 * Curaleaf can retain an old formula id on an existing prescription after the
 * same medicine has been re-keyed in the active product catalogue. Accept that
 * narrow case only when pack linkage, medicine name, unit and prescribed
 * quantity all still agree, and the supplier id is no longer used by an active
 * product. A live id for a different formula remains a hard mismatch.
 */
export function prescriptionFormulaMatch(
  expected: Array<{ formulaId: string; unitsNeededCount: number; packId?: string }>,
  actual: Array<Record<string, unknown>>,
  products: CuraleafProductFormulaRecord[] = [],
): PrescriptionFormulaMatch {
  if (exactFormulaQuantities(expected, actual)) return { matches: true, mode: 'exact', aliases: [] };
  if (!expected.length || !products.length || expected.some(item => !item.packId)) return { matches: false, mode: 'none', aliases: [] };

  const activeProducts = products.filter(product => product.state === 'ACTIVE');
  const productById = new Map(activeProducts.flatMap(product => typeof product.id === 'string' ? [[product.id, product] as const] : []));
  const activeFormulaIds = new Set(activeProducts.flatMap(product => typeof product.formulaId === 'string' ? [product.formulaId] : []));
  const expectedByIdentity = new Map<string, { quantity: number; formulaIds: Set<string> }>();

  for (const item of expected) {
    const product = productById.get(item.packId!);
    if (!product || product.formulaId !== item.formulaId) return { matches: false, mode: 'none', aliases: [] };
    const identity = medicineIdentity(product.formulaName, product.formulaUnit);
    if (!identity || !Number.isInteger(item.unitsNeededCount) || item.unitsNeededCount <= 0) return { matches: false, mode: 'none', aliases: [] };
    const aggregate = expectedByIdentity.get(identity) ?? { quantity: 0, formulaIds: new Set<string>() };
    aggregate.quantity += item.unitsNeededCount;
    aggregate.formulaIds.add(item.formulaId);
    expectedByIdentity.set(identity, aggregate);
  }

  const actualByIdentity = new Map<string, { quantity: number; formulaIds: Set<string> }>();
  for (const item of actual) {
    const identity = medicineIdentity(item.formulaName, item.unit);
    if (!identity || typeof item.formulaId !== 'string' || !Number.isInteger(item.unitsNeededCount) || Number(item.unitsNeededCount) <= 0) {
      return { matches: false, mode: 'none', aliases: [] };
    }
    const aggregate = actualByIdentity.get(identity) ?? { quantity: 0, formulaIds: new Set<string>() };
    aggregate.quantity += Number(item.unitsNeededCount);
    aggregate.formulaIds.add(item.formulaId);
    actualByIdentity.set(identity, aggregate);
  }

  if (expectedByIdentity.size !== actualByIdentity.size) return { matches: false, mode: 'none', aliases: [] };
  const aliases: PrescriptionFormulaMatch['aliases'] = [];
  for (const [identity, expectedItem] of expectedByIdentity) {
    const actualItem = actualByIdentity.get(identity);
    if (!actualItem || expectedItem.quantity !== actualItem.quantity || expectedItem.formulaIds.size !== 1 || actualItem.formulaIds.size !== 1) {
      return { matches: false, mode: 'none', aliases: [] };
    }
    const expectedFormulaId = [...expectedItem.formulaIds][0]!;
    const supplierFormulaId = [...actualItem.formulaIds][0]!;
    if (expectedFormulaId === supplierFormulaId) continue;
    if (activeFormulaIds.has(supplierFormulaId)) return { matches: false, mode: 'none', aliases: [] };
    aliases.push({ expectedFormulaId, supplierFormulaId });
  }
  return aliases.length
    ? { matches: true, mode: 'retired_supplier_alias', aliases }
    : { matches: false, mode: 'none', aliases: [] };
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
  // A Clinic barcode can be uploaded and matched before Curaleaf has activated
  // the prescription. Do not probe the purchase-order endpoint while either
  // supplier approval gate is still outstanding; the reconciler will retry
  // after the prescription becomes ACTIVE.
  if (!clinicPrescriptionReadyForPurchaseOrder(prescription.state)) {
    return { status: 'prescription_pending' as const, prescriptionId: prescription.id, prescriptionState: prescription.state, prescriberId: prescriber.id, prescriberName: prescriber.name };
  }
  if (input.allowPurchaseOrderCreate === false) {
    return { status: 'purchase_order_confirmation_pending' as const, prescriptionId: prescription.id, prescriptionState: prescription.state, prescriberId: prescriber.id, prescriberName: prescriber.name };
  }
  const placement = await ensureClinicPurchaseOrder(organisationId, input.customerReference, prescription.id);
  if (!placement.purchaseOrder) {
    return {
      status: 'purchase_order_confirmation_pending' as const,
      prescriptionId: prescription.id,
      prescriptionState: prescription.state,
      prescriberId: prescriber.id,
      prescriberName: prescriber.name,
    };
  }
  return {
    status: 'purchase_order_submitted' as const,
    prescriptionId: prescription.id,
    prescriptionState: prescription.state,
    prescriberId: prescriber.id,
    prescriberName: prescriber.name,
    purchaseOrderId: placement.purchaseOrder?.id ?? null,
    purchaseOrderState: placement.purchaseOrder?.state ?? null,
    placementRequest: {
      endpoint: '/v1/purchase-order-from-prescriptions/',
      disposition: placement.created ? 'sent' as const : 'existing_not_replayed' as const,
      prescriptionIds: placement.created ? [prescription.id] : null,
      items: null,
    },
  };
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
