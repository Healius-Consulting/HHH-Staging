import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { config } from '../../bootstrap/config.js';
import { HttpError } from '../../domain/common/errors.js';
import type { IntegrationConnectionRecord } from '../../repositories/ports/integration.port.js';

const secretClient = new SecretManagerServiceClient();
const REQUEST_TIMEOUT_MS = 12_000;
const PAGE_SIZE = 200;
const MAX_PAGES = 5;

type CuraleafCredential = { customerId: string; writeApiKey: string; readApiKey?: string };

function allowedSecretResource(name: string) {
  return name.startsWith(`projects/${config.FIREBASE_PROJECT_ID}/secrets/hhh-curaleaf-`)
    && name.endsWith('-europe-west2');
}

async function credentialFor(connection: IntegrationConnectionRecord): Promise<CuraleafCredential> {
  const resource = connection.secretResourceName;
  if (!resource || !allowedSecretResource(resource)) {
    throw new HttpError(503, 'Curaleaf is not securely linked for this pharmacy.', 'INTEGRATION_NOT_CONNECTED');
  }
  try {
    const [version] = await secretClient.accessSecretVersion({ name: `${resource}/versions/latest` });
    const raw = version.payload?.data?.toString('utf8');
    const parsed = raw ? JSON.parse(raw) as Partial<CuraleafCredential> : null;
    if (!parsed?.customerId || !parsed.writeApiKey) throw new Error('Credential payload is incomplete.');
    return {
      customerId: parsed.customerId,
      writeApiKey: parsed.writeApiKey,
      ...(parsed.readApiKey ? { readApiKey: parsed.readApiKey } : {}),
    };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(503, 'Curaleaf credentials could not be accessed securely.', 'INTEGRATION_NOT_CONNECTED');
  }
}

function customerIds(value: unknown): string[] {
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap(customerIds);
  const object = value as Record<string, unknown>;
  return [
    typeof object.customerId === 'string' ? object.customerId : null,
    ...Object.values(object).flatMap(customerIds),
  ].filter((item): item is string => Boolean(item));
}

async function requestPage(path: string, apiKey: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(new URL(path.replace(/^\//, ''), `${config.CURALEAF_BASE_URL}/`), {
      method: 'GET', signal: controller.signal,
      headers: { Accept: 'application/json', 'X-API-Key': apiKey },
    });
    if (!response.ok) {
      throw new HttpError(response.status === 429 ? 429 : 502, 'Curaleaf could not provide the catalogue.', 'CURALEAF_REQUEST_FAILED');
    }
    try {
      return await response.json() as Record<string, unknown>;
    } catch {
      throw new HttpError(502, 'Curaleaf returned an invalid catalogue response.', 'CURALEAF_REQUEST_FAILED');
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new HttpError(504, 'Curaleaf catalogue request timed out.', 'CURALEAF_TIMEOUT');
    }
    throw new HttpError(502, 'Curaleaf could not be reached.', 'CURALEAF_UNAVAILABLE');
  } finally {
    clearTimeout(timeout);
  }
}

async function listAll(path: string, collectionKey: string, credential: CuraleafCredential) {
  const records: unknown[] = [];
  let totalRecordCount = Number.POSITIVE_INFINITY;
  for (let pageNumber = 0; pageNumber < MAX_PAGES && records.length < totalRecordCount; pageNumber += 1) {
    if (pageNumber > 0) await new Promise(resolve => setTimeout(resolve, 1_050));
    const query = new URLSearchParams({ pageNumber: String(pageNumber), pageSize: String(PAGE_SIZE) });
    const page = await requestPage(`${path}?${query}`, credential.readApiKey || credential.writeApiKey);
    const items = page[collectionKey];
    if (!Array.isArray(items)) {
      throw new HttpError(502, 'Curaleaf returned an invalid catalogue page.', 'CURALEAF_REQUEST_FAILED');
    }
    const unexpectedCustomer = customerIds(items).find(customerId => customerId !== credential.customerId);
    if (unexpectedCustomer) {
      throw new HttpError(502, 'Curaleaf returned data for a different pharmacy.', 'CURALEAF_TENANT_MISMATCH');
    }
    records.push(...items);
    totalRecordCount = Number(page.totalRecordCount ?? records.length);
    if (items.length === 0) break;
  }
  return { records, totalRecordCount: Number.isFinite(totalRecordCount) ? totalRecordCount : records.length };
}

