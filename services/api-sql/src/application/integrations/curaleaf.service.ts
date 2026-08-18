import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { config } from '../../bootstrap/config.js';
import { HttpError } from '../../domain/common/errors.js';
import {
  existingCuraleafPurchaseOrder,
  matchPurchaseOrder,
} from '../orders/curaleaf-fulfilment.js';
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
    paymentStatus?: string | null;
    paidAt?: string | null;
    quoteSnapshot?: unknown;
  }
) {
  if (order.status === 'CANCELLED') {
    return { skipped: true, reason: 'Order is cancelled' };
  }

  if (order.paymentStatus !== 'PAID' && !order.paidAt) {
    return { skipped: true, reason: 'Order is not paid yet' };
  }

  const recordedPurchaseOrder = existingCuraleafPurchaseOrder(order);
  if (recordedPurchaseOrder) {
    return {
      skipped: true,
      reason: 'Purchase order already recorded for this order',
      purchaseOrder: recordedPurchaseOrder,
      prescriptionId: (recordedPurchaseOrder as { prescriptionId?: string | null }).prescriptionId ?? null,
      prescriberId: (recordedPurchaseOrder as { prescriberId?: string | null }).prescriberId ?? null,
    };
  }

  const customerReference = order.orderNumber || `HHH-${order.id}`;
  const snapshot = (order.quoteSnapshot ?? {}) as Record<string, unknown>;
  const priorCuraleaf = (snapshot.curaleaf && typeof snapshot.curaleaf === 'object'
    ? snapshot.curaleaf
    : null) as { prescriptionId?: string | null; prescriberId?: string | null } | null;

  try {
    const livePurchaseOrders = await fetchCuraleafPurchaseOrders(connection);
    const matchedPurchaseOrder = matchPurchaseOrder(
      { id: order.id, orderNumber: order.orderNumber ?? customerReference },
      livePurchaseOrders,
      null,
    );
    if (matchedPurchaseOrder?.id) {
      return {
        skipped: true,
        reason: 'Purchase order already exists at Curaleaf',
        purchaseOrder: matchedPurchaseOrder,
        prescriptionId: priorCuraleaf?.prescriptionId ?? null,
        prescriberId: priorCuraleaf?.prescriberId ?? null,
      };
    }
  } catch (lookupErr) {
    console.warn('[Curaleaf] Existing purchase-order lookup note:', lookupErr);
  }

  const rxList = Array.isArray(snapshot?.prescriptions) ? snapshot.prescriptions : [];
  const rxData = rxList[0] || {};
  const prescriberInfo = rxData.prescriber || {};

  const prescriberGphc = prescriberInfo.gphcNumber || null;
  const prescriberGmc = prescriberInfo.gmcNumber ? Number(prescriberInfo.gmcNumber) : null;
  const prescriberPin = String(prescriberInfo.pin || '');

  // Step 1: Ensure prescriber exists — match by GPhC/GMC + PIN, create only if not found.
  let prescriberId: string | null = priorCuraleaf?.prescriberId ?? null;
  if (!prescriberId) {
    try {
      const prescriberRes = await curaleafApiRequest<{ prescribers?: Array<{ id: string; gphcNumber?: string | null; gmcNumber?: number | null; pin?: string }> }>(
        connection,
        '/v1/prescribers/'
      ).catch(() => null);

      const allPrescribers = prescriberRes?.prescribers ?? [];
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
  }

  if (!prescriberId) {
    return {
      skipped: true,
      reason: 'Prescriber could not be verified with Curaleaf',
      prescriberId: null,
      prescriptionId: null,
      purchaseOrder: null,
    };
  }

  // Step 2: Extract line items & formulas for prescription submission.
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

  const rxItems = lineItems.filter(item => Boolean(item.formulaId)).map(item => ({
    formulaId: item.formulaId!,
    unitsNeededCount: item.unitsNeededCount || item.count * 10,
  }));

  if (rxItems.length === 0) {
    return {
      skipped: true,
      reason: 'Prescription lines are missing Curaleaf formula IDs',
      prescriberId,
      prescriptionId: null,
      purchaseOrder: null,
    };
  }

  // Step 3: Stock and price re-check quote gate.
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

  // Step 4: Submit prescription and capture the Curaleaf prescription ID.
  let curaleafPrescriptionId: string | null = priorCuraleaf?.prescriptionId ?? null;
  if (!curaleafPrescriptionId) {
    try {
      const rxRes = await curaleafApiRequest<{ id: string; state?: string }>(connection, '/v1/prescriptions/', {
        method: 'POST',
        body: JSON.stringify({
          serialNumber: rxData.serialNumber || `RX-${order.orderNumber || (order.id || 'ORDER').slice(0, 8)}`,
          prescriberId,
          issueDate: rxData.issueDate || new Date().toISOString().split('T')[0],
          items: rxItems,
        }),
      });
      if (rxRes?.id) {
        curaleafPrescriptionId = rxRes.id;
        console.log(`[Curaleaf] Prescription submitted: ${curaleafPrescriptionId} (serial: ${rxData.serialNumber})`);
      }
    } catch (err) {
      console.warn('[Curaleaf] Prescription create note:', err);
    }
  }

  if (!curaleafPrescriptionId) {
    return {
      skipped: true,
      reason: 'Prescription could not be submitted to Curaleaf',
      prescriberId,
      prescriptionId: null,
      purchaseOrder: null,
    };
  }

  // Step 5: Confirm prescription is ready before purchase-order-from-prescriptions.
  try {
    const prescriptionDetails = await curaleafApiRequest<{ state?: string }>(
      connection,
      `/v1/prescriptions/${encodeURIComponent(curaleafPrescriptionId)}/`,
    );
    const prescriptionState = String(prescriptionDetails.state || '').toUpperCase();
    if (prescriptionState === 'PENDING') {
      return {
        skipped: true,
        reason: 'Prescription pending Curaleaf approval',
        prescriberId,
        prescriptionId: curaleafPrescriptionId,
        purchaseOrder: null,
      };
    }
    if (prescriptionState === 'EXPIRED' || prescriptionState === 'CANCELLED') {
      return {
        skipped: true,
        reason: `Prescription is ${prescriptionState.toLowerCase()}`,
        prescriberId,
        prescriptionId: curaleafPrescriptionId,
        purchaseOrder: null,
      };
    }
  } catch (err) {
    console.warn('[Curaleaf] Prescription readiness check note:', err);
  }

  // Step 6: Purchase order from prescription — the only supported placement route.
  let purchaseOrderResult: Record<string, unknown> | null = null;
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
    console.warn('[Curaleaf] purchase-order-from-prescriptions failed:', poErr);
    return {
      skipped: true,
      reason: 'Purchase order could not be created from prescription',
      prescriberId,
      prescriptionId: curaleafPrescriptionId,
      purchaseOrder: null,
    };
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


