import { config } from './config.js';
import { HttpError } from './http.js';
import { readIntegrationSecret } from './secrets.js';

const REQUEST_TIMEOUT_MS = 12_000;

type CuraleafCredential = { customerId: string; portalEmail: string };
type CuraleafResult = Record<string, unknown> | unknown[] | null;

export class CuraleafRequestError extends HttpError {
  constructor(status: number, message: string, public readonly ambiguousWrite = false) {
    super(status, message, 'CURALEAF_REQUEST_FAILED');
    this.name = 'CuraleafRequestError';
  }
}

function customerIds(value: unknown): string[] {
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap(customerIds);
  const object = value as Record<string, unknown>;
  return [typeof object.customerId === 'string' ? object.customerId : null, ...Object.values(object).flatMap(customerIds)].filter((item): item is string => Boolean(item));
}

export async function curaleafRequest<T = CuraleafResult>(organisationId: string, path: string, init: RequestInit = {}): Promise<T> {
  const credential = await readIntegrationSecret<CuraleafCredential>(organisationId, 'curaleaf');
  if (!config.CURALEAF_API_KEY) throw new HttpError(503, 'The HHH Curaleaf API key is not configured.', 'PLATFORM_INTEGRATION_NOT_CONNECTED');
  const method = (init.method ?? 'GET').toUpperCase();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(new URL(path.replace(/^\//, ''), `${config.CURALEAF_BASE_URL}/`), {
      ...init,
      method,
      signal: controller.signal,
      headers: { Accept: 'application/json', 'X-API-Key': config.CURALEAF_API_KEY, ...init.headers },
    });
    const text = await response.text();
    const body = text ? JSON.parse(text) as T : null as T;
    if (!response.ok) throw new CuraleafRequestError(response.status, `Curaleaf rejected the request (${response.status}).`);
    const unexpectedCustomer = customerIds(body).find(id => id !== credential.customerId);
    if (unexpectedCustomer) throw new CuraleafRequestError(502, 'Curaleaf returned data for a different pharmacy customer.');
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

export async function curaleafConnectionStatus(organisationId: string) {
  try {
    const response = await curaleafRequest<Record<string, unknown>>(organisationId, '/v1/formulas/?pageSize=1');
    return { configured: true, connected: true, writeConfigured: true, environment: config.CURALEAF_BASE_URL.includes('.dev') ? 'test' : 'production', checkedAt: new Date().toISOString(), message: 'Curaleaf pharmacy access verified.', sampleAvailable: Boolean(response) };
  } catch (error) {
    return { configured: error instanceof HttpError && error.code !== 'INTEGRATION_NOT_CONNECTED', connected: false, writeConfigured: false, environment: config.CURALEAF_BASE_URL.includes('.dev') ? 'test' : 'production', checkedAt: new Date().toISOString(), message: error instanceof Error ? error.message : 'Connection check failed.' };
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
};

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
  const lookup = await curaleafRequest<{ prescription: Record<string, unknown> }>(organisationId, `/v1/prescriptions/${encodeURIComponent(input.serialNumber)}/`);
  const prescription = lookup.prescription;
  if (typeof prescription.id !== 'string') throw new CuraleafRequestError(502, 'Curaleaf created the prescription but did not return its identifier.', true);
  await uploadCuraleafFile(organisationId, `/v1/prescriptions/${prescription.id}/file/`, input.file.bytes, input.file.contentType, input.file.filename);
  const quote = await curaleafRequest<Record<string, unknown>>(organisationId, '/v1/quotes/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: input.items.map(({ packId, quantity }) => ({ packId, quantity })) }) });
  await curaleafRequest(organisationId, '/v1/purchase-order-from-prescriptions/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customerReference: input.customerReference, prescriptionIds: [prescription.id] }) });
  return { prescriptionId: prescription.id, prescriberId: prescriber.id, customerReference: input.customerReference, quote };
}

export async function submitBarcodePrescription(organisationId: string, input: { customerReference: string; file: { bytes: Buffer; contentType: string; filename: string }; quoteItems: Array<{ packId: string; quantity: number }> }) {
  const prescription = await uploadCuraleafFile(organisationId, '/v1/prescription-from-image/', input.file.bytes, input.file.contentType, input.file.filename);
  // Curaleaf's OpenAPI specification documents no response contract for this
  // endpoint. Only continue automatically when the live response supplies an
  // explicit ID; otherwise require reconciliation rather than guessing.
  if (!prescription || typeof prescription.id !== 'string') return { status: 'reconciliation_required' as const, customerReference: input.customerReference };
  const quote = await curaleafRequest<Record<string, unknown>>(organisationId, '/v1/quotes/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: input.quoteItems }) });
  await curaleafRequest(organisationId, '/v1/purchase-order-from-prescriptions/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customerReference: input.customerReference, prescriptionIds: [prescription.id] }) });
  return { status: 'submitted' as const, prescriptionId: prescription.id, customerReference: input.customerReference, quote };
}