export async function fetchCuraleafCatalogue(connection: IntegrationConnectionRecord) {
  const credential = await credentialFor(connection);
  const formulas = await listAll('/v1/formulas/', 'formulas', credential);
  await new Promise(resolve => setTimeout(resolve, 1_050));
  const products = await listAll('/v1/products/', 'products', credential);
  return {
    environment: config.CURALEAF_BASE_URL.includes('.dev') ? 'test' as const : 'production' as const,
    fetchedAt: new Date().toISOString(),
    formulas: formulas.records,
    products: products.records,
    formulaTotal: formulas.totalRecordCount,
    productTotal: products.totalRecordCount,
  };
}

export async function fetchCuraleafPurchaseOrders(connection: IntegrationConnectionRecord) {
  try {
    const data = await curaleafApiRequest<{ purchaseOrders: any[]; totalRecordCount: number }>(
      connection,
      '/v1/purchase-orders/?pageNumber=0&pageSize=200'
    );
    return data.purchaseOrders || [];
  } catch (error) {
    console.warn('Failed to fetch Curaleaf purchase orders:', error);
    return [];
  }
}

export async function fetchCuraleafShipments(connection: IntegrationConnectionRecord) {
  try {
    const data = await curaleafApiRequest<{ shipments: any[]; totalRecordCount?: number }>(
      connection,
      '/v1/shipments/?pageNumber=0&pageSize=200'
    );
    return data.shipments || [];
  } catch (error) {
    console.warn('Failed to fetch Curaleaf shipments:', error);
    return [];
  }
}

export async function curaleafApiRequest<T = any>(
  connection: IntegrationConnectionRecord,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const credential = await credentialFor(connection);
  const method = (init.method || 'GET').toUpperCase();
  const apiKey = method === 'GET' ? (credential.readApiKey || credential.writeApiKey) : credential.writeApiKey;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(new URL(path.replace(/^\//, ''), `${config.CURALEAF_BASE_URL}/`), {
      ...init,
      method,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
        ...init.headers,
      },
    });

    const text = await response.text();
    let body: any = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }

    if (!response.ok) {
      throw new HttpError(
        response.status === 429 ? 429 : 502,
        body?.message || `Curaleaf rejected the request (${response.status}).`,
        'CURALEAF_REQUEST_FAILED'
      );
    }

    const unexpectedCustomer = customerIds(body).find(id => id !== credential.customerId);
    if (unexpectedCustomer) {
      throw new HttpError(502, 'Curaleaf returned data for a different pharmacy.', 'CURALEAF_TENANT_MISMATCH');
    }

    return body as T;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new HttpError(504, 'Curaleaf request timed out.', 'CURALEAF_TIMEOUT');
    }
    throw new HttpError(502, 'Curaleaf could not be reached.', 'CURALEAF_UNAVAILABLE');
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchCuraleafQuote(
  connection: IntegrationConnectionRecord,
  items: Array<{ packId: string; quantity: number }>
) {
  return await curaleafApiRequest(connection, '/v1/quotes/', {
    method: 'POST',
    body: JSON.stringify({ items }),
  });
}

export async function executeCuraleafOrderPlacement(
  connection: IntegrationConnectionRecord,
  order: {
    id: string;
    orderNumber?: string | null;
    status?: string | null;
    quoteSnapshot?: unknown;
  }
) {
  // If order is cancelled, never place with Curaleaf
  if (order.status === 'CANCELLED') {
    return { skipped: true, reason: 'Order is cancelled' };
  }

  // Step 1: Ensure Prescriber exists — match by GPhC/GMC + PIN, create only if not found
  const snapshot = (order.quoteSnapshot ?? {}) as any;
  const rxList = Array.isArray(snapshot?.prescriptions) ? snapshot.prescriptions : [];
  const rxData = rxList[0] || {};
  const prescriberInfo = rxData.prescriber || {};

  const prescriberGphc = prescriberInfo.gphcNumber || null;
  const prescriberGmc = prescriberInfo.gmcNumber ? Number(prescriberInfo.gmcNumber) : null;
  const prescriberPin = String(prescriberInfo.pin || '');

  let prescriberId: string | null = null;
  try {
    const prescriberRes = await curaleafApiRequest<{ prescribers?: Array<{ id: string; gphcNumber?: string | null; gmcNumber?: number | null; pin?: string }> }>(
      connection,
      '/v1/prescribers/'
    ).catch(() => null);

    const allPrescribers = prescriberRes?.prescribers ?? [];

    // Match by GPhC number + PIN, or GMC number + PIN
    const matched = allPrescribers.find(p =>
      (prescriberGphc && p.gphcNumber === prescriberGphc && p.pin === prescriberPin) ||
      (prescriberGmc && p.gmcNumber === prescriberGmc && p.pin === prescriberPin)
    ) || (allPrescribers.length === 1 ? allPrescribers[0] : null);

    if (matched?.id) {
      prescriberId = matched.id;
      console.log(`[Curaleaf] Matched existing prescriber ${prescriberId} (${prescriberGphc || prescriberGmc})`);
    } else {
      const createdPrescriber = await curaleafApiRequest<{ id: string }>(connection, '/v1/prescribers/', {
        method: 'POST',
        body: JSON.stringify({
          name: prescriberInfo.name || 'Unknown Prescriber',
          initials: prescriberInfo.initials || 'XX',
          pin: prescriberPin || '000',
          gmcNumber: prescriberGmc,
          gphcNumber: prescriberGphc,
        }),
      }).catch(() => null);
      if (createdPrescriber?.id) {
        prescriberId = createdPrescriber.id;
        console.log(`[Curaleaf] Created new prescriber ${prescriberId}`);
      }
    }
  } catch (err) {
    console.warn('[Curaleaf] Prescriber verification note:', err);
  }

  if (!prescriberId) {
    console.warn('[Curaleaf] No prescriber ID resolved — placement will proceed without prescription link');
  }

  // Step 2: Extract line items & formulas
  const rawItems = snapshot?.lineItems || snapshot?.items || rxList.flatMap((rx: any) => rx.items) || [];
  const lineItems: Array<{ productId: string; count: number; formulaId?: string; unitsNeededCount?: number }> = [];

  for (const item of rawItems) {
    const id = String(item.productId || item.packId || item.id || '');
    const count = Number(item.quantity || item.qty || item.count || 1);
    const formulaId = item.formulaId || rxData.items?.[0]?.formulaId;
    if (id && count > 0) {
      lineItems.push({
        productId: id,
        count,
        formulaId: formulaId && formulaId !== id ? formulaId : undefined,
        unitsNeededCount: item.unitsNeededCount || count * 10,
      });
    }
  }

  // Step 3: Stock and price re-check quote gate
  if (lineItems.length > 0) {
    try {
      await curaleafApiRequest(connection, '/v1/quotes/', {
        method: 'POST',
        body: JSON.stringify({
          items: lineItems.map(item => ({ packId: item.productId, quantity: item.count })),
        }),
      });
    } catch (quoteErr) {
      console.warn('[Curaleaf] Placement quote recheck note:', quoteErr);
    }
  }

  // Step 4: Submit Prescription if formula is available and prescriber is resolved
  let curaleafPrescriptionId: string | null = null;
  const rxItems = lineItems.filter(item => Boolean(item.formulaId)).map(item => ({
    formulaId: item.formulaId!,
    unitsNeededCount: item.unitsNeededCount || item.count * 10,
  }));

  if (rxItems.length > 0 && prescriberId) {
    try {
      const rxRes = await curaleafApiRequest<{ id: string }>(connection, '/v1/prescriptions/', {
        method: 'POST',
        body: JSON.stringify({
          serialNumber: rxData.serialNumber || `RX-${order.orderNumber || (order.id || 'ORDER').slice(0, 8)}`,
          prescriberId,
          issueDate: rxData.issueDate || new Date().toISOString().split('T')[0],
          items: rxItems,
        }),
      }).catch(() => null);
      if (rxRes?.id) {
        curaleafPrescriptionId = rxRes.id;
        console.log(`[Curaleaf] Prescription submitted: ${curaleafPrescriptionId} (serial: ${rxData.serialNumber})`);
      }
    } catch (err) {
      console.warn('[Curaleaf] Prescription create note:', err);
    }
  } else if (rxItems.length > 0 && !prescriberId) {
    console.warn('[Curaleaf] Skipping prescription submission \u2014 no prescriber ID resolved');
  }

  // Step 5: Submit Purchase Order
  // Use purchase-order-from-prescriptions when a Curaleaf prescription ID exists (correct linked flow),
  // otherwise fall back to direct product items (wholesale/catalog order).
  let purchaseOrderResult: any = null;
  const customerReference = order.orderNumber
    || `HHH-${order.id}`;

  if (curaleafPrescriptionId && lineItems.length > 0) {
    // Prescription-linked flow — Curaleaf will resolve formulas and quantities from the prescription
    try {
      purchaseOrderResult = await curaleafApiRequest(connection, '/v1/purchase-order-from-prescriptions/', {
        method: 'POST',
        body: JSON.stringify({
          customerReference,
          prescriptionIds: [curaleafPrescriptionId],
        }),
      });
      console.log(`[Curaleaf] Purchase order from prescription placed: ${JSON.stringify(purchaseOrderResult)}`);
    } catch (poErr) {
      console.warn('[Curaleaf] purchase-order-from-prescriptions failed, falling back to direct items:', poErr);
      // Fallback to direct items if prescription-linked route fails
      purchaseOrderResult = await curaleafApiRequest(connection, '/v1/purchase-orders/', {
        method: 'POST',
        body: JSON.stringify({
          customerReference,
          items: lineItems.map(item => ({ productId: item.productId, count: item.count })),
        }),
      }).catch(fallbackErr => {
        console.warn('[Curaleaf] Direct purchase-orders fallback also failed:', fallbackErr);
        return null;
      });
    }
  } else if (lineItems.length > 0) {
    // Direct catalog/wholesale flow — no prescription registered with Curaleaf
    try {
      purchaseOrderResult = await curaleafApiRequest(connection, '/v1/purchase-orders/', {
        method: 'POST',
        body: JSON.stringify({
          customerReference,
          items: lineItems.map(item => ({ productId: item.productId, count: item.count })),
        }),
      });
      console.log(`[Curaleaf] Direct purchase order placed: ${JSON.stringify(purchaseOrderResult)}`);
    } catch (poErr) {
      console.warn('[Curaleaf] Purchase order create note:', poErr);
    }
  }

  return {
    prescriberId,
    prescriptionId: curaleafPrescriptionId,
    purchaseOrder: purchaseOrderResult,
  };
}

export async function fetchCuraleafActivity(connection: IntegrationConnectionRecord) {
  const [prescribers, prescriptions, purchaseOrders, shipments] = await Promise.all([
    curaleafApiRequest(connection, '/v1/prescribers/').catch(() => ({ prescribers: [] })),
    curaleafApiRequest(connection, '/v1/prescriptions/').catch(() => ({ prescriptions: [] })),
    curaleafApiRequest(connection, '/v1/purchase-orders/').catch(() => ({ purchaseOrders: [] })),
    curaleafApiRequest(connection, '/v1/shipments/').catch(() => ({ shipments: [] })),
  ]);

  return {
    environment: config.CURALEAF_BASE_URL.includes('.dev') ? 'test' as const : 'production' as const,
    checkedAt: new Date().toISOString(),
    prescribers: (prescribers as any)?.prescribers || [],
    prescriptions: (prescriptions as any)?.prescriptions || [],
    purchaseOrders: (purchaseOrders as any)?.purchaseOrders || [],
    shipments: (shipments as any)?.shipments || [],
  };
}


