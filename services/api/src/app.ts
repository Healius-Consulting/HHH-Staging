import { createHash, randomUUID } from 'node:crypto';
import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import { z } from 'zod';
import { CONDITION_IDS, normaliseConditionId, type ConditionId } from './conditions.js';
import type { DocumentReference } from 'firebase-admin/firestore';
import { audit } from './audit.js';
import { identity, requireRole, requireStaff, tenantFor } from './auth.js';
import { allowedOrigins, config } from './config.js';
import { CuraleafRequestError, curaleafConnectionStatus, curaleafList, curaleafPlatformList, curaleafPlatformRequest, curaleafRequest, scanClinicPrescription, submitClinicPrescription, submitManualPrescription, uploadClinicPrescriptionImage } from './curaleaf.js';
import { fetchCuraleafAccountSnapshot } from './curaleaf-mirror.js';
import { appCheck, auth, firestore, storage } from './firebase.js';
import { HttpError, nowIso } from './http.js';
import { cached, invalidateCache } from './cache.js';
import { createRecord, getRecord, getTenantRecord, invalidateCollectionCache, listTenantRecords, updateTenantRecord } from './repository.js';
import { readIntegrationSecret, writeIntegrationSecret } from './secrets.js';
import type { FulfilmentStatus, IntegrationName, PaymentStatus } from './types.js';
import { createHostedPaymentSession, reconcileWorldpayPayment, type WorldpayCredential, verifyWorldpaySignature } from './worldpay.js';
import { activatePatientForOrder, completeReferral } from './patient-finance.js';
import { adminReferralFinance, pharmacyPrescriptionFinance } from './finance-reporting.js';
import { allocateDispensingFee, calculateExpiryBoundaryDate, calculatePrescriptionExpiry, recordPlacementLedgerEvent, rankSubstitutions, satisfiesMarginFloor } from './placement-engine.js';
import { refundAdapter } from './refund-adapter.js';
import type { Company, CuraleafValidationRecord, PortalOrganisation, PrescriptionPlacement } from './types.js';




const idSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);
const tokenSchema = z.string().min(16).max(160).regex(/^[A-Za-z0-9_-]+$/);
const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
const timestamp = () => nowIso();
const MAX_PRESCRIPTION_FILE_BYTES = 16_000_000;
const PRESCRIPTION_CONTENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const;
const firebaseAuthErrorCode = (error: unknown) => {
  if (!error || typeof error !== 'object') return null;
  const candidate = error as { code?: unknown; errorInfo?: { code?: unknown } };
  return typeof candidate.code === 'string' ? candidate.code : typeof candidate.errorInfo?.code === 'string' ? candidate.errorInfo.code : null;
};

const firstPartyPasswordResetLink = (firebaseLink: string) => {
  const source = new URL(firebaseLink);
  const destination = new URL(config.APP_BASE_URL);
  destination.searchParams.set('mode', 'resetPassword');
  for (const key of ['oobCode', 'apiKey', 'lang']) {
    const value = source.searchParams.get(key);
    if (value) destination.searchParams.set(key, value);
  }
  return destination.toString();
};

const tenantModulesSchema = z.object({
  intake: z.boolean(),
  rx: z.boolean(),
  payments: z.boolean(),
  supplierOrders: z.boolean(),
  patients: z.boolean(),
  resources: z.boolean(),
});

const organisationDetailsSchema = z.object({
  name: z.string().trim().min(1).max(200),
  tradingName: z.string().trim().min(1).max(200),
  gphcNumber: z.string().trim().min(1).max(50),
  superintendent: z.string().trim().min(1).max(200),
  companyNumber: z.string().trim().max(50),
  mainContactName: z.string().trim().min(1).max(200),
  mainContactPhone: z.string().trim().max(50),
  mainContactEmail: z.email().max(254),
  address: z.string().trim().min(1).max(500),
  primaryColour: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  logoText: z.string().trim().min(1).max(4),
  websiteDomains: z.array(z.string().trim().min(1).max(253)).max(20),
  status: z.enum(['onboarding', 'live', 'paused']),
  platformFeeMonthly: z.number().nonnegative().max(100_000).nullable(),
  portalName: z.string().trim().min(1).max(200),
  modules: tenantModulesSchema,
  worldpayEnabled: z.boolean(),
  defaultPaymentRoute: z.enum(['manual', 'worldpay']),
});

const setupDefinitions = [
  { id: 'pharmacy_profile', title: 'Confirm pharmacy and registered premises', required: true },
  { id: 'curaleaf_account', title: 'Verify Curaleaf customer account', required: true },
  { id: 'payment_route', title: 'Choose and verify a payment route', required: true },
  { id: 'pricing', title: 'Confirm Curaleaf pricing and dispensing-charge policy', required: true },
  { id: 'notifications', title: 'Confirm notification sender and wording', required: true },
  { id: 'operational_readiness', title: 'Complete operational readiness walkthrough', required: true },
] as const;

const conditionIdSchema = z.enum(CONDITION_IDS);
const eligibilitySchema = z.object({
  referralToken: tokenSchema,
  firstName: z.string().trim().min(1).max(100),
  surname: z.string().trim().min(1).max(100),
  dob: z.iso.date(),
  mobile: z.string().trim().min(7).max(30),
  email: z.email().max(254),
  postcode: z.string().trim().min(2).max(16),
  conditions: z.array(conditionIdSchema).min(1).max(3).refine(values => new Set(values).size === values.length, 'Conditions must be unique.'),
  primaryCondition: conditionIdSchema,
  tried2: z.boolean(),
  psychExclusion: z.boolean(),
  consentReferral: z.literal(true),
  consentShare: z.literal(true),
  marketing: z.boolean().default(false),
  source: z.string().trim().max(100).default(''),
}).refine(input => input.conditions.includes(input.primaryCondition), {
  path: ['primaryCondition'],
  message: 'Primary condition must be one of the selected conditions.',
});

function conditionSet(record: Record<string, unknown>) {
  const conditions = Array.isArray(record.conditions)
    ? [...new Set(record.conditions.map(normaliseConditionId).filter((value): value is ConditionId => Boolean(value)))].slice(0, 3)
    : [];
  const legacy = normaliseConditionId(record.condition);
  if (conditions.length === 0 && legacy) conditions.push(legacy);
  const requestedPrimary = normaliseConditionId(record.primaryCondition);
  const primaryCondition = requestedPrimary && conditions.includes(requestedPrimary) ? requestedPrimary : conditions[0] ?? null;
  return { conditions, primaryCondition };
}

const preferencesSchema = z.object({
  theme: z.enum(['clinical-light', 'clinical-dark', 'high-contrast', 'warm-low-glare']),
  textScale: z.enum(['default', 'large', 'larger']).default('default'),
  reduceMotion: z.boolean().default(false),
  enhancedFocus: z.boolean().default(false),
  underlineLinks: z.boolean().default(false),
});

const financeRangeSchema = z.object({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
}).refine(value => !value.from || !value.to || value.from <= value.to, {
  message: 'The finance date range is invalid.',
});

const limitResponse = { code: 'RATE_LIMITED', message: 'Too many requests. Wait briefly before trying again.' };
const publicReadLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: 'draft-8', legacyHeaders: false, message: limitResponse });
const publicSubmissionLimit = rateLimit({ windowMs: 60 * 60 * 1000, limit: 5, standardHeaders: 'draft-8', legacyHeaders: false, message: { ...limitResponse, message: 'Too many form submissions from this connection. Try again later.' } });
const webhookLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: 'draft-8', legacyHeaders: false, message: limitResponse });
const healthLimit = rateLimit({ windowMs: 60 * 1000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false, message: limitResponse });
const portalKey = (request: Request) => identity(request).uid;
const portalReadLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 120, keyGenerator: portalKey, skip: request => request.method !== 'GET', standardHeaders: 'draft-8', legacyHeaders: false, message: limitResponse });
const portalWriteLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 40, keyGenerator: portalKey, skip: request => ['GET', 'HEAD', 'OPTIONS'].includes(request.method), standardHeaders: 'draft-8', legacyHeaders: false, message: limitResponse });
const externalProviderLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  keyGenerator: portalKey,
  skip: request => ['GET', 'HEAD', 'OPTIONS'].includes(request.method),
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { ...limitResponse, message: 'Supplier or payment requests are temporarily rate limited. Wait a minute before retrying.' },
});

function localDevelopmentOnly(request: Request, response: Response, next: NextFunction) {
  const remoteAddress = request.socket.remoteAddress ?? '';
  const loopback = remoteAddress === '127.0.0.1' || remoteAddress === '::1' || remoteAddress === '::ffff:127.0.0.1';
  if (config.NODE_ENV !== 'development' || !loopback) return response.status(404).json({ code: 'NOT_FOUND', message: 'Not found.' });
  next();
}

function curaleafTestEnvironmentOnly(_request: Request, response: Response, next: NextFunction) {
  if (!config.CURALEAF_BASE_URL.includes('.dev')) {
    return response.status(404).json({ code: 'NOT_FOUND', message: 'Not found.' });
  }
  next();
}

async function platformCuraleafCatalogue() {
  return cached('curaleaf:catalog:platform', 5 * 60_000, async () => {
    const [formulaPage, productPage] = await Promise.all([
      curaleafPlatformList<Record<string, unknown>>('/v1/formulas/', 'formulas'),
      curaleafPlatformList<Record<string, unknown>>('/v1/products/', 'products'),
    ]);
    return {
      environment: 'test' as const,
      fetchedAt: timestamp(),
      formulas: formulaPage.records,
      products: productPage.records,
      formulaTotal: formulaPage.totalRecordCount,
      productTotal: productPage.totalRecordCount,
    };
  });
}

async function requirePublicAppCheck(request: Request, _response: Response, next: NextFunction) {
  if (config.REQUIRE_APP_CHECK !== 'true') return next();
  try {
    const token = request.get('x-firebase-appcheck');
    if (!token) throw new Error('missing');
    await appCheck.verifyToken(token);
    next();
  } catch {
    next(new HttpError(401, 'App attestation is required.', 'APP_CHECK_REQUIRED'));
  }
}

async function resolveReferralToken(rawToken: string) {
  const hash = tokenHash(rawToken);
  return cached(`referral:${hash}`, 60_000, async () => {
    const tokens = await firestore.collection('referralTokens').where('tokenHash', '==', hash).where('revokedAt', '==', null).limit(1).get();
    const token = tokens.docs[0]?.data();
    if (!token) throw new HttpError(404, 'Pharmacy link not found.', 'NOT_FOUND');
    const organisation = await getRecord('organisations', token.organisationId as string);
    if (!['live', 'onboarding'].includes(String(organisation.status))) throw new HttpError(404, 'Pharmacy link not found.', 'NOT_FOUND');
    return { token, organisation };
  });
}

async function setupStatus(organisationId: string) {
  return cached(`setup:${organisationId}`, 15_000, async () => {
    const records = await firestore.collection('setupTasks').where('organisationId', '==', organisationId).get();
    const byId = new Map(records.docs.map(document => [document.data().taskId as string, document.data()]));
    const tasks = setupDefinitions.map(definition => ({ ...definition, completed: byId.get(definition.id)?.completed === true, evidence: byId.get(definition.id)?.evidence ?? null, completedAt: byId.get(definition.id)?.completedAt ?? null, completedBy: byId.get(definition.id)?.completedBy ?? null }));
    const requiredCount = tasks.filter(task => task.required).length;
    const completedCount = tasks.filter(task => task.required && task.completed).length;
    const updatedAt = records.docs.map(document => String(document.data().updatedAt ?? '')).filter(Boolean).sort().at(-1) ?? timestamp();
    return { organisationId, completed: completedCount === requiredCount, completedCount, requiredCount, tasks, updatedAt };
  });
}

async function requireSetupComplete(organisationId: string) {
  if (!(await setupStatus(organisationId)).completed) throw new HttpError(409, 'Complete pharmacy setup before processing live workflow actions.', 'SETUP_INCOMPLETE');
}

function ensureFreshAuthentication(request: Request) {
  if (identity(request).token.auth_time * 1000 < Date.now() - 5 * 60 * 1000) throw new HttpError(401, 'Sign in again before changing integration credentials.', 'RECENT_LOGIN_REQUIRED');
}

function safeFilename(value: string) {
  return value.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 120) || 'prescription';
}

function maskedIdentifier(value: string) {
  const tail = value.slice(-4);
  return `${'•'.repeat(Math.min(8, Math.max(4, value.length - tail.length)))}${tail}`;
}

async function uploadedFile(organisationId: string, fileId: string) {
  const record = await getTenantRecord('prescriptionFiles', fileId, organisationId);
  if (record.status !== 'uploaded') throw new HttpError(409, 'Complete and verify the prescription file upload first.', 'UPLOAD_INCOMPLETE');
  const object = storage.bucket().file(record.storagePath as string);
  const [exists] = await object.exists();
  if (!exists) throw new HttpError(409, 'Complete the prescription file upload first.', 'UPLOAD_INCOMPLETE');
  const [metadata] = await object.getMetadata();
  if (!metadata.size || Number(metadata.size) > MAX_PRESCRIPTION_FILE_BYTES) throw new HttpError(400, 'Prescription files must be 16 MB or smaller.', 'FILE_TOO_LARGE');
  const [bytes] = await object.download();
  return { bytes, contentType: record.contentType as string, filename: record.filename as string };
}

export function validPrescriptionSignature(contentType: typeof PRESCRIPTION_CONTENT_TYPES[number], bytes: Buffer) {
  if (contentType === 'application/pdf') return bytes.subarray(0, 5).equals(Buffer.from('%PDF-'));
  if (contentType === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  return bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
}

async function startOperation(organisationId: string, orderId: string, kind: 'manual' | 'barcode', subOrderId?: string) {
  const id = createHash('sha256').update(`${organisationId}:${orderId}:${subOrderId ?? 'single'}:curaleaf`).digest('hex');
  const reference = `HHH-${orderId}${subOrderId ? `-${subOrderId}` : ''}`.slice(0, 100);
  const document = firestore.collection('integrationOperations').doc(id);
  try {
    await document.create({ id, schemaVersion: 1, organisationId, orderId, subOrderId: subOrderId ?? null, integration: 'curaleaf', kind, customerReference: reference, status: 'started', createdAt: timestamp(), updatedAt: timestamp() });
  } catch (error) {
    if ((error as { code?: number | string }).code === 6 || (error as { code?: number | string }).code === 'already-exists') throw new HttpError(409, 'This order already has a Curaleaf submission operation. Reconcile it instead of submitting again.', 'DUPLICATE_OPERATION');
    throw error;
  }
  return { id, reference, document };
}

export const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet());
app.use(cors({ origin(origin, callback) { if (!origin || allowedOrigins.has(origin)) return callback(null, true); callback(new HttpError(403, 'Origin is not permitted.', 'ORIGIN_DENIED')); }, methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'] }));
app.use(express.json({ limit: '256kb', verify(request, _response, buffer) { (request as Request).rawBody = Buffer.from(buffer); } }));

app.get('/health', healthLimit, async (_request, response, next) => {
  try {
    await cached('health:firestore', 10_000, async () => {
      await firestore.collection('_health').limit(1).get();
      return true;
    });
    response.json({ status: 'ok', storage: 'firestore', region: 'europe-west2', checkedAt: timestamp() });
  } catch (error) { next(error); }
});

app.get('/v1/dev/curaleaf/catalog', publicReadLimit, localDevelopmentOnly, async (_request, response, next) => {
  try {
    response.json(await platformCuraleafCatalogue());
  } catch (error) { next(error); }
});

app.post('/v1/dev/curaleaf/quote', publicReadLimit, localDevelopmentOnly, async (request, response, next) => {
  try {
    const input = z.object({ items: z.array(z.object({ packId: idSchema, quantity: z.number().int().positive().max(100) })).min(1).max(50) }).parse(request.body);
    response.json(await curaleafPlatformRequest('/v1/quotes/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }));
  } catch (error) { next(error); }
});

app.get('/v1/dev/curaleaf/activity', publicReadLimit, localDevelopmentOnly, async (_request, response, next) => {
  try {
    response.json(await cached('curaleaf:activity:platform', 30_000, async () => {
      const [prescriberPage, prescriptionPage, purchaseOrderPage, shipmentPage] = await Promise.all([
        curaleafPlatformList<Record<string, unknown>>('/v1/prescribers/', 'prescribers'),
        curaleafPlatformList<Record<string, unknown>>('/v1/prescriptions/', 'prescriptions'),
        curaleafPlatformList<Record<string, unknown>>('/v1/purchase-orders/', 'purchaseOrders'),
        curaleafPlatformList<Record<string, unknown>>('/v1/shipments/', 'shipments'),
      ]);
      return {
        environment: 'test',
        fetchedAt: timestamp(),
        prescribers: prescriberPage.records,
        prescriptions: prescriptionPage.records,
        purchaseOrders: purchaseOrderPage.records,
        shipments: shipmentPage.records,
        prescriberTotal: prescriberPage.totalRecordCount,
        prescriptionTotal: prescriptionPage.totalRecordCount,
        purchaseOrderTotal: purchaseOrderPage.totalRecordCount,
        shipmentTotal: shipmentPage.totalRecordCount,
      };
    }));
  } catch (error) { next(error); }
});

app.get('/v1/public/pharmacies/by-token/:token', publicReadLimit, requirePublicAppCheck, async (request, response, next) => {
  try {
    const { organisation } = await resolveReferralToken(tokenSchema.parse(request.params.token));
    response.json({ id: organisation.id, name: organisation.name, tradingName: organisation.tradingName, logoText: organisation.logoText, gphcNumber: organisation.gphcNumber, superintendent: organisation.superintendent, address: organisation.address, primaryColour: organisation.primaryColour });
  } catch (error) { next(error); }
});

app.post('/v1/public/eligibility-submissions', publicSubmissionLimit, requirePublicAppCheck, async (request, response, next) => {
  try {
    const input = eligibilitySchema.parse(request.body);
    const { token, organisation } = await resolveReferralToken(input.referralToken);
    const submittedAt = timestamp();
    const submissionFields = {
      organisationId: organisation.id,
      referralTokenId: token.id,
      firstName: input.firstName,
      surname: input.surname,
      dob: input.dob,
      mobile: input.mobile,
      email: input.email.toLowerCase(),
      postcode: input.postcode.toUpperCase(),
      conditions: input.conditions,
      primaryCondition: input.primaryCondition,
      triedTwoTreatments: input.tried2,
      psychosisExclusion: input.psychExclusion,
      consentReferral: input.consentReferral,
      consentShare: input.consentShare,
      marketingConsent: input.marketing,
      source: input.source,
      consentCapturedAt: submittedAt,
      requestIp: request.ip,
      requestUserAgent: request.get('user-agent') ?? null,
    };
    const existing = (await listTenantRecords('eligibilitySubmissions', organisation.id, 500))
      .find(record => String(record.email).toLowerCase() === input.email.toLowerCase());
    const record = existing
      ? await updateTenantRecord('eligibilitySubmissions', String(existing.id), organisation.id, {
        ...submissionFields,
        duplicateSubmissionCount: Number(existing.duplicateSubmissionCount ?? 0) + 1,
        lastSubmittedAt: submittedAt,
      })
      : await createRecord('eligibilitySubmissions', {
      ...submissionFields,
      status: 'new',
      recordsCheck: { status: 'pending', notes: null, completedAt: null, completedBy: null },
      referral: { status: 'pending', notes: null, completedAt: null, completedBy: null },
      emailDelivery: { status: 'not_sent', queuedAt: null, sentAt: null, failedAt: null },
    });
    await audit(request, existing ? 'eligibility.resubmitted' : 'eligibility.submitted', { organisationId: organisation.id, recordId: record.id });
    response.status(existing ? 200 : 201).json({ id: record.id, organisationId: organisation.id, pharmacyName: organisation.name, submittedAt: record.updatedAt ?? record.createdAt });
  } catch (error) { next(error); }
});

app.post('/v1/public/worldpay/webhooks/:organisationId', webhookLimit, async (request, response, next) => {
  try {
    const organisationId = idSchema.parse(request.params.organisationId);
    const credential = await readIntegrationSecret<WorldpayCredential>(organisationId, 'worldpay');
    if (!verifyWorldpaySignature(request.rawBody ?? Buffer.alloc(0), request.get('worldpay-signature'), credential.webhookSecret)) throw new HttpError(401, 'Webhook signature is invalid.', 'INVALID_WEBHOOK_SIGNATURE');
    const event = z.object({ eventId: z.string().min(1).max(200), transactionReference: z.string().min(1).max(200) }).passthrough().parse(request.body);
    await firestore.collection('integrationConnections').doc(`${organisationId}--worldpay`).set({
      status: 'connected',
      webhookVerifiedAt: timestamp(),
      updatedAt: timestamp(),
    }, { merge: true });
    const eventKey = createHash('sha256').update(event.eventId).digest('hex');
    const eventRef = firestore.collection('worldpayWebhookEvents').doc(eventKey);
    try { await eventRef.create({ id: eventKey, organisationId, eventId: event.eventId, transactionReference: event.transactionReference, receivedAt: timestamp(), status: 'received' }); }
    catch (error) { if ((error as { code?: number | string }).code === 6 || (error as { code?: number | string }).code === 'already-exists') return response.status(202).json({ accepted: true, duplicate: true }); throw error; }

    const payments = await firestore.collection('payments').where('organisationId', '==', organisationId).where('transactionReference', '==', event.transactionReference).limit(1).get();
    const paymentDoc = payments.docs[0];
    if (!paymentDoc) { await eventRef.update({ status: 'unmatched', updatedAt: timestamp() }); return response.status(202).json({ accepted: true, reconciliationRequired: true }); }
    const reconciliation = await reconcileWorldpayPayment(organisationId, event.transactionReference);
    if (!reconciliation.reconciled) {
      await paymentDoc.ref.update({ status: 'reconciliation_required', updatedAt: timestamp() });
      await eventRef.update({ status: 'reconciliation_required', updatedAt: timestamp() });
      return response.status(202).json({ accepted: true, reconciliationRequired: true });
    }
    const provider = reconciliation.payment;
    const providerStatus = String(provider.status ?? provider.outcome ?? '').toLowerCase();
    const providerAmount = Number((provider.value as Record<string, unknown> | undefined)?.amount);
    const expected = paymentDoc.data();
    const verified = ['authorised', 'authorized', 'settled', 'success'].includes(providerStatus) && providerAmount === expected.amountPence;
    const status: PaymentStatus = verified ? 'paid' : 'reconciliation_required';
    await paymentDoc.ref.update({ status, providerResponse: provider, reconciledAt: timestamp(), updatedAt: timestamp() });
    if (verified) {
      await firestore.collection('orders').doc(expected.orderId as string).update({ paymentStatus: 'paid', updatedAt: timestamp() });
      invalidateCollectionCache('orders', expected.orderId as string);
    }
    await eventRef.update({ status, updatedAt: timestamp() });
    response.status(202).json({ accepted: true, reconciled: verified });
  } catch (error) { next(error); }
});

app.use('/v1/portal', requireStaff);
app.use('/v1/portal', portalReadLimit, portalWriteLimit);
app.use('/v1/portal/integrations', externalProviderLimit);

app.get('/v1/portal/session', async (request, response, next) => {
  try {
    const actor = identity(request);
    const [staffSnapshot, organisation] = await Promise.all([
      firestore.collection('staffUsers').doc(actor.uid).get(),
      actor.organisationId ? getRecord('organisations', actor.organisationId) : Promise.resolve(null),
    ]);
    const profile = staffSnapshot.data() ?? null;
    if (profile?.status === 'invited') {
      await staffSnapshot.ref.set({ status: 'active', activatedAt: timestamp(), updatedAt: timestamp() }, { merge: true });
      profile.status = 'active';
      if (actor.organisationId) invalidateCache(`admin:staff:${actor.organisationId}`);
    }
    response.json({ uid: actor.uid, email: actor.email, role: actor.role, organisationId: actor.organisationId, profile, organisation });
  } catch (error) { next(error); }
});

app.get('/v1/portal/preferences', async (request, response, next) => {
  try { response.json((await firestore.collection('staffUsers').doc(identity(request).uid).get()).data()?.preferences ?? preferencesSchema.parse({ theme: 'clinical-light' })); }
  catch (error) { next(error); }
});

app.patch('/v1/portal/preferences', async (request, response, next) => {
  try {
    const preferences = preferencesSchema.parse(request.body);
    await firestore.collection('staffUsers').doc(identity(request).uid).set({ preferences, updatedAt: timestamp() }, { merge: true });
    response.json(preferences);
  } catch (error) { next(error); }
});

app.put('/v1/portal/payment-settings', async (request, response, next) => {
  try {
    const input = z.object({
      organisationId: idSchema.optional(),
      defaultPaymentRoute: z.enum(['manual', 'worldpay']).optional(),
      worldpayEnabled: z.boolean().optional(),
    }).refine(value => value.defaultPaymentRoute !== undefined || value.worldpayEnabled !== undefined, {
      message: 'Choose a default payment route.',
    }).parse(request.body);
    const organisationId = tenantFor(request, input.organisationId);
    const defaultPaymentRoute = input.defaultPaymentRoute ?? (input.worldpayEnabled ? 'worldpay' : 'manual');
    if (defaultPaymentRoute === 'worldpay') {
      const connection = await firestore.collection('integrationConnections').doc(`${organisationId}--worldpay`).get();
      if (!connection.exists || connection.data()?.status !== 'connected') {
        throw new HttpError(409, 'Verify this pharmacy’s Worldpay connection before making it the default payment route.', 'WORLDPAY_VERIFICATION_REQUIRED');
      }
    }
    const updatedAt = timestamp();
    await firestore.collection('organisations').doc(organisationId).set({
      defaultPaymentRoute,
      worldpayEnabled: defaultPaymentRoute === 'worldpay',
      updatedAt,
    }, { merge: true });
    invalidateCollectionCache('organisations', organisationId);
    invalidateCache('admin:organisations');
    await audit(request, 'payment.settings_updated', { organisationId, defaultPaymentRoute });
    response.json({ organisationId, defaultPaymentRoute, worldpayEnabled: defaultPaymentRoute === 'worldpay', updatedAt });
  } catch (error) { next(error); }
});

app.get('/v1/portal/setup', async (request, response, next) => {
  try { response.json(await setupStatus(tenantFor(request, request.query.organisationId))); }
  catch (error) { next(error); }
});

app.patch('/v1/portal/setup/:taskId', async (request, response, next) => {
  try {
    const taskId = z.enum(setupDefinitions.map(task => task.id) as [typeof setupDefinitions[number]['id'], ...typeof setupDefinitions[number]['id'][]]).parse(request.params.taskId);
    if (taskId === 'curaleaf_account' && identity(request).role !== 'hhh_admin') throw new HttpError(403, 'Curaleaf activation is managed only by HHH administrators.', 'FORBIDDEN');
    const input = z.object({ organisationId: idSchema.optional(), completed: z.boolean(), evidence: z.string().trim().max(1000).nullable().optional() }).parse(request.body);
    const organisationId = tenantFor(request, input.organisationId);
    const docId = `${organisationId}--${taskId}`;
    await firestore.collection('setupTasks').doc(docId).set({ id: docId, schemaVersion: 1, organisationId, taskId, completed: input.completed, evidence: input.evidence ?? null, completedAt: input.completed ? timestamp() : null, completedBy: input.completed ? identity(request).uid : null, updatedAt: timestamp() }, { merge: true });
    invalidateCache(`setup:${organisationId}`);
    await audit(request, 'setup.task_updated', { organisationId, taskId, completed: input.completed });
    response.json(await setupStatus(organisationId));
  } catch (error) { next(error); }
});

app.get('/v1/portal/eligibility-submissions', async (request, response, next) => {
  try {
    const organisationId = tenantFor(request, request.query.organisationId);
    const [records, organisation] = await Promise.all([listTenantRecords('eligibilitySubmissions', organisationId, 500), getRecord('organisations', organisationId)]);
    const statusLabels: Record<string, string> = { new: 'New', reviewing: 'Under HHH review', approved: 'Approved', declined: 'Declined' };
    response.json(records.map(record => {
      const { conditions, primaryCondition } = conditionSet(record);
      return {
      id: record.id, organisationId, pharmacyName: organisation.name,
      firstName: record.firstName, surname: record.surname, dob: record.dob, mobile: record.mobile, email: record.email,
      postcode: record.postcode, conditions, primaryCondition, tried2: record.triedTwoTreatments,
      psychExclusion: record.psychosisExclusion, consentReferral: record.consentReferral, consentShare: record.consentShare,
      marketing: record.marketingConsent, source: record.source, status: statusLabels[String(record.status)] ?? 'New',
      reviewedAt: record.reviewedAt ?? null, reviewedBy: record.reviewedBy ?? null, decisionNote: record.decisionNote ?? null,
      recordsCheck: record.recordsCheck ?? { status: 'pending', notes: null, completedAt: null, completedBy: null },
      referral: record.referral ?? {
        status: record.status === 'approved' ? 'completed' : record.status === 'declined' ? 'declined' : 'pending',
        notes: record.decisionNote ?? null,
        completedAt: record.status === 'approved' || record.status === 'declined' ? record.reviewedAt ?? null : null,
        completedBy: record.status === 'approved' || record.status === 'declined' ? record.reviewedBy ?? null : null,
      },
      emailDelivery: record.emailDelivery ?? { status: 'not_sent', queuedAt: null, sentAt: null, failedAt: null },
      patientId: record.patientId ?? null,
      submittedAt: record.lastSubmittedAt ?? record.createdAt,
    }; }));
  }
  catch (error) { next(error); }
});

app.post('/v1/portal/admin/eligibility-submissions/:id/records-check', requireRole('hhh_admin'), async (request, response, next) => {
  try {
    const input = z.object({
      organisationId: idSchema,
      notes: z.string().trim().min(1).max(2_000),
    }).parse(request.body);
    const recordId = idSchema.parse(request.params.id);
    const current = await getTenantRecord('eligibilitySubmissions', recordId, input.organisationId);
    if (current.referral?.status === 'completed' || current.status === 'approved') {
      throw new HttpError(409, 'The completed referral record can no longer be changed.', 'REFERRAL_ALREADY_COMPLETED');
    }
    const completedAt = timestamp();
    const result = await updateTenantRecord('eligibilitySubmissions', recordId, input.organisationId, {
      status: 'reviewing',
      recordsCheck: { status: 'completed', notes: input.notes, completedAt, completedBy: identity(request).uid },
    });
    await audit(request, 'eligibility.records_check_completed', { organisationId: input.organisationId, recordId });
    response.json(result);
  } catch (error) { next(error); }
});

app.post('/v1/portal/admin/eligibility-submissions/:id/referral-decision', requireRole('hhh_admin'), async (request, response, next) => {
  try {
    const input = z.object({
      organisationId: idSchema,
      decision: z.enum(['completed', 'declined']),
      notes: z.string().trim().max(2_000).nullable().optional(),
    }).parse(request.body);
    const recordId = idSchema.parse(request.params.id);
    if (input.decision === 'completed') {
      await getTenantRecord('eligibilitySubmissions', recordId, input.organisationId);
      const result = await completeReferral(recordId, identity(request).uid, input.notes ?? null);
      await audit(request, 'eligibility.referral_completed', { organisationId: input.organisationId, recordId, patientId: result.patientId, feeEventId: result.feeEventId });
      response.json({ ...result, status: 'approved', referralStatus: 'completed' });
      return;
    }
    const current = await getTenantRecord('eligibilitySubmissions', recordId, input.organisationId);
    if (current.referral?.status === 'completed' || current.status === 'approved') {
      throw new HttpError(409, 'A completed referral cannot be declined.', 'REFERRAL_ALREADY_COMPLETED');
    }
    const completedAt = timestamp();
    const result = await updateTenantRecord('eligibilitySubmissions', recordId, input.organisationId, {
      status: 'declined',
      decisionNote: input.notes ?? null,
      referral: { status: 'declined', notes: input.notes ?? null, completedAt, completedBy: identity(request).uid },
      reviewedAt: completedAt,
      reviewedBy: identity(request).uid,
    });
    await audit(request, 'eligibility.referral_declined', { organisationId: input.organisationId, recordId });
    response.json(result);
  } catch (error) { next(error); }
});

app.post('/v1/portal/admin/eligibility-submissions/:id/email', requireRole('hhh_admin'), async (request, response, next) => {
  try {
    const input = z.object({ organisationId: idSchema }).parse(request.body);
    const recordId = idSchema.parse(request.params.id);
    const submission = await getTenantRecord('eligibilitySubmissions', recordId, input.organisationId);
    if (submission.referral?.status !== 'completed' && submission.status !== 'approved') {
      throw new HttpError(409, 'Complete the referral before sending the patient email.', 'REFERRAL_NOT_COMPLETED');
    }
    const outboxId = `${recordId}--referral-completed`;
    const outboxRef = firestore.collection('notificationOutbox').doc(outboxId);
    const queuedAt = timestamp();
    try {
      await outboxRef.create({
        id: outboxId,
        schemaVersion: 1,
        organisationId: input.organisationId,
        kind: 'patient_referral_completed',
        recipient: submission.email,
        templateData: {
          firstName: submission.firstName,
          pharmacyName: (await getRecord('organisations', input.organisationId)).tradingName,
        },
        status: 'pending',
        referralSubmissionId: recordId,
        createdAt: queuedAt,
        updatedAt: queuedAt,
        createdBy: identity(request).uid,
      });
      await firestore.collection('eligibilitySubmissions').doc(recordId).update({
        emailDelivery: { status: 'queued', queuedAt, queuedBy: identity(request).uid, outboxId },
        updatedAt: queuedAt,
      });
      invalidateCollectionCache('eligibilitySubmissions', recordId);
    } catch (error) {
      const code = (error as { code?: number | string } | null)?.code;
      if (code !== 6 && code !== 'already-exists') throw error;
    }
    await audit(request, 'eligibility.patient_email_queued', { organisationId: input.organisationId, recordId, outboxId });
    response.status(202).json({ status: 'queued', outboxId });
  } catch (error) { next(error); }
});

app.patch('/v1/portal/eligibility-submissions/:id', requireRole('hhh_admin'), async (request, response, next) => {
  try {
    const input = z.object({ organisationId: idSchema.optional(), status: z.enum(['reviewing', 'approved', 'declined']), decisionNote: z.string().trim().max(2000).nullable().optional() }).parse(request.body);
    const organisationId = tenantFor(request, input.organisationId);
    const recordId = idSchema.parse(request.params.id);
    if (input.status === 'approved') {
      await getTenantRecord('eligibilitySubmissions', recordId, organisationId);
      const result = await completeReferral(recordId, identity(request).uid, input.decisionNote ?? null);
      await audit(request, 'eligibility.reviewed', { organisationId, recordId, status: input.status, patientId: result.patientId });
      response.json(result);
      return;
    }
    const reviewedAt = timestamp();
    const result = await updateTenantRecord('eligibilitySubmissions', recordId, organisationId, {
      status: input.status,
      decisionNote: input.decisionNote ?? null,
      reviewedAt,
      reviewedBy: identity(request).uid,
      ...(input.status === 'declined' ? {
        referral: { status: 'declined', notes: input.decisionNote ?? null, completedAt: reviewedAt, completedBy: identity(request).uid },
      } : {}),
    });
    await audit(request, 'eligibility.reviewed', { organisationId, recordId: result.id, status: input.status });
    response.json(result);
  } catch (error) { next(error); }
});

const patientSchema = z.object({
  firstName: z.string().trim().min(1).max(100),
  surname: z.string().trim().min(1).max(100),
  dob: z.iso.date(),
  email: z.email(),
  mobile: z.string().trim().min(7).max(30),
  address: z.string().trim().max(500),
  postcode: z.string().trim().max(16),
  status: z.enum(['referred', 'active', 'inactive']).default('active'),
  conditions: z.array(conditionIdSchema).max(3).optional(),
  primaryCondition: conditionIdSchema.nullable().optional(),
});
app.get('/v1/portal/patients', async (request, response, next) => { try { const organisationId = tenantFor(request, request.query.organisationId); const records = await listTenantRecords('patients', organisationId); response.json(records); } catch (error) { next(error); } });
app.post('/v1/portal/patients', async (request, response, next) => {
  try { const organisationId = tenantFor(request, request.body.organisationId); const record = await createRecord('patients', { ...patientSchema.parse(request.body), organisationId }); await audit(request, 'patient.created', { organisationId, recordId: record.id }); response.status(201).json(record); } catch (error) { next(error); }
});
app.patch('/v1/portal/patients/:id', async (request, response, next) => {
  try {
    const organisationId = tenantFor(request, request.body.organisationId);
    const patientId = idSchema.parse(request.params.id);
    const current = await getTenantRecord('patients', patientId, organisationId);
    const updates = patientSchema.partial().parse(request.body);
    if (updates.status === 'active' && current.sourceReferralId && !current.activatedAt) {
      throw new HttpError(409, 'A referred patient becomes active only after their first prescription reaches Curaleaf.', 'PATIENT_ACTIVATION_REQUIRES_ORDER');
    }
    const statusChanged = updates.status !== undefined && updates.status !== current.status;
    const record = await updateTenantRecord('patients', patientId, organisationId, {
      ...updates,
      ...(statusChanged ? { statusChangedAt: timestamp() } : {}),
    });
    await audit(request, 'patient.updated', { organisationId, recordId: record.id });
    response.json(record);
  } catch (error) { next(error); }
});

app.get('/v1/portal/finance/prescriptions', async (request, response, next) => {
  try {
    const organisationId = tenantFor(request, request.query.organisationId);
    const range = financeRangeSchema.parse({ from: request.query.from, to: request.query.to });
    response.json(await pharmacyPrescriptionFinance(organisationId, range));
  } catch (error) { next(error); }
});

app.get('/v1/portal/admin/finance/referrals', requireRole('hhh_admin'), async (request, response, next) => {
  try {
    const range = financeRangeSchema.parse({ from: request.query.from, to: request.query.to });
    const organisationId = request.query.organisationId === undefined ? undefined : idSchema.parse(request.query.organisationId);
    response.json(await adminReferralFinance(range, organisationId));
  } catch (error) { next(error); }
});

/* ========================================================================== */
/* Company & Pharmacy Admin Routes                                           */
/* ========================================================================== */

app.get('/v1/portal/admin/companies', requireRole('hhh_admin'), async (_request, response, next) => {
  try {
    const companiesSnap = await firestore.collection('companies').get();
    const companies = companiesSnap.docs.map(doc => doc.data() as Company);
    response.json(companies);
  } catch (error) { next(error); }
});

app.post('/v1/portal/admin/companies', requireRole('hhh_admin'), async (request, response, next) => {
  try {
    const schema = z.object({
      legalName: z.string().trim().min(1).max(200),
      companyNumber: z.string().trim().min(1).max(50),
      registeredAddress: z.string().trim().min(1).max(500),
      ownerContact: z.object({
        name: z.string().trim().min(1).max(200),
        email: z.string().email(),
        phone: z.string().trim().min(1).max(50),
      }),
      superintendent: z.object({
        name: z.string().trim().min(1).max(200),
        gphcNumber: z.string().trim().min(1).max(50),
      }),
      notes: z.string().trim().max(1000).optional(),
    });
    const input = schema.parse(request.body);
    const docRef = firestore.collection('companies').doc();
    const company: Company = {
      id: docRef.id,
      ...input,
      gdprConfirmed: false,
      gdprDocUrl: null,
      gdprConfirmedAt: null,
      gdprConfirmedBy: null,
      gdprComplianceFlag: false,
      branchesOwned: [],
      notes: input.notes ?? null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    await docRef.set(company);
    invalidateCollectionCache('companies');
    await audit(request, 'company.created', { companyId: company.id, legalName: company.legalName });
    response.status(201).json(company);
  } catch (error) { next(error); }
});

app.patch('/v1/portal/admin/companies/:id', requireRole('hhh_admin'), async (request, response, next) => {
  try {
    const companyId = idSchema.parse(request.params.id);
    const companyRef = firestore.collection('companies').doc(companyId);
    const snap = await companyRef.get();
    if (!snap.exists) throw new HttpError(404, 'Company not found.', 'NOT_FOUND');
    const updates = request.body as Partial<Company>;
    const updated = { ...snap.data(), ...updates, updatedAt: nowIso() };
    await companyRef.set(updated, { merge: true });
    invalidateCollectionCache('companies', companyId);
    await audit(request, 'company.updated', { companyId });
    response.json(updated);
  } catch (error) { next(error); }
});

app.post('/v1/portal/admin/companies/:id/gdpr/confirm', requireRole('hhh_admin'), async (request, response, next) => {
  try {
    const companyId = idSchema.parse(request.params.id);
    const { gdprDocUrl } = z.object({ gdprDocUrl: z.string().url() }).parse(request.body);
    
    // Validate Google Drive/Docs HTTPS URL
    if (!gdprDocUrl.startsWith('https://drive.google.com/') && !gdprDocUrl.startsWith('https://docs.google.com/')) {
      throw new HttpError(400, 'GDPR evidence URL must be an HTTPS Google Drive or Google Docs URL.', 'INVALID_GDPR_URL');
    }

    const companyRef = firestore.collection('companies').doc(companyId);
    const snap = await companyRef.get();
    if (!snap.exists) throw new HttpError(404, 'Company not found.', 'NOT_FOUND');

    const confirmedAt = nowIso();
    const confirmedBy = identity(request).uid;

    await companyRef.update({
      gdprConfirmed: true,
      gdprDocUrl,
      gdprConfirmedAt: confirmedAt,
      gdprConfirmedBy: confirmedBy,
      gdprComplianceFlag: false,
      updatedAt: confirmedAt,
    });
    invalidateCollectionCache('companies', companyId);
    await audit(request, 'company.gdpr_confirmed', { companyId, gdprDocUrl, confirmedBy });
    response.json({ success: true, companyId, gdprConfirmed: true, gdprDocUrl });
  } catch (error) { next(error); }
});

app.post('/v1/portal/admin/companies/:id/gdpr/clear', requireRole('hhh_admin'), async (request, response, next) => {
  try {
    const companyId = idSchema.parse(request.params.id);
    z.object({ confirm: z.literal(true) }).parse(request.body);

    const companyRef = firestore.collection('companies').doc(companyId);
    const snap = await companyRef.get();
    if (!snap.exists) throw new HttpError(404, 'Company not found.', 'NOT_FOUND');
    const company = snap.data() as Company;

    const clearedAt = nowIso();
    await companyRef.update({
      gdprConfirmed: false,
      gdprDocUrl: null,
      updatedAt: clearedAt,
    });

    // Handle owned branches:
    // Non-live branches are re-blocked. Already-live branches remain operational but get gdprComplianceFlag.
    for (const pharmacyId of company.branchesOwned || []) {
      const pharmRef = firestore.collection('pharmacies').doc(pharmacyId);
      const pharmSnap = await pharmRef.get();
      if (pharmSnap.exists) {
        const pharmData = pharmSnap.data() as PortalOrganisation;
        if (pharmData.status === 'live') {
          await pharmRef.update({ gdprComplianceFlag: true, updatedAt: clearedAt });
        } else {
          await pharmRef.update({ status: 'onboarding', updatedAt: clearedAt });
        }
      }
    }

    invalidateCollectionCache('companies', companyId);
    await audit(request, 'company.gdpr_cleared', { companyId, priorDocUrl: company.gdprDocUrl });
    response.json({ success: true, companyId, gdprConfirmed: false });
  } catch (error) { next(error); }
});

app.post('/v1/portal/admin/pharmacies/:id/validate-curaleaf', requireRole('hhh_admin'), async (request, response, next) => {
  try {
    const pharmacyId = idSchema.parse(request.params.id);
    const { environment, apiKey } = z.object({
      environment: z.enum(['test', 'production']),
      apiKey: z.string().min(16),
    }).parse(request.body);

    // Call Curaleaf API to validate key and derive customerId
    const baseUrl = environment === 'test' ? 'https://api.curaleaflaboratories.dev' : config.CURALEAF_BASE_URL;
    const res = await fetch(`${baseUrl}/v1/products/?pageSize=1`, {
      headers: { Accept: 'application/json', 'X-API-Key': apiKey },
    });

    if (!res.ok) {
      throw new HttpError(400, `Curaleaf key validation failed with status ${res.status}.`, 'CURALEAF_VALIDATION_FAILED');
    }

    const body = (await res.json()) as Record<string, unknown>;
    let observedCustomerId: string | null = null;
    if (Array.isArray(body.products) && body.products[0] && typeof body.products[0].customerId === 'string') {
      observedCustomerId = body.products[0].customerId;
    }

    const maskedKey = `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}`;
    const validationRecord: CuraleafValidationRecord = {
      environment,
      validatedAt: nowIso(),
      actor: identity(request).uid,
      maskedKey,
      observedCustomerId,
    };

    const pharmRef = firestore.collection('pharmacies').doc(pharmacyId);
    const fieldToUpdate = environment === 'test' ? 'curaleafTestValidation' : 'curaleafLiveValidation';
    await pharmRef.set({ [fieldToUpdate]: validationRecord, updatedAt: nowIso() }, { merge: true });

    // Store key in Secret Manager
    const secretIntegration = environment === 'test' ? 'curaleaf_test' : 'curaleaf_live';
    await writeIntegrationSecret(pharmacyId, secretIntegration, {
      writeApiKey: apiKey,
      customerId: observedCustomerId || '',
    });

    invalidateCollectionCache('pharmacies', pharmacyId);
    await audit(request, 'pharmacy.curaleaf_validated', { pharmacyId, environment, maskedKey, observedCustomerId });
    response.json({ success: true, pharmacyId, validationRecord });
  } catch (error) { next(error); }
});





const orderLineItemSchema = z.object({ packId: idSchema, quantity: z.number().int().positive().max(100) });
const curaleafQuoteSchema = z.object({
  shippingPrice: z.string().trim().min(1).max(40),
  taxRate: z.string().trim().min(1).max(40),
  items: z.array(z.object({
    packId: idSchema,
    quantity: z.number().int().positive().max(100),
    inStock: z.boolean(),
    wholesalePackPrice: z.string().trim().min(1).max(40),
    patientPackPrice: z.string().trim().min(1).max(40),
  })).min(1).max(100),
});
const orderPrescriptionSchema = z.object({
  fileId: idSchema,
  clinicScanId: idSchema.optional(),
  curaleafPrescriptionId: idSchema.optional(),
  serialNumber: z.string().max(200).optional().default(''),
  issueDate: z.iso.date(),
  expiryDate: z.iso.date().optional(),

  patient: z.object({
    name: z.string().trim().min(1).max(200),
    dob: z.iso.date(),
  }),
  prescriber: z.object({
    id: idSchema.optional(),
    pin: z.string().max(100).default(''),
    gmcNumber: z.number().int().positive().nullable(),
    gphcNumber: z.string().max(100).nullable(),
    name: z.string().min(1).max(200),
    initials: z.string().min(1).max(20),
  }),
  items: z.array(z.object({
    formulaId: idSchema,
    unitsNeededCount: z.number().int().positive().max(100),
    packId: idSchema,
    quantity: z.number().int().positive().max(100),
  })).min(1).max(50),
});
const orderSchema = z.object({
  patientId: idSchema,
  lineItems: z.array(orderLineItemSchema).min(1).max(50),
  prescriptions: z.array(orderPrescriptionSchema).max(20).default([]),
  dispensingFeePence: z.number().int().nonnegative().max(10_000).default(0),
  currency: z.literal('GBP').default('GBP'),
  // Accepted during the compatibility window, but never trusted. The server
  // snapshots the pharmacy setting below.
  paymentRoute: z.enum(['manual', 'worldpay']).optional(),
});

function normalisedPatientName(value: string) {
  return value
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('en-GB')
    .replace(/\b(mr|mrs|miss|ms|mx|dr)\b\.?/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(' ');
}

function requireMatchingPatient(prescription: { name: string; dob: string }, patient: Record<string, unknown>) {
  const selectedName = `${String(patient.firstName ?? '')} ${String(patient.surname ?? '')}`.trim();
  if (prescription.dob !== patient.dob || normalisedPatientName(prescription.name) !== normalisedPatientName(selectedName)) {
    throw new HttpError(409, 'The prescription patient does not match the selected patient record.', 'PRESCRIPTION_PATIENT_MISMATCH');
  }
}

function packQuantities(items: Array<{ packId: string; quantity: number }>) {
  const quantities = new Map<string, number>();
  items.forEach(item => quantities.set(item.packId, (quantities.get(item.packId) ?? 0) + item.quantity));
  return quantities;
}

function samePackQuantities(left: Map<string, number>, right: Map<string, number>) {
  return left.size === right.size && [...left].every(([packId, quantity]) => right.get(packId) === quantity);
}

function curaleafMoneyPence(value: unknown, field = 'price') {
  const price = String(value ?? '').trim();
  const match = /^(\d+)(?:\.(\d+))?$/.exec(price);
  if (!match || (match[2]?.slice(2).match(/[1-9]/))) throw new HttpError(502, `Curaleaf returned an invalid ${field}.`, 'INVALID_SUPPLIER_PRICE');
  const pence = BigInt(match[1]!) * 100n + BigInt((match[2] ?? '').padEnd(2, '0').slice(0, 2) || '0');
  if (pence > 10_000_000n) throw new HttpError(502, `Curaleaf returned a ${field} outside the supported range.`, 'INVALID_SUPPLIER_PRICE');
  return Number(pence);
}

type ParsedCuraleafQuote = z.infer<typeof curaleafQuoteSchema>;
type QuoteDifference = {
  category: 'stock' | 'patient_price' | 'supplier_cost';
  field: string;
  packId?: string;
  previous: string | boolean;
  latest: string | boolean;
};

export function normalisedQuote(quote: ParsedCuraleafQuote) {
  return {
    shippingPence: curaleafMoneyPence(quote.shippingPrice, 'shipping price'),
    taxRate: Number(quote.taxRate),
    items: [...quote.items].sort((left, right) => left.packId.localeCompare(right.packId)).map(item => ({
      packId: item.packId,
      quantity: item.quantity,
      inStock: item.inStock,
      wholesalePence: curaleafMoneyPence(item.wholesalePackPrice, 'wholesale pack price'),
      patientPence: curaleafMoneyPence(item.patientPackPrice, 'patient pack price'),
    })),
  };
}

export function quoteFingerprint(quote: ParsedCuraleafQuote) {
  return createHash('sha256').update(JSON.stringify(normalisedQuote(quote))).digest('hex');
}

export function compareQuotes(baseline: ParsedCuraleafQuote, latest: ParsedCuraleafQuote): QuoteDifference[] {
  const differences: QuoteDifference[] = [];
  const prior = normalisedQuote(baseline);
  const next = normalisedQuote(latest);
  const priorItems = new Map(prior.items.map(item => [item.packId, item]));
  for (const item of next.items) {
    const earlier = priorItems.get(item.packId);
    if (!earlier) continue;
    if (item.inStock !== earlier.inStock) differences.push({ category: 'stock', field: 'inStock', packId: item.packId, previous: earlier.inStock, latest: item.inStock });
    if (item.patientPence !== earlier.patientPence) differences.push({ category: 'patient_price', field: 'patientPackPrice', packId: item.packId, previous: String(earlier.patientPence), latest: String(item.patientPence) });
    if (item.wholesalePence !== earlier.wholesalePence) differences.push({ category: 'supplier_cost', field: 'wholesalePackPrice', packId: item.packId, previous: String(earlier.wholesalePence), latest: String(item.wholesalePence) });
  }
  if (prior.shippingPence !== next.shippingPence) differences.push({ category: 'supplier_cost', field: 'shippingPrice', previous: String(prior.shippingPence), latest: String(next.shippingPence) });
  if (prior.taxRate !== next.taxRate) differences.push({ category: 'supplier_cost', field: 'taxRate', previous: String(prior.taxRate), latest: String(next.taxRate) });
  return differences;
}

async function finalCuraleafQuote(organisationId: string, items: Array<{ packId: string; quantity: number }>) {
  const raw = await curaleafRequest<unknown>(organisationId, '/v1/quotes/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items }),
  });
  const parsed = curaleafQuoteSchema.safeParse(raw);
  if (!parsed.success) throw new HttpError(502, 'Curaleaf returned an invalid final quote.', 'INVALID_SUPPLIER_QUOTE');
  if (!samePackQuantities(packQuantities(items), packQuantities(parsed.data.items))) {
    throw new HttpError(409, 'Curaleaf’s final quote does not match this order.', 'SUPPLIER_QUOTE_MISMATCH');
  }
  return parsed.data;
}

async function requireApprovedFinalQuote(request: Request, organisationId: string, orderId: string, order: Record<string, unknown>, items: Array<{ packId: string; quantity: number }>) {
  const latest = await finalCuraleafQuote(organisationId, items);
  const baselineResult = curaleafQuoteSchema.safeParse(order.pricingQuote);
  const fingerprint = quoteFingerprint(latest);
  const existingReview = order.quoteReview && typeof order.quoteReview === 'object' ? order.quoteReview as Record<string, unknown> : {};
  const differences = baselineResult.success ? compareQuotes(baselineResult.data, latest) : [{ category: 'patient_price' as const, field: 'missingOriginalQuote', previous: 'missing', latest: 'present' }];
  const outOfStock = latest.items.some(item => !item.inStock);
  if (!outOfStock && differences.length === 0) return latest;
  const reviewType = outOfStock ? 'out_of_stock' : differences.some(item => item.category === 'patient_price') ? 'patient_price_changed' : 'supplier_cost_changed';
  if (reviewType === 'supplier_cost_changed' && existingReview.status === 'approved' && existingReview.approvedFingerprint === fingerprint) return latest;
  const quoteReview = {
    status: reviewType === 'patient_price_changed' ? 'recreate_required' : 'required',
    type: reviewType,
    fingerprint,
    latestQuote: latest,
    differences,
    checkedAt: timestamp(),
  };
  await firestore.collection('orders').doc(orderId).update({ quoteReview, integrationStatus: 'quote_review_required', updatedAt: timestamp() });
  const supportCaseId = createHash('sha256').update(`${organisationId}:${orderId}:quote_review:${fingerprint}`).digest('hex');
  const supportCase = firestore.collection('curaleafSupportCases').doc(supportCaseId);
  if (!(await supportCase.get()).exists) {
    await supportCase.create({
      id: supportCaseId,
      schemaVersion: 1,
      organisationId,
      orderId,
      reason: 'quote_review',
      status: 'open',
      note: reviewType === 'patient_price_changed' ? 'The patient price changed after payment; cancel/refund and recreate this order.' : reviewType === 'out_of_stock' ? 'Curaleaf reports an out-of-stock pack.' : 'Curaleaf supplier costs changed after payment and require approval.',
      prescriptionId: null,
      purchaseOrderId: null,
      openedBy: identity(request).uid,
      openedByRole: identity(request).role,
      openedAt: timestamp(),
      createdAt: timestamp(),
      updatedAt: timestamp(),
    });
  }
  invalidateCollectionCache('orders', orderId);
  await audit(request, 'curaleaf.quote_review_required', { organisationId, orderId, reviewType, fingerprint, differences });
  const message = reviewType === 'out_of_stock'
    ? 'Curaleaf reports that one or more packs are out of stock. The supplier order has not been placed.'
    : reviewType === 'patient_price_changed'
      ? 'Curaleaf’s patient price changed after payment. Cancel or refund this order and recreate it before supplier placement.'
      : 'Curaleaf’s supplier cost changed after payment. Review and approve the latest quote before placement.';
  throw new HttpError(409, message, 'QUOTE_REVIEW_REQUIRED');
}

type ClinicScanProduct = {
  id: string;
  formulaId: string;
  formulaName: string;
  formulaUnit: string;
  patientPackPrice: string;
  quantity: number;
  state: string;
};

type ClinicScanLine = {
  formulaId: string;
  formulaName: string;
  unit: string;
  unitsNeededCount: number;
  unitsAssignedCount: number;
};

function matchClinicPrescriptionPacks(lines: ClinicScanLine[], products: ClinicScanProduct[]) {
  return lines.map(line => {
    const candidates = products
      .filter(product => product.state === 'ACTIVE' && product.formulaId === line.formulaId && product.quantity > 0 && line.unitsNeededCount % product.quantity === 0)
      .map(product => ({
        product,
        packQuantity: line.unitsNeededCount / product.quantity,
        totalPence: curaleafMoneyPence(product.patientPackPrice, 'patient pack price') * (line.unitsNeededCount / product.quantity),
      }))
      .sort((left, right) => left.packQuantity - right.packQuantity || left.totalPence - right.totalPence || left.product.id.localeCompare(right.product.id));
    if (!candidates.length) {
      throw new HttpError(409, `Curaleaf has not supplied an active pack that exactly fulfils ${line.formulaName}. Contact your HHH administrator.`, 'CURALEAF_PACK_MATCH_UNAVAILABLE');
    }
    const best = candidates[0]!;
    const equallyRanked = candidates.filter(candidate => candidate.packQuantity === best.packQuantity && candidate.totalPence === best.totalPence);
    if (equallyRanked.length > 1) {
      throw new HttpError(409, `Curaleaf returned more than one equivalent pack for ${line.formulaName}. Contact your HHH administrator before taking payment.`, 'CURALEAF_PACK_MATCH_AMBIGUOUS');
    }
    return {
      packId: best.product.id,
      formulaId: line.formulaId,
      formulaName: line.formulaName,
      unit: line.unit,
      packSize: best.product.quantity,
      quantity: best.packQuantity,
      unitsNeededCount: line.unitsNeededCount,
      patientPackPrice: best.product.patientPackPrice,
    };
  });
}

type ClinicScanDetails = Awaited<ReturnType<typeof scanClinicPrescription>>;
type StoredClinicScanResult = {
  prescription: ClinicScanDetails['prescription'];
  prescriber: Omit<ClinicScanDetails['prescriber'], 'pin'>;
  matchedItems: ReturnType<typeof matchClinicPrescriptionPacks>;
};

function publicClinicScan(scanId: string, result: StoredClinicScanResult) {
  return {
    scanId,
    status: 'ready' as const,
    prescription: result.prescription,
    prescriber: {
      id: result.prescriber.id,
      name: result.prescriber.name,
      initials: result.prescriber.initials,
      gmcNumber: result.prescriber.gmcNumber,
      gphcNumber: result.prescriber.gphcNumber,
    },
    matchedItems: result.matchedItems,
  };
}

app.post('/v1/portal/integrations/curaleaf/prescriptions/scan', async (request, response, next) => {
  let scanDocument: DocumentReference | undefined;
  try {
    const input = z.object({ organisationId: idSchema.optional(), fileId: idSchema }).parse(request.body);
    const organisationId = tenantFor(request, input.organisationId);
    await requireSetupComplete(organisationId);
    const scanId = createHash('sha256').update(`${organisationId}:${input.fileId}:curaleaf-clinic-scan`).digest('hex');
    const document = firestore.collection('curaleafPrescriptionScans').doc(scanId);
    scanDocument = document;
    let snapshot = await document.get();
    if (snapshot.exists && snapshot.data()?.status === 'ready') {
      response.json(publicClinicScan(scanId, snapshot.data()!.result as StoredClinicScanResult));
      return;
    }
    let created = false;
    if (!snapshot.exists) {
      await document.create({
        id: scanId,
        schemaVersion: 1,
        organisationId,
        fileId: input.fileId,
        status: 'started',
        prescriptionId: null,
        createdBy: identity(request).uid,
        createdAt: timestamp(),
        updatedAt: timestamp(),
      });
      created = true;
      snapshot = await document.get();
    }
    let prescriptionId = typeof snapshot.data()?.prescriptionId === 'string' ? snapshot.data()!.prescriptionId as string : undefined;
    if (!prescriptionId) {
      if (!created) {
        if (snapshot.data()?.status === 'reconciliation_required') {
          throw new HttpError(409, 'Curaleaf may have received this barcode but did not return a reference. Contact your HHH administrator before scanning it again.', 'CURALEAF_SCAN_RECONCILIATION_REQUIRED');
        }
        if (snapshot.data()?.status === 'failed') {
          throw new HttpError(409, 'This barcode scan could not be completed. Reattach a clear prescription copy to start a new scan.', 'CURALEAF_SCAN_FAILED');
        }
        response.status(202).json({ scanId, status: 'processing' });
        return;
      }
      const file = await uploadedFile(organisationId, input.fileId);
      prescriptionId = await uploadClinicPrescriptionImage(organisationId, file);
      await document.update({ prescriptionId, status: 'processing', updatedAt: timestamp() });
    }
    let scan;
    try {
      scan = await scanClinicPrescription(organisationId, { prescriptionId });
    } catch (error) {
      if (error instanceof CuraleafRequestError && error.status === 404) {
        await document.update({ status: 'processing', updatedAt: timestamp() });
        response.status(202).json({ scanId, status: 'processing', prescriptionId });
        return;
      }
      throw error;
    }
    const productPage = await curaleafList<ClinicScanProduct>(organisationId, '/v1/products/', 'products');
    const matchedItems = matchClinicPrescriptionPacks(scan.prescription.items, productPage.records);
    const { pin: _unusedPin, ...prescriber } = scan.prescriber;
    const result: StoredClinicScanResult = { ...scan, prescriber, matchedItems };
    await document.update({ status: 'ready', result, updatedAt: timestamp() });
    await audit(request, 'curaleaf.clinic_scanned', { organisationId, recordId: scanId, prescriptionId });
    response.json(publicClinicScan(scanId, result));
  } catch (error) {
    if (scanDocument) {
      await scanDocument.set({
        status: error instanceof CuraleafRequestError && error.ambiguousWrite ? 'reconciliation_required' : 'failed',
        errorCode: error instanceof HttpError ? error.code : 'UNKNOWN',
        updatedAt: timestamp(),
      }, { merge: true }).catch(() => undefined);
    }
    next(error);
  }
});

app.get('/v1/portal/orders', async (request, response, next) => { try { const organisationId = tenantFor(request, request.query.organisationId); const records = await listTenantRecords('orders', organisationId); response.json(records); } catch (error) { next(error); } });
app.post('/v1/portal/orders', async (request, response, next) => {
  try {
    const organisationId = tenantFor(request, request.body.organisationId);
    const input = orderSchema.parse(request.body);
    const organisation = await getRecord('organisations', organisationId);
    const paymentRoute = organisation.defaultPaymentRoute === 'worldpay' ? 'worldpay' : 'manual';
    if (paymentRoute === 'worldpay') {
      const connection = await firestore.collection('integrationConnections').doc(`${organisationId}--worldpay`).get();
      if (!connection.exists || connection.data()?.status !== 'connected') {
        throw new HttpError(409, 'This pharmacy’s Worldpay route is not ready. Update payment settings before creating the order.', 'WORLDPAY_VERIFICATION_REQUIRED');
      }
    }
    const patient = await getTenantRecord('patients', input.patientId, organisationId);
    const prescriptions = await Promise.all(input.prescriptions.map(async prescription => {
      if (!prescription.clinicScanId) {
        requireMatchingPatient(prescription.patient, patient);
        return prescription;
      }
      const scan = await getTenantRecord('curaleafPrescriptionScans', prescription.clinicScanId, organisationId);
      if (scan.status !== 'ready' || !scan.result || typeof scan.result !== 'object') {
        throw new HttpError(409, 'Curaleaf has not finished reading this prescription. Wait and scan it again before taking payment.', 'CURALEAF_SCAN_NOT_READY');
      }
      const result = scan.result as StoredClinicScanResult;
      const matchedItems = z.array(z.object({
        packId: idSchema,
        formulaId: idSchema,
        quantity: z.number().int().positive().max(100),
        unitsNeededCount: z.number().int().positive().max(100),
      })).parse(result.matchedItems);
      if (!result.prescription.patient) {
        throw new HttpError(409, 'Curaleaf did not return the prescription patient’s name and date of birth. Contact your HHH administrator before taking payment.', 'PRESCRIPTION_PATIENT_UNAVAILABLE');
      }
      requireMatchingPatient(result.prescription.patient, patient);
      return orderPrescriptionSchema.parse({
        fileId: scan.fileId,
        clinicScanId: prescription.clinicScanId,
        curaleafPrescriptionId: result.prescription.id,
        serialNumber: result.prescription.serialNumber,
        issueDate: result.prescription.issueDate,
        expiryDate: result.prescription.expiryDate,
        patient: result.prescription.patient,
        prescriber: result.prescriber,
        items: matchedItems,
      });
    }));
    const prescribedItems = prescriptions.flatMap(prescription => prescription.items);
    if (prescribedItems.length && !samePackQuantities(packQuantities(input.lineItems), packQuantities(prescribedItems))) {
      throw new HttpError(400, 'The order lines must exactly match the products and quantities assigned to its prescriptions.', 'ORDER_ITEM_MISMATCH');
    }
    const [productPage, rawQuote] = await Promise.all([
      curaleafList<{ id: string; formulaId: string; formulaName: string; patientPackPrice: string; state: string }>(organisationId, '/v1/products/', 'products'),
      curaleafRequest<unknown>(organisationId, '/v1/quotes/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: input.lineItems }),
      }),
    ]);
    const parsedQuote = curaleafQuoteSchema.safeParse(rawQuote);
    if (!parsedQuote.success) {
      throw new HttpError(502, 'Curaleaf returned an invalid quote response.', 'INVALID_SUPPLIER_QUOTE');
    }
    const quote = parsedQuote.data;
    if (!samePackQuantities(packQuantities(input.lineItems), packQuantities(quote.items))) {
      throw new HttpError(409, 'Curaleaf’s quote does not match the requested products and quantities. Refresh the catalogue and try again.', 'SUPPLIER_QUOTE_MISMATCH');
    }
    const quoteByPack = new Map<string, typeof quote.items[number]>();
    quote.items.forEach(item => {
      const prior = quoteByPack.get(item.packId);
      if (prior && (
        prior.patientPackPrice !== item.patientPackPrice
        || prior.wholesalePackPrice !== item.wholesalePackPrice
        || prior.inStock !== item.inStock
      )) {
        throw new HttpError(502, 'Curaleaf returned conflicting prices for the same pack.', 'INVALID_SUPPLIER_QUOTE');
      }
      quoteByPack.set(item.packId, item);
    });
    const unavailablePack = quote.items.find(item => !item.inStock);
    if (unavailablePack) {
      throw new HttpError(409, 'One or more selected Curaleaf packs are currently unavailable. Review the prescription before taking payment.', 'PRODUCT_OUT_OF_STOCK');
    }
    const shippingPence = curaleafMoneyPence(quote.shippingPrice, 'shipping price');
    const taxRate = Number(quote.taxRate);
    if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) {
      throw new HttpError(502, 'Curaleaf returned an invalid tax rate.', 'INVALID_SUPPLIER_QUOTE');
    }
    const products = new Map(productPage.records.map(product => [product.id, product]));
    const lineItems = input.lineItems.map(item => {
      const product = products.get(item.packId);
      const quoted = quoteByPack.get(item.packId);
      if (!product) throw new HttpError(409, 'A selected Curaleaf product is no longer available. Refresh the catalogue and review the order.', 'PRODUCT_NOT_AVAILABLE');
      if (!quoted) throw new HttpError(409, 'Curaleaf did not quote one of the selected products. Refresh the catalogue and review the order.', 'SUPPLIER_QUOTE_MISMATCH');
      if (product.state !== 'ACTIVE') throw new HttpError(409, `${product.formulaName} is no longer an active Curaleaf product.`, 'PRODUCT_NOT_AVAILABLE');
      if (prescribedItems.some(prescribed => prescribed.packId === item.packId && prescribed.formulaId !== product.formulaId)) {
        throw new HttpError(409, `${product.formulaName} no longer matches the selected Curaleaf formula. Refresh the catalogue and review the prescription.`, 'FORMULA_MISMATCH');
      }
      return {
        productId: product.id,
        formulaId: product.formulaId,
        packId: product.id,
        name: product.formulaName,
        quantity: item.quantity,
        unitPricePence: curaleafMoneyPence(quoted.patientPackPrice, 'patient pack price'),
      };
    });
    const quotedAt = timestamp();
    const wholesaleProductPence = input.lineItems.reduce((total, item) => {
      const quoted = quoteByPack.get(item.packId)!;
      return total + curaleafMoneyPence(quoted.wholesalePackPrice, 'wholesale pack price') * item.quantity;
    }, 0);
    const productTotalPence = lineItems.reduce((total, item) => total + item.unitPricePence * item.quantity, 0);
    const totalPence = lineItems.reduce((total, item) => total + item.unitPricePence * item.quantity, input.dispensingFeePence);
    const { paymentRoute: _ignoredRequestedRoute, ...authoritativeInput } = input;
    const record = await createRecord('orders', {
      ...authoritativeInput,
      prescriptions,
      lineItems,
      totalPence,
      organisationId,
      paymentRoute,
      paymentRouteSnapshotAt: timestamp(),
      pricingQuote: {
        ...quote,
        quotedAt,
        environment: config.CURALEAF_BASE_URL.includes('.dev') ? 'test' : 'production',
        productTotalPence,
        wholesaleProductPence,
        shippingPence,
      },
      fulfilmentMethod: 'patient_collection',
      paymentStatus: 'pending',
      fulfilmentStatus: 'supplier_pending' satisfies FulfilmentStatus,
    });
    await audit(request, 'order.created', {
      organisationId,
      recordId: record.id,
      pricingSource: 'curaleaf_quote',
      quotedAt,
      productTotalPence,
      wholesaleProductPence,
      shippingPence,
      paymentRoute,
    });
    response.status(201).json(record);
  } catch (error) { next(error); }
});

/* ========================================================================== */
/* Post-Payment Placement Engine & Refund Routes                              */
/* ========================================================================== */

app.post('/v1/portal/orders/:id/placement/absorb', async (request, response, next) => {
  try {
    const pharmacyId = tenantFor(request, request.body.pharmacyId);
    const orderId = idSchema.parse(request.params.id);
    const { lineId } = z.object({ lineId: idSchema }).parse(request.body);

    const placementSnap = await firestore
      .collection('prescriptionPlacements')
      .where('orderId', '==', orderId)
      .get();

    if (placementSnap.empty) {
      throw new HttpError(404, 'Placement record not found for this order.', 'NOT_FOUND');
    }

    let targetPlacementDoc: DocumentReference | null = null;
    let targetPlacement: PrescriptionPlacement | null = null;

    for (const doc of placementSnap.docs) {
      const p = doc.data() as PrescriptionPlacement;
      if (p.lines.some(l => l.id === lineId)) {
        targetPlacementDoc = doc.ref;
        targetPlacement = p;
        break;
      }
    }

    if (!targetPlacementDoc || !targetPlacement) {
      throw new HttpError(404, 'Line placement not found.', 'NOT_FOUND');
    }

    const updatedLines = targetPlacement.lines.map(line => {
      if (line.id === lineId) {
        return {
          ...line,
          placementState: 'PLACED' as const,
          updatedAt: nowIso(),
        };
      }
      return line;
    });

    const allPlaced = updatedLines.every(l => l.placementState === 'PLACED');
    const newOverallState = allPlaced ? ('PLACED' as const) : targetPlacement.overallState;

    await targetPlacementDoc.update({
      lines: updatedLines,
      overallState: newOverallState,
      updatedAt: nowIso(),
    });

    await recordPlacementLedgerEvent({
      pharmacyId,
      orderId,
      prescriptionId: targetPlacement.prescriptionId,
      lineId,
      eventType: 'absorbed_placed',
      actor: identity(request).uid,
      details: { lineId, action: 'absorb_and_place' },
    });

    invalidateCollectionCache('prescriptionPlacements');
    response.json({ success: true, lineId, placementState: 'PLACED', overallState: newOverallState });
  } catch (error) { next(error); }
});

app.post('/v1/portal/orders/:id/placement/substitute', async (request, response, next) => {
  try {
    const pharmacyId = tenantFor(request, request.body.pharmacyId);
    const orderId = idSchema.parse(request.params.id);
    const { lineId, substitutePackId } = z.object({ lineId: idSchema, substitutePackId: idSchema }).parse(request.body);

    const placementSnap = await firestore
      .collection('prescriptionPlacements')
      .where('orderId', '==', orderId)
      .get();

    let targetDoc: DocumentReference | null = null;
    let targetPlacement: PrescriptionPlacement | null = null;

    for (const doc of placementSnap.docs) {
      const p = doc.data() as PrescriptionPlacement;
      if (p.lines.some(l => l.id === lineId)) {
        targetDoc = doc.ref;
        targetPlacement = p;
        break;
      }
    }

    if (!targetDoc || !targetPlacement) {
      throw new HttpError(404, 'Line placement not found.', 'NOT_FOUND');
    }

    const updatedLines = targetPlacement.lines.map(line => {
      if (line.id === lineId) {
        return {
          ...line,
          packId: substitutePackId,
          placementState: 'PLACED' as const,
          updatedAt: nowIso(),
        };
      }
      return line;
    });

    const allPlaced = updatedLines.every(l => l.placementState === 'PLACED');
    await targetDoc.update({
      lines: updatedLines,
      overallState: allPlaced ? 'PLACED' : targetPlacement.overallState,
      updatedAt: nowIso(),
    });

    await recordPlacementLedgerEvent({
      pharmacyId,
      orderId,
      prescriptionId: targetPlacement.prescriptionId,
      lineId,
      eventType: 'substituted',
      actor: identity(request).uid,
      details: { lineId, substitutePackId },
    });

    invalidateCollectionCache('prescriptionPlacements');
    response.json({ success: true, lineId, substitutePackId, placementState: 'PLACED' });
  } catch (error) { next(error); }
});

app.post('/v1/portal/orders/:id/placement/cancel-line', async (request, response, next) => {
  try {
    const pharmacyId = tenantFor(request, request.body.pharmacyId);
    const orderId = idSchema.parse(request.params.id);
    const { lineId, reason } = z.object({ lineId: idSchema, reason: z.string().trim().min(1).max(500) }).parse(request.body);

    const placementSnap = await firestore
      .collection('prescriptionPlacements')
      .where('orderId', '==', orderId)
      .get();

    let targetDoc: DocumentReference | null = null;
    let targetPlacement: PrescriptionPlacement | null = null;

    for (const doc of placementSnap.docs) {
      const p = doc.data() as PrescriptionPlacement;
      if (p.lines.some(l => l.id === lineId)) {
        targetDoc = doc.ref;
        targetPlacement = p;
        break;
      }
    }

    if (!targetDoc || !targetPlacement) {
      throw new HttpError(404, 'Line placement not found.', 'NOT_FOUND');
    }

    const line = targetPlacement.lines.find(l => l.id === lineId)!;
    const refundAmountPence = line.fixedPatientPricePence + line.allocatedDispensingFeePence;

    // Create refund record via adapter
    const refund = await refundAdapter.createRefundRecord({
      orderId,
      lineId,
      pharmacyId,
      amountPence: refundAmountPence,
      originalPaymentRef: `PAY-${orderId}`,
      paymentRoute: 'manual',
      cause: reason,
      idempotencyKey: `refund--${orderId}--${lineId}`,
    });

    const updatedLines = targetPlacement.lines.map(l => {
      if (l.id === lineId) {
        return {
          ...l,
          placementState: 'CANCELLATION_PENDING_REFUND' as const,
          refundId: refund.id,
          rejectionReason: reason,
          updatedAt: nowIso(),
        };
      }
      return l;
    });

    await targetDoc.update({
      lines: updatedLines,
      overallState: 'CANCELLATION_PENDING_REFUND',
      updatedAt: nowIso(),
    });

    await recordPlacementLedgerEvent({
      pharmacyId,
      orderId,
      prescriptionId: targetPlacement.prescriptionId,
      lineId,
      eventType: 'cancel_requested',
      actor: identity(request).uid,
      details: { lineId, reason, refundId: refund.id, refundAmountPence },
    });

    invalidateCollectionCache('prescriptionPlacements');
    response.json({ success: true, lineId, placementState: 'CANCELLATION_PENDING_REFUND', refund });
  } catch (error) { next(error); }
});

app.post('/v1/portal/orders/:id/lines/:lineId/confirm-refund', async (request, response, next) => {
  try {
    const pharmacyId = tenantFor(request, request.body.pharmacyId);
    const orderId = idSchema.parse(request.params.id);
    const lineId = idSchema.parse(request.params.lineId);

    const placementSnap = await firestore
      .collection('prescriptionPlacements')
      .where('orderId', '==', orderId)
      .get();

    let targetDoc: DocumentReference | null = null;
    let targetPlacement: PrescriptionPlacement | null = null;

    for (const doc of placementSnap.docs) {
      const p = doc.data() as PrescriptionPlacement;
      if (p.lines.some(l => l.id === lineId)) {
        targetDoc = doc.ref;
        targetPlacement = p;
        break;
      }
    }

    if (!targetDoc || !targetPlacement) {
      throw new HttpError(404, 'Line placement not found.', 'NOT_FOUND');
    }

    const line = targetPlacement.lines.find(l => l.id === lineId)!;
    if (line.refundId) {
      await refundAdapter.confirmRefund(line.refundId, identity(request).uid);
    }

    const updatedLines = targetPlacement.lines.map(l => {
      if (l.id === lineId) {
        return {
          ...l,
          placementState: 'CANCELLED_REFUNDED' as const,
          updatedAt: nowIso(),
        };
      }
      return l;
    });

    const remainingLines = updatedLines.filter(l => l.placementState !== 'CANCELLED_REFUNDED');
    const allRemainingPlaced = remainingLines.length > 0 && remainingLines.every(l => l.placementState === 'PLACED');

    await targetDoc.update({
      lines: updatedLines,
      overallState: allRemainingPlaced ? 'PLACED' : remainingLines.length === 0 ? 'CANCELLED_REFUNDED' : 'PENDING_PLACEMENT',
      updatedAt: nowIso(),
    });

    await recordPlacementLedgerEvent({
      pharmacyId,
      orderId,
      prescriptionId: targetPlacement.prescriptionId,
      lineId,
      eventType: 'refund_confirmed',
      actor: identity(request).uid,
      details: { lineId, confirmedBy: identity(request).uid },
    });

    invalidateCollectionCache('prescriptionPlacements');
    response.json({ success: true, lineId, placementState: 'CANCELLED_REFUNDED' });
  } catch (error) { next(error); }
});


app.post('/v1/portal/prescription-files/upload-url', async (request, response, next) => {
  try {
    const input = z.object({ organisationId: idSchema.optional(), filename: z.string().min(1).max(180), contentType: z.enum(PRESCRIPTION_CONTENT_TYPES), sizeBytes: z.number().int().positive().max(MAX_PRESCRIPTION_FILE_BYTES) }).parse(request.body);
    const organisationId = tenantFor(request, input.organisationId);
    const id = randomUUID();
    const filename = safeFilename(input.filename);
    const storagePath = `prescriptions/${organisationId}/${id}/${filename}`;
    const [url] = await storage.bucket().file(storagePath).getSignedUrl({ version: 'v4', action: 'write', expires: Date.now() + 15 * 60 * 1000, contentType: input.contentType });
    const record = await createRecord('prescriptionFiles', { organisationId, filename, contentType: input.contentType, expectedSizeBytes: input.sizeBytes, storagePath, status: 'upload_pending', createdBy: identity(request).uid }, id);
    await audit(request, 'prescription_file.upload_authorised', { organisationId, recordId: id, sizeBytes: input.sizeBytes, contentType: input.contentType });
    response.status(201).json({ id: record.id, uploadUrl: url, expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(), requiredHeaders: { 'Content-Type': input.contentType } });
  } catch (error) { next(error); }
});

app.post('/v1/portal/prescription-files/:id/complete', async (request, response, next) => {
  try {
    const organisationId = tenantFor(request, request.body.organisationId);
    const fileId = idSchema.parse(request.params.id);
    const record = await getTenantRecord('prescriptionFiles', fileId, organisationId);
    if (record.status === 'uploaded') return response.json({ id: fileId, status: 'uploaded' });
    if (record.status !== 'upload_pending') throw new HttpError(409, 'This prescription upload cannot be completed.', 'FILE_UNAVAILABLE');
    const contentType = z.enum(PRESCRIPTION_CONTENT_TYPES).parse(record.contentType);
    const object = storage.bucket().file(record.storagePath as string);
    const [exists] = await object.exists();
    if (!exists) throw new HttpError(409, 'Complete the prescription file upload first.', 'UPLOAD_INCOMPLETE');
    const [metadata] = await object.getMetadata();
    const actualSizeBytes = Number(metadata.size ?? 0);
    const expectedSizeBytes = Number(record.expectedSizeBytes ?? 0);
    const [signature] = await object.download({ start: 0, end: 7 });
    const valid = actualSizeBytes > 0
      && actualSizeBytes <= MAX_PRESCRIPTION_FILE_BYTES
      && actualSizeBytes === expectedSizeBytes
      && metadata.contentType === contentType
      && validPrescriptionSignature(contentType, signature);
    if (!valid) {
      await object.delete({ ignoreNotFound: true });
      await firestore.collection('prescriptionFiles').doc(fileId).update({ status: 'rejected', rejectedAt: timestamp(), updatedAt: timestamp() });
      invalidateCollectionCache('prescriptionFiles', fileId);
      await audit(request, 'prescription_file.rejected', { organisationId, recordId: fileId, expectedSizeBytes, actualSizeBytes, contentType });
      throw new HttpError(400, 'The uploaded prescription did not match the declared PDF, JPEG or PNG file.', 'INVALID_PRESCRIPTION_FILE');
    }
    await firestore.collection('prescriptionFiles').doc(fileId).update({ status: 'uploaded', sizeBytes: actualSizeBytes, verifiedAt: timestamp(), updatedAt: timestamp() });
    invalidateCollectionCache('prescriptionFiles', fileId);
    await audit(request, 'prescription_file.upload_completed', { organisationId, recordId: fileId, sizeBytes: actualSizeBytes, contentType });
    response.json({ id: fileId, status: 'uploaded' });
  } catch (error) { next(error); }
});

app.get('/v1/portal/prescription-files/:id/download-url', async (request, response, next) => {
  try {
    const organisationId = tenantFor(request, request.query.organisationId);
    const record = await getTenantRecord('prescriptionFiles', idSchema.parse(request.params.id), organisationId);
    if (record.status !== 'uploaded') throw new HttpError(409, 'Only verified prescription files can be downloaded.', 'FILE_UNAVAILABLE');
    const [url] = await storage.bucket().file(record.storagePath as string).getSignedUrl({ version: 'v4', action: 'read', expires: Date.now() + 5 * 60 * 1000 });
    await audit(request, 'prescription_file.read_authorised', { organisationId, recordId: record.id });
    response.json({ downloadUrl: url, expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString() });
  } catch (error) { next(error); }
});

app.put('/v1/portal/integrations/:integration/credentials', async (request, response, next) => {
  try {
    ensureFreshAuthentication(request);
    const integration = z.enum(['curaleaf', 'worldpay']).parse(request.params.integration) as IntegrationName;
    if (integration === 'curaleaf' && identity(request).role !== 'hhh_admin') throw new HttpError(403, 'Only HHH administrators can connect Curaleaf.', 'FORBIDDEN');
    const organisationId = tenantFor(request, request.body.organisationId);
    const credential = integration === 'curaleaf'
      ? z.object({
        customerId: z.string().trim().min(1).max(128),
        portalEmail: z.email().max(254),
        writeApiKey: z.string().trim().min(16).max(500),
        readApiKey: z.string().trim().min(16).max(500).optional(),
      }).parse(request.body)
      : z.object({
        username: z.string().trim().min(1).max(500),
        password: z.string().min(8).max(1_000),
        entityId: z.string().trim().min(1).max(200),
        webhookSecret: z.string().min(24).max(1_000),
      }).parse(request.body);
    const safeIdentifier = maskedIdentifier(integration === 'curaleaf'
      ? (credential as { customerId: string }).customerId
      : (credential as { entityId: string }).entityId);
    const stored = await writeIntegrationSecret(organisationId, integration, credential);
    const id = `${organisationId}--${integration}`;
    await firestore.collection('integrationConnections').doc(id).set({ id, schemaVersion: 1, organisationId, integration, secretName: stored.secretName, secretVersion: stored.version, status: integration === 'worldpay' ? 'verification_required' : 'configured', maskedIdentifier: safeIdentifier, updatedAt: timestamp(), updatedBy: identity(request).uid }, { merge: true });
    const status = integration === 'curaleaf'
      ? await curaleafConnectionStatus(organisationId)
      : { configured: true, connected: false, verificationRequired: true, status: 'verification_required' as const };
    if (integration === 'curaleaf') {
      const taskId = `${organisationId}--curaleaf_account`;
      await firestore.collection('setupTasks').doc(taskId).set({
        id: taskId,
        schemaVersion: 1,
        organisationId,
        taskId: 'curaleaf_account',
        completed: status.connected,
        evidence: status.connected ? `Secure Curaleaf account connected (${safeIdentifier})` : 'Credentials saved; connection verification failed',
        completedAt: status.connected ? timestamp() : null,
        completedBy: status.connected ? identity(request).uid : null,
        updatedAt: timestamp(),
      }, { merge: true });
      invalidateCache(`setup:${organisationId}`);
      await firestore.collection('integrationConnections').doc(id).set({ status: status.connected ? 'connected' : status.status === 'credential_update_required' ? 'credential_update_required' : 'attention', updatedAt: timestamp() }, { merge: true });
    }
    await audit(request, 'integration.credentials_rotated', { organisationId, integration });
    response.json({ ...status, activated: integration === 'curaleaf' ? status.connected : false, maskedIdentifier: safeIdentifier });
  } catch (error) { next(error); }
});

app.get('/v1/portal/integrations/:integration/status', async (request, response, next) => {
  try {
    const integration = z.enum(['curaleaf', 'worldpay']).parse(request.params.integration);
    const organisationId = tenantFor(request, request.query.organisationId);
    if (integration === 'curaleaf') return response.json(await curaleafConnectionStatus(organisationId));
    const snapshot = await firestore.collection('integrationConnections').doc(`${organisationId}--worldpay`).get();
    const connection = snapshot.data();
    response.json(snapshot.exists ? { configured: true, connected: connection?.status === 'connected', status: connection?.status, maskedIdentifier: connection?.maskedIdentifier, updatedAt: connection?.updatedAt } : { configured: false, connected: false });
  } catch (error) { next(error); }
});

app.get('/v1/portal/integrations/curaleaf/products', async (request, response, next) => {
  try { const organisationId = tenantFor(request, request.query.organisationId); const query = new URLSearchParams({ pageSize: String(Math.min(Number(request.query.pageSize) || 100, 500)), pageNumber: String(Math.max(Number(request.query.pageNumber) || 0, 0)) }); response.json(await curaleafRequest(organisationId, `/v1/products/?${query}`)); } catch (error) { next(error); }
});

app.get('/v1/portal/integrations/curaleaf/training/catalog', curaleafTestEnvironmentOnly, async (request, response, next) => {
  try {
    tenantFor(request, request.query.organisationId);
    response.json(await platformCuraleafCatalogue());
  } catch (error) { next(error); }
});

app.post('/v1/portal/integrations/curaleaf/training/quote', curaleafTestEnvironmentOnly, async (request, response, next) => {
  try {
    const input = z.object({
      organisationId: idSchema.optional(),
      items: z.array(z.object({ packId: idSchema, quantity: z.number().int().positive().max(100) })).min(1).max(50),
    }).parse(request.body);
    tenantFor(request, input.organisationId);
    response.json(await curaleafPlatformRequest('/v1/quotes/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: input.items }),
    }));
  } catch (error) { next(error); }
});

app.get('/v1/portal/integrations/curaleaf/catalog', async (request, response, next) => {
  try {
    const organisationId = tenantFor(request, request.query.organisationId);
    response.json(await cached(`curaleaf:catalog:${organisationId}`, 5 * 60_000, async () => {
      const [formulaPage, productPage] = await Promise.all([
        curaleafList<Record<string, unknown>>(organisationId, '/v1/formulas/', 'formulas'),
        curaleafList<Record<string, unknown>>(organisationId, '/v1/products/', 'products'),
      ]);
      return {
        environment: config.CURALEAF_BASE_URL.includes('.dev') ? 'test' : 'production',
        fetchedAt: timestamp(),
        formulas: formulaPage.records,
        products: productPage.records,
        formulaTotal: formulaPage.totalRecordCount,
        productTotal: productPage.totalRecordCount,
      };
    }));
  } catch (error) { next(error); }
});

app.get('/v1/portal/integrations/curaleaf/activity', async (request, response, next) => {
  try {
    const organisationId = tenantFor(request, request.query.organisationId);
    response.json(await cached(
      `curaleaf:activity:${organisationId}`,
      30_000,
      () => fetchCuraleafAccountSnapshot(organisationId),
    ));
  } catch (error) { next(error); }
});

app.post('/v1/portal/integrations/curaleaf/quote', async (request, response, next) => {
  try { const input = z.object({ organisationId: idSchema.optional(), items: z.array(z.object({ packId: idSchema, quantity: z.number().int().positive().max(100) })).min(1) }).parse(request.body); const organisationId = tenantFor(request, input.organisationId); response.json(await curaleafRequest(organisationId, '/v1/quotes/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: input.items }) })); } catch (error) { next(error); }
});

app.post('/v1/portal/orders/:id/curaleaf-quote-review/approve', async (request, response, next) => {
  try {
    const input = z.object({ organisationId: idSchema.optional(), note: z.string().trim().min(1).max(1000) }).parse(request.body);
    const organisationId = tenantFor(request, input.organisationId);
    const orderId = idSchema.parse(request.params.id);
    const order = await getTenantRecord('orders', orderId, organisationId);
    if (order.paymentStatus !== 'paid') throw new HttpError(409, 'Only a paid order can have a final quote approved.', 'PAYMENT_REQUIRED');
    const items = z.array(orderLineItemSchema).parse(order.lineItems).map(item => ({ packId: item.packId, quantity: item.quantity }));
    const latest = await finalCuraleafQuote(organisationId, items);
    const baseline = curaleafQuoteSchema.safeParse(order.pricingQuote);
    const differences = baseline.success ? compareQuotes(baseline.data, latest) : [];
    const fingerprint = quoteFingerprint(latest);
    const currentReview = order.quoteReview && typeof order.quoteReview === 'object' ? order.quoteReview as Record<string, unknown> : {};
    const releasable = latest.items.every(item => item.inStock) && (differences.length === 0 || differences.every(item => item.category === 'supplier_cost'));
    if (!releasable || currentReview.fingerprint !== fingerprint) {
      await requireApprovedFinalQuote(request, organisationId, orderId, order, items);
      throw new HttpError(409, 'The quote changed again and requires a fresh review.', 'QUOTE_CHANGED_AGAIN');
    }
    const quoteReview = { ...currentReview, status: 'approved', approvedFingerprint: fingerprint, approvedAt: timestamp(), approvedBy: identity(request).uid, approvalNote: input.note };
    await firestore.collection('orders').doc(orderId).update({ quoteReview, updatedAt: timestamp() });
    const operationSnapshot = await firestore.collection('integrationOperations').where('orderId', '==', orderId).get();
    await Promise.all(operationSnapshot.docs.filter(document => document.data().organisationId === organisationId && document.data().status === 'quote_review_required').map(document => document.ref.update({
      status: document.data().kind === 'barcode' ? 'awaiting_clinic_prescription' : 'awaiting_prescription_approval',
      errorCode: null,
      updatedAt: timestamp(),
    })));
    invalidateCollectionCache('orders', orderId);
    await audit(request, 'curaleaf.quote_review_approved', { organisationId, orderId, fingerprint, note: input.note });
    response.json({ orderId, quoteReview });
  } catch (error) { next(error); }
});

const curaleafSupportReasonSchema = z.enum(['prescription_exception', 'purchase_order_cancellation', 'quote_review', 'supplier_exception']);
const curaleafSupportStatusSchema = z.enum(['open', 'contacted', 'resolved']);

app.get('/v1/portal/curaleaf/support-cases', async (request, response, next) => {
  try {
    const organisationId = tenantFor(request, request.query.organisationId);
    const orderId = request.query.orderId === undefined ? undefined : idSchema.parse(request.query.orderId);
    const cases = await listTenantRecords('curaleafSupportCases', organisationId);
    response.json(orderId ? cases.filter(record => record.orderId === orderId) : cases);
  } catch (error) { next(error); }
});

app.post('/v1/portal/curaleaf/support-cases', async (request, response, next) => {
  try {
    const input = z.object({
      organisationId: idSchema.optional(),
      orderId: idSchema,
      reason: curaleafSupportReasonSchema,
      note: z.string().trim().min(1).max(2000),
      prescriptionId: idSchema.optional(),
      purchaseOrderId: idSchema.optional(),
    }).parse(request.body);
    const organisationId = tenantFor(request, input.organisationId);
    const order = await getTenantRecord('orders', input.orderId, organisationId);
    if (input.reason === 'purchase_order_cancellation') {
      const curaleaf = order.curaleaf && typeof order.curaleaf === 'object' ? order.curaleaf as Record<string, unknown> : {};
      if (curaleaf.purchaseOrderState !== 'CREATED') throw new HttpError(409, 'Curaleaf customer service can only be asked to cancel a purchase order while it remains CREATED.', 'PURCHASE_ORDER_NOT_CANCELLABLE');
    }
    const record = await createRecord('curaleafSupportCases', {
      organisationId,
      orderId: input.orderId,
      reason: input.reason,
      status: 'open',
      note: input.note,
      prescriptionId: input.prescriptionId ?? null,
      purchaseOrderId: input.purchaseOrderId ?? null,
      openedBy: identity(request).uid,
      openedByRole: identity(request).role,
      openedAt: timestamp(),
    });
    await audit(request, 'curaleaf.support_case_opened', { organisationId, orderId: input.orderId, recordId: record.id, reason: input.reason });
    response.status(201).json(record);
  } catch (error) { next(error); }
});

app.patch('/v1/portal/curaleaf/support-cases/:id', async (request, response, next) => {
  try {
    const input = z.object({ organisationId: idSchema.optional(), status: curaleafSupportStatusSchema, note: z.string().trim().min(1).max(2000) }).parse(request.body);
    const organisationId = tenantFor(request, input.organisationId);
    const caseId = idSchema.parse(request.params.id);
    await getTenantRecord('curaleafSupportCases', caseId, organisationId);
    const updated = await updateTenantRecord('curaleafSupportCases', caseId, organisationId, {
      status: input.status,
      note: input.note,
      lastUpdatedBy: identity(request).uid,
      lastUpdatedByRole: identity(request).role,
      ...(input.status === 'contacted' ? { contactedAt: timestamp(), contactedBy: identity(request).uid } : {}),
      ...(input.status === 'resolved' ? { resolvedAt: timestamp(), resolvedBy: identity(request).uid } : {}),
    });
    await audit(request, 'curaleaf.support_case_updated', { organisationId, recordId: caseId, status: input.status });
    response.json(updated);
  } catch (error) { next(error); }
});

const manualPrescriptionSchema = z.object({
  organisationId: idSchema.optional(), orderId: idSchema, subOrderId: idSchema.optional(), fileId: idSchema, serialNumber: z.string().min(1).max(200), issueDate: z.iso.date(),
  prescriber: z.object({ pin: z.string().min(1).max(100), gmcNumber: z.number().int().positive().nullable(), gphcNumber: z.string().max(100).nullable(), name: z.string().min(1).max(200), initials: z.string().min(1).max(20) }),
  items: z.array(z.object({ formulaId: idSchema, unitsNeededCount: z.number().int().positive().max(100), packId: idSchema, quantity: z.number().int().positive().max(100) })).min(1).max(50),
});
app.post('/v1/portal/integrations/curaleaf/prescriptions/manual', async (request, response, next) => {
  let operation: Awaited<ReturnType<typeof startOperation>> | undefined;
  try {
    const input = manualPrescriptionSchema.parse(request.body);
    const organisationId = tenantFor(request, input.organisationId);
    await requireSetupComplete(organisationId);
    const order = await getTenantRecord('orders', input.orderId, organisationId);
    if (order.paymentStatus !== 'paid') throw new HttpError(409, 'Payment must be confirmed before Curaleaf submission.', 'PAYMENT_REQUIRED');
    const storedPrescriptions = z.array(orderPrescriptionSchema).safeParse(order.prescriptions);
    const storedPrescription = storedPrescriptions.success && storedPrescriptions.data.length
      ? storedPrescriptions.data.find(prescription => prescription.fileId === input.fileId || prescription.serialNumber === input.serialNumber)
      : undefined;
    if (storedPrescriptions.success && storedPrescriptions.data.length && !storedPrescription) {
      throw new HttpError(409, 'The submitted prescription is not part of this saved order.', 'ORDER_PRESCRIPTION_MISMATCH');
    }
    const authoritativeInput = storedPrescription ? {
      ...input,
      fileId: storedPrescription.fileId,
      serialNumber: storedPrescription.serialNumber,
      issueDate: storedPrescription.issueDate,
      prescriber: storedPrescription.prescriber,
      items: storedPrescription.items,
    } : input;
    const quote = await requireApprovedFinalQuote(request, organisationId, input.orderId, order, authoritativeInput.items.map(({ packId, quantity }) => ({ packId, quantity })));
    operation = await startOperation(organisationId, input.orderId, 'manual', input.subOrderId);
    const file = await uploadedFile(organisationId, authoritativeInput.fileId);
    const result = await submitManualPrescription(organisationId, { ...authoritativeInput, customerReference: operation.reference, file, quote });
    const fulfilmentStatus: FulfilmentStatus = result.status === 'prescription_pending' ? 'supplier_pending' : 'supplier_processing';
    const operationStatus = result.status === 'prescription_pending' ? 'awaiting_prescription_approval' : 'purchase_order_submitted';
    await operation.document.update({
      status: operationStatus,
      result,
      prescriptionId: result.prescriptionId,
      prescriptionState: result.prescriptionState,
      prescriptionSerialNumber: authoritativeInput.serialNumber,
      items: authoritativeInput.items.map(({ packId, quantity }) => ({ packId, quantity })),
      updatedAt: timestamp(),
    });
    await firestore.collection('orders').doc(input.orderId).update({ curaleaf: result, integrationStatus: operationStatus, fulfilmentStatus, updatedAt: timestamp() });
    invalidateCollectionCache('orders', input.orderId);
    if (result.status === 'purchase_order_submitted') await activatePatientForOrder(input.orderId);
    await audit(request, 'curaleaf.manual_submitted', { organisationId, orderId: input.orderId, operationId: operation.id });
    response.status(201).json(result);
  } catch (error) { if (operation) await operation.document.update({ status: error instanceof CuraleafRequestError && error.ambiguousWrite ? 'reconciliation_required' : 'failed', errorCode: error instanceof HttpError ? error.code : 'UNKNOWN', updatedAt: timestamp() }); next(error); }
});

app.post('/v1/portal/integrations/curaleaf/prescriptions/barcode', async (request, response, next) => {
  let operation: Awaited<ReturnType<typeof startOperation>> | undefined;
  try {
    const input = z.object({ organisationId: idSchema.optional(), orderId: idSchema, subOrderId: idSchema.optional(), fileId: idSchema, serialNumber: z.string().min(1).max(200) }).parse(request.body);
    const organisationId = tenantFor(request, input.organisationId);
    await requireSetupComplete(organisationId);
    const order = await getTenantRecord('orders', input.orderId, organisationId);
    if (order.paymentStatus !== 'paid') throw new HttpError(409, 'Payment must be confirmed before Curaleaf submission.', 'PAYMENT_REQUIRED');
    const storedPrescriptions = z.array(orderPrescriptionSchema).parse(order.prescriptions);
    const storedPrescription = storedPrescriptions.find(prescription => prescription.fileId === input.fileId || prescription.serialNumber === input.serialNumber);
    if (!storedPrescription) throw new HttpError(409, 'The submitted Clinic prescription is not part of this saved order.', 'ORDER_PRESCRIPTION_MISMATCH');
    const quote = await requireApprovedFinalQuote(request, organisationId, input.orderId, order, storedPrescription.items.map(({ packId, quantity }) => ({ packId, quantity })));
    operation = await startOperation(organisationId, input.orderId, 'barcode', input.subOrderId);
    const file = storedPrescription.curaleafPrescriptionId ? undefined : await uploadedFile(organisationId, storedPrescription.fileId);
    const result = await submitClinicPrescription(organisationId, {
      prescriptionId: storedPrescription.curaleafPrescriptionId,
      serialNumber: storedPrescription.serialNumber,
      expectedPrescriberId: storedPrescription.prescriber.id,
      expectedPrescriberPin: storedPrescription.prescriber.id ? undefined : storedPrescription.prescriber.pin,
      expectedItems: storedPrescription.items.map(({ formulaId, unitsNeededCount }) => ({ formulaId, unitsNeededCount })),
      customerReference: operation.reference,
      quoteItems: storedPrescription.items.map(({ packId, quantity }) => ({ packId, quantity })),
      quote,
      file,
    });
    const needsAttention = ['prescription_mismatch', 'reconciliation_required', 'prescription_closed'].includes(result.status);
    const awaitingSupplier = ['prescription_processing', 'prescription_pending'].includes(result.status);
    const operationStatus = needsAttention ? 'reconciliation_required' : awaitingSupplier ? 'awaiting_clinic_prescription' : 'purchase_order_submitted';
    await operation.document.update({
      status: operationStatus,
      result,
      prescriptionId: 'prescriptionId' in result ? result.prescriptionId : null,
      prescriptionState: 'prescriptionState' in result ? result.prescriptionState : null,
      prescriptionSerialNumber: storedPrescription.serialNumber,
      prescriberId: storedPrescription.prescriber.id ?? null,
      prescriptionItems: storedPrescription.items.map(({ formulaId, unitsNeededCount }) => ({ formulaId, unitsNeededCount })),
      items: storedPrescription.items.map(({ packId, quantity }) => ({ packId, quantity })),
      updatedAt: timestamp(),
    });
    await firestore.collection('orders').doc(input.orderId).update({
      curaleaf: result,
      integrationStatus: operationStatus,
      fulfilmentStatus: needsAttention ? 'exception' satisfies FulfilmentStatus : awaitingSupplier ? 'supplier_pending' satisfies FulfilmentStatus : 'supplier_processing' satisfies FulfilmentStatus,
      updatedAt: timestamp(),
    });
    invalidateCollectionCache('orders', input.orderId);
    if (result.status === 'purchase_order_submitted') await activatePatientForOrder(input.orderId);
    await audit(request, needsAttention ? 'curaleaf.clinic_attention_required' : 'curaleaf.clinic_submitted', { organisationId, orderId: input.orderId, operationId: operation.id });
    response.status(needsAttention || awaitingSupplier ? 202 : 201).json(result);
  } catch (error) { if (operation) await operation.document.update({ status: error instanceof CuraleafRequestError && error.ambiguousWrite ? 'reconciliation_required' : 'failed', errorCode: error instanceof HttpError ? error.code : 'UNKNOWN', updatedAt: timestamp() }); next(error); }
});

app.post('/v1/portal/orders/:id/payments/manual', async (request, response, next) => {
  try {
    const input = z.object({ organisationId: idSchema.optional(), amountPence: z.number().int().positive(), tender: z.enum(['cash', 'epos', 'bank_transfer', 'other']), reference: z.string().trim().min(1).max(200), notes: z.string().trim().max(1000).optional() }).parse(request.body); const organisationId = tenantFor(request, input.organisationId); await requireSetupComplete(organisationId); const orderId = idSchema.parse(request.params.id); const order = await getTenantRecord('orders', orderId, organisationId); if ((order.paymentRoute ?? 'manual') !== 'manual') throw new HttpError(409, 'This order is locked to Worldpay.', 'PAYMENT_ROUTE_LOCKED'); if (input.amountPence !== order.totalPence) throw new HttpError(400, 'Payment amount must match the order total.', 'AMOUNT_MISMATCH');
    const payment = await createRecord('payments', { organisationId, orderId, route: 'manual', status: 'paid' satisfies PaymentStatus, amountPence: input.amountPence, currency: 'GBP', tender: input.tender, reference: input.reference, notes: input.notes ?? null, confirmedBy: identity(request).uid, confirmedAt: timestamp() }); await firestore.collection('orders').doc(orderId).update({ paymentStatus: 'paid', paymentId: payment.id, updatedAt: timestamp() }); invalidateCollectionCache('orders', orderId); await audit(request, 'payment.manual_confirmed', { organisationId, orderId, paymentId: payment.id, amountPence: input.amountPence }); response.status(201).json(payment);
  } catch (error) { next(error); }
});

app.post('/v1/portal/orders/:id/payments/worldpay-session', externalProviderLimit, async (request, response, next) => {
  try {
    const input = z.object({ organisationId: idSchema.optional(), successUrl: z.url(), cancelUrl: z.url() }).parse(request.body); const organisationId = tenantFor(request, input.organisationId); await requireSetupComplete(organisationId); const orderId = idSchema.parse(request.params.id); const order = await getTenantRecord('orders', orderId, organisationId); if ((order.paymentRoute ?? 'manual') !== 'worldpay') throw new HttpError(409, 'This order is locked to the pharmacy payment route.', 'PAYMENT_ROUTE_LOCKED'); const connection = await firestore.collection('integrationConnections').doc(`${organisationId}--worldpay`).get(); if (connection.data()?.status !== 'connected') throw new HttpError(409, 'This pharmacy’s Worldpay connection must be verified before taking payment.', 'WORLDPAY_VERIFICATION_REQUIRED'); if (order.paymentStatus === 'paid') throw new HttpError(409, 'This order is already paid.', 'ALREADY_PAID'); const organisation = await getRecord('organisations', organisationId); const transactionReference = `HHH-${orderId}-${randomUUID().slice(0, 8)}`; const provider = await createHostedPaymentSession(organisationId, { transactionReference, amountPence: order.totalPence as number, currency: 'GBP', successUrl: input.successUrl, cancelUrl: input.cancelUrl, statementNarrative: String(organisation.tradingName ?? organisation.name ?? 'HHH Pharmacy') }); const payment = await createRecord('payments', { organisationId, orderId, route: 'worldpay', status: 'pending' satisfies PaymentStatus, amountPence: order.totalPence, currency: 'GBP', transactionReference, providerSession: provider }); await firestore.collection('orders').doc(orderId).update({ paymentId: payment.id, paymentStatus: 'pending', updatedAt: timestamp() }); invalidateCollectionCache('orders', orderId); await audit(request, 'payment.worldpay_session_created', { organisationId, orderId, paymentId: payment.id }); response.status(201).json({ paymentId: payment.id, transactionReference, provider });
  } catch (error) { next(error); }
});

app.get('/v1/portal/shipments', async (request, response, next) => { try { const organisationId = tenantFor(request, request.query.organisationId); const records = await listTenantRecords('shipments', organisationId); response.json(records); } catch (error) { next(error); } });
app.post('/v1/portal/shipments/sync', async (request, response, next) => {
  try {
    const input = z.object({ organisationId: idSchema.optional(), pageSize: z.number().int().min(1).max(500).default(100), pageNumber: z.number().int().min(0).default(0) }).parse(request.body);
    const organisationId = tenantFor(request, input.organisationId);
    const query = new URLSearchParams({ pageSize: String(input.pageSize), pageNumber: String(input.pageNumber) });
    const supplierPage = await curaleafRequest<{ shipments: Array<Record<string, unknown>>; totalRecordCount: number }>(organisationId, `/v1/shipments/?${query}`);
    const synced = [];
    for (const raw of supplierPage.shipments) {
      const supplier = z.object({ id: idSchema, customerId: idSchema, purchaseOrderId: idSchema, purchaseOrderCustomerReference: z.string().nullable(), items: z.array(z.record(z.string(), z.unknown())), createdAt: z.string() }).parse(raw);
      const id = createHash('sha256').update(`${organisationId}:${supplier.id}`).digest('hex');
      const shipmentRef = firestore.collection('shipments').doc(id);
      const existing = await shipmentRef.get();
      await shipmentRef.set({
        id, schemaVersion: 1, organisationId, supplierShipmentId: supplier.id, purchaseOrderId: supplier.purchaseOrderId,
        customerReference: supplier.purchaseOrderCustomerReference, items: supplier.items, supplierCreatedAt: supplier.createdAt,
        ...(existing.exists ? {} : { status: 'dispatched_to_pharmacy' satisfies FulfilmentStatus, createdAt: timestamp() }),
        updatedAt: timestamp(),
      }, { merge: true });
      synced.push(id);
    }
    invalidateCollectionCache('shipments');
    await audit(request, 'shipment.synchronised', { organisationId, recordCount: synced.length });
    response.json({ syncedCount: synced.length, totalRecordCount: supplierPage.totalRecordCount, shipmentIds: synced });
  } catch (error) { next(error); }
});

app.post('/v1/portal/shipments/:id/goods-receipts', async (request, response, next) => {
  try {
    const input = z.object({ organisationId: idSchema.optional(), items: z.array(z.object({ productId: idSchema, expectedQuantity: z.number().int().nonnegative(), receivedQuantity: z.number().int().nonnegative(), batchNumber: z.string().max(100).nullable().optional(), expiryDate: z.iso.date().nullable().optional(), issue: z.enum(['short', 'damaged', 'incorrect', 'none']).default('none'), notes: z.string().max(500).optional() })).min(1), checksComplete: z.boolean().default(false) }).parse(request.body); const organisationId = tenantFor(request, input.organisationId); const shipmentId = idSchema.parse(request.params.id); await getTenantRecord('shipments', shipmentId, organisationId); const full = input.items.every(item => item.receivedQuantity >= item.expectedQuantity && item.issue === 'none'); const anyReceived = input.items.some(item => item.receivedQuantity > 0); const status: FulfilmentStatus = full ? (input.checksComplete ? 'ready_for_collection' : 'received') : anyReceived ? 'partially_received' : 'exception'; const receipt = await createRecord('goodsReceipts', { organisationId, shipmentId, items: input.items, checksComplete: input.checksComplete, status, receivedBy: identity(request).uid, receivedAt: timestamp() }); await firestore.collection('shipments').doc(shipmentId).update({ status, latestGoodsReceiptId: receipt.id, updatedAt: timestamp() }); invalidateCollectionCache('shipments', shipmentId); await audit(request, 'shipment.goods_received', { organisationId, shipmentId, receiptId: receipt.id, status }); response.status(201).json(receipt);
  } catch (error) { next(error); }
});

app.patch('/v1/portal/shipments/:id/status', async (request, response, next) => {
  try { const input = z.object({ organisationId: idSchema.optional(), status: z.enum(['ready_for_collection', 'collected', 'exception']) }).parse(request.body); const organisationId = tenantFor(request, input.organisationId); const current = await getTenantRecord('shipments', idSchema.parse(request.params.id), organisationId); if (input.status === 'ready_for_collection' && current.status !== 'received') throw new HttpError(409, 'A full goods-in receipt is required before collection readiness.', 'GOODS_IN_REQUIRED'); if (input.status === 'collected' && current.status !== 'ready_for_collection') throw new HttpError(409, 'Only ready medication can be marked collected.', 'INVALID_STATUS_TRANSITION'); const result = await updateTenantRecord('shipments', current.id as string, organisationId, { status: input.status }); await audit(request, 'shipment.status_updated', { organisationId, shipmentId: current.id, status: input.status }); response.json(result); } catch (error) { next(error); }
});

app.get('/v1/portal/admin/organisations', requireRole('hhh_admin'), async (request, response, next) => {
  try {
    const organisations = await cached('admin:organisations', 15_000, async () => {
      const [snapshot, connections] = await Promise.all([
        firestore.collection('organisations').limit(500).get(),
        firestore.collection('integrationConnections').where('integration', '==', 'curaleaf').limit(500).get(),
      ]);
      const curaleafCodes = new Map(connections.docs.map(document => [document.data().organisationId, document.data().maskedIdentifier]));
      return snapshot.docs
        .map(document => {
          const data = document.data();
          return { ...data, name: String(data.name ?? ''), tradingName: String(data.tradingName ?? data.name ?? ''), curaleafPharmacyCode: curaleafCodes.get(document.id) };
        })
        .sort((a, b) => a.tradingName.localeCompare(b.tradingName));
    });
    response.json(organisations);
  } catch (error) { next(error); }
});

app.post('/v1/portal/admin/organisations', requireRole('hhh_admin'), async (request, response, next) => {
  try {
    const input = z.object({ name: z.string().min(1).max(200), tradingName: z.string().min(1).max(200), gphcNumber: z.string().min(1).max(50), superintendent: z.string().min(1).max(200), companyNumber: z.string().trim().max(50).optional().default(''), mainContactName: z.string().trim().max(200).optional(), mainContactPhone: z.string().trim().max(50).optional().default(''), mainContactEmail: z.email().max(254).optional(), address: z.string().min(1).max(500), primaryColour: z.string().regex(/^#[0-9a-fA-F]{6}$/), logoText: z.string().min(1).max(4), websiteDomains: z.array(z.string().trim().min(1).max(253)).max(20).default([]), status: z.literal('onboarding').default('onboarding') }).parse(request.body);
    const rawReferralToken = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
    const record = await createRecord('organisations', {
      ...input,
      mainContactName: input.mainContactName ?? input.superintendent,
      mainContactEmail: input.mainContactEmail ?? '',
      platformFeeMonthly: null,
      portalName: input.name,
      modules: tenantModulesSchema.parse({ intake: true, rx: true, payments: true, supplierOrders: true, patients: true, resources: true }),
      worldpayEnabled: false,
      defaultPaymentRoute: 'manual',
      curaleafActivated: false,
      referralToken: rawReferralToken,
    });
    const referral = await createRecord('referralTokens', { organisationId: record.id, tokenHash: tokenHash(rawReferralToken), revokedAt: null, createdBy: identity(request).uid });
    invalidateCache('admin:organisations');
    await audit(request, 'organisation.created', { organisationId: record.id, referralTokenId: referral.id });
    response.status(201).json({ ...record, referralToken: rawReferralToken });
  } catch (error) { next(error); }
});

app.patch('/v1/portal/admin/organisations/:id', requireRole('hhh_admin'), async (request, response, next) => {
  try {
    const organisationId = idSchema.parse(request.params.id);
    await getRecord('organisations', organisationId);
    const input = organisationDetailsSchema.partial()
      .refine(value => Object.keys(value).length > 0, { message: 'At least one pharmacy detail must be supplied.' })
      .parse(request.body);
    const changedFields = Object.keys(input);
    const requestedPaymentRoute = input.defaultPaymentRoute ?? (input.worldpayEnabled === undefined ? undefined : input.worldpayEnabled ? 'worldpay' : 'manual');
    if (requestedPaymentRoute === 'worldpay') {
      const connection = await firestore.collection('integrationConnections').doc(`${organisationId}--worldpay`).get();
      if (!connection.exists || connection.data()?.status !== 'connected') {
        throw new HttpError(409, 'Verify this pharmacy’s Worldpay connection before making it the default payment route.', 'WORLDPAY_VERIFICATION_REQUIRED');
      }
    }
    await firestore.collection('organisations').doc(organisationId).update({
      ...input,
      ...(requestedPaymentRoute ? {
        defaultPaymentRoute: requestedPaymentRoute,
        worldpayEnabled: requestedPaymentRoute === 'worldpay',
      } : {}),
      updatedAt: timestamp(),
      updatedBy: identity(request).uid,
    });
    invalidateCollectionCache('organisations', organisationId);
    invalidateCache('admin:organisations', 'referral:');
    const record = await getRecord('organisations', organisationId);
    await audit(request, 'organisation.updated', { organisationId, changedFields });
    response.json(record);
  } catch (error) { next(error); }
});

app.get('/v1/portal/admin/staff', requireRole('hhh_admin'), async (request, response, next) => {
  try {
    const organisationId = idSchema.parse(request.query.organisationId);
    await getRecord('organisations', organisationId);
    const records = await cached(`admin:staff:${organisationId}`, 10_000, async () => {
      const snapshot = await firestore.collection('staffUsers').where('organisationId', '==', organisationId).limit(500).get();
      const staff = snapshot.docs
        .map(document => document.data())
        .filter(record => record.role === 'pharmacy_staff' && !record.deletedAt)
        .sort((a, b) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')));
      const ownerUid = staff.find(record => record.contactRole === 'owner')?.id ?? staff[0]?.id;
      return staff.map(record => ({
        uid: record.id,
        email: record.email,
        displayName: record.displayName,
        role: 'pharmacy_staff',
        organisationId,
        contactRole: record.id === ownerUid ? 'owner' : 'staff',
        status: record.status ?? 'invited',
        createdAt: record.createdAt,
      }));
    });
    response.json(records);
  } catch (error) { next(error); }
});

const patientRegisterFiltersSchema = z.object({
  query: z.string().max(300).default(''),
  organisationId: z.union([idSchema, z.literal('all')]).default('all'),
  status: z.string().max(100).default('all'),
  from: z.iso.date().nullable().default(null),
  to: z.iso.date().nullable().default(null),
});

async function adminPatientRegister(input: z.infer<typeof patientRegisterFiltersSchema>) {
    const [patientSnapshot, submissionSnapshot, organisationSnapshot] = await Promise.all([
      firestore.collection('patients').limit(20_001).get(),
      firestore.collection('eligibilitySubmissions').limit(20_001).get(),
      firestore.collection('organisations').limit(500).get(),
    ]);
    if (patientSnapshot.size > 20_000 || submissionSnapshot.size > 20_000) {
      throw new HttpError(413, 'The patient register is too large for a single CSV export. Narrow the filters and try again.', 'EXPORT_SCOPE_TOO_LARGE');
    }
    const organisations = new Map(organisationSnapshot.docs.map(document => {
      const record = document.data();
      return [document.id, { name: String(record.name ?? ''), tradingName: String(record.tradingName ?? record.name ?? ''), gphcNumber: String(record.gphcNumber ?? '') }];
    }));
    type ExportRow = { id: string; name: string; email: string; mobile: string; dob: string; organisationId: string; pharmacyName: string; gphcNumber: string; stage: string; date: string | null };
    const records = new Map<string, ExportRow>();
    patientSnapshot.docs.forEach(document => {
      const record = document.data();
      const organisationId = String(record.organisationId ?? '');
      const email = String(record.email ?? '');
      if (!organisationId || !email) return;
      const organisation = organisations.get(organisationId);
      const status = record.status === 'active' ? 'HHH approved' : record.status === 'referred' ? 'Referred' : 'Suspended';
      records.set(`${organisationId}:${email.toLowerCase()}`, {
        id: document.id,
        name: `${String(record.firstName ?? '')} ${String(record.surname ?? '')}`.trim(),
        email,
        mobile: String(record.mobile ?? ''),
        dob: String(record.dob ?? ''),
        organisationId,
        pharmacyName: organisation?.tradingName ?? organisation?.name ?? 'Unknown pharmacy',
        gphcNumber: organisation?.gphcNumber ?? '',
        stage: status,
        date: typeof record.updatedAt === 'string' ? record.updatedAt : typeof record.createdAt === 'string' ? record.createdAt : null,
      });
    });
    const submissionStatus: Record<string, string> = { new: 'New', reviewing: 'Under HHH review', approved: 'Approved', declined: 'Declined' };
    submissionSnapshot.docs.forEach(document => {
      const record = document.data();
      const organisationId = String(record.organisationId ?? '');
      const email = String(record.email ?? '');
      if (!organisationId || !email) return;
      const key = `${organisationId}:${email.toLowerCase()}`;
      const existing = records.get(key);
      const organisation = organisations.get(organisationId);
      records.set(key, {
        id: existing?.id ?? `sub-${document.id}`,
        name: `${String(record.firstName ?? '')} ${String(record.surname ?? '')}`.trim(),
        email,
        mobile: String(record.mobile ?? existing?.mobile ?? ''),
        dob: String(record.dob ?? existing?.dob ?? ''),
        organisationId,
        pharmacyName: organisation?.tradingName ?? organisation?.name ?? 'Unknown pharmacy',
        gphcNumber: organisation?.gphcNumber ?? '',
        stage: submissionStatus[String(record.status)] ?? 'New',
        date: typeof record.lastSubmittedAt === 'string' ? record.lastSubmittedAt : typeof record.createdAt === 'string' ? record.createdAt : null,
      });
    });
    const londonKey = (value: string | null) => {
      if (!value) return '';
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return '';
      const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
      const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value ?? '';
      return `${part('year')}-${part('month')}-${part('day')}`;
    };
    const query = input.query.trim().toLowerCase();
    const rows = [...records.values()].filter(record => {
      if (input.organisationId !== 'all' && record.organisationId !== input.organisationId) return false;
      if (input.status !== 'all' && record.stage !== input.status) return false;
      const date = londonKey(record.date);
      if (input.from && (!date || date < input.from)) return false;
      if (input.to && (!date || date > input.to)) return false;
      const formattedDob = /^\d{4}-\d{2}-\d{2}$/.test(record.dob) ? record.dob.split('-').reverse().join('/') : record.dob;
      return !query || `${record.name} ${record.email} ${record.mobile} ${record.dob} ${formattedDob} ${record.pharmacyName}`.toLowerCase().includes(query);
    }).sort((left, right) => left.name.localeCompare(right.name));
    const recordScopeHash = createHash('sha256').update(rows.map(row => `${row.organisationId}:${row.id}`).sort().join('|')).digest('hex');
    return { rows, resultCount: rows.length, generatedAt: timestamp(), recordScopeHash };
}

app.get('/v1/portal/admin/patient-register', requireRole('hhh_admin'), async (request, response, next) => {
  try {
    const input = patientRegisterFiltersSchema.parse({
      query: request.query.query,
      organisationId: request.query.organisationId,
      status: request.query.status,
      from: request.query.from ?? null,
      to: request.query.to ?? null,
    });
    response.json(await adminPatientRegister(input));
  } catch (error) { next(error); }
});

app.post('/v1/portal/admin/patient-exports', requireRole('hhh_admin'), async (request, response, next) => {
  try {
    const input = patientRegisterFiltersSchema.extend({ expectedScopeHash: z.string().regex(/^[a-f0-9]{64}$/) }).parse(request.body);
    const { expectedScopeHash, ...filters } = input;
    const result = await adminPatientRegister(filters);
    if (result.recordScopeHash !== expectedScopeHash) {
      throw new HttpError(409, 'The patient register changed after it was displayed. Refresh the results before exporting.', 'EXPORT_SCOPE_CHANGED');
    }
    await audit(request, 'patient_register.exported', { ...filters, resultCount: result.resultCount, recordScopeHash: result.recordScopeHash });
    response.json(result);
  } catch (error) { next(error); }
});

app.post('/v1/portal/admin/staff/invitations', requireRole('hhh_admin'), async (request, response, next) => {
  try {
    const input = z.object({
      email: z.email().transform(value => value.toLowerCase()),
      displayName: z.string().trim().min(1).max(200),
      role: z.enum(['hhh_admin', 'pharmacy_staff']),
      organisationId: idSchema.nullable(),
    }).refine(value => value.role === 'hhh_admin' ? value.organisationId === null : Boolean(value.organisationId), { message: 'Pharmacy staff require exactly one organisation.' }).parse(request.body);
    if (input.organisationId) await getRecord('organisations', input.organisationId);

    let user;
    let existingProfile: FirebaseFirestore.DocumentData | undefined;
    try {
      user = await auth.createUser({ email: input.email, displayName: input.displayName, emailVerified: false, disabled: false });
    } catch (error) {
      if (firebaseAuthErrorCode(error) !== 'auth/email-already-exists') throw error;
      user = await auth.getUserByEmail(input.email);
      const profileSnapshot = await firestore.collection('staffUsers').doc(user.uid).get();
      existingProfile = profileSnapshot.data();
      const existingRole = existingProfile?.role ?? user.customClaims?.role;
      const existingOrganisationId = existingProfile?.organisationId ?? user.customClaims?.organisationId;
      if (existingRole !== input.role || existingOrganisationId !== input.organisationId) {
        throw new HttpError(409, 'This email address already belongs to a different HHH account.', 'EMAIL_ALREADY_IN_USE');
      }
      if (existingProfile?.status === 'active') {
        throw new HttpError(409, 'This staff account is already active. Use password reset if they cannot sign in.', 'STAFF_ALREADY_ACTIVE');
      }
    }
    await auth.setCustomUserClaims(user.uid, { role: input.role, organisationId: input.organisationId });
    const createdAt = String(existingProfile?.createdAt ?? timestamp());
    let contactRole: 'owner' | 'staff' | null = null;

    if (input.role === 'pharmacy_staff' && input.organisationId) {
      const existingSnapshot = await firestore.collection('staffUsers').where('organisationId', '==', input.organisationId).limit(500).get();
      const existingStaff = existingSnapshot.docs
        .filter(document => document.data().role === 'pharmacy_staff')
        .sort((a, b) => String(a.data().createdAt ?? '').localeCompare(String(b.data().createdAt ?? '')));
      const organisationRef = firestore.collection('organisations').doc(input.organisationId);
      const staffRef = firestore.collection('staffUsers').doc(user.uid);
      await firestore.runTransaction(async transaction => {
        const organisation = await transaction.get(organisationRef);
        let ownerUid = organisation.data()?.primaryContactUid as string | undefined;
        if (!ownerUid) {
          ownerUid = existingStaff[0]?.id ?? user.uid;
          transaction.set(organisationRef, { primaryContactUid: ownerUid, updatedAt: createdAt }, { merge: true });
          if (existingStaff[0]) transaction.set(existingStaff[0].ref, { contactRole: 'owner', updatedAt: createdAt }, { merge: true });
        }
        contactRole = ownerUid === user.uid ? 'owner' : 'staff';
        transaction.set(staffRef, {
          id: user.uid,
          schemaVersion: 1,
          email: input.email,
          displayName: input.displayName,
          role: input.role,
          organisationId: input.organisationId,
          contactRole,
          status: 'invited',
          preferences: preferencesSchema.parse({ theme: 'clinical-light' }),
          createdAt,
          updatedAt: createdAt,
        }, { merge: true });
      });
    } else {
      await firestore.collection('staffUsers').doc(user.uid).set({
        id: user.uid, schemaVersion: 1, email: input.email, displayName: input.displayName, role: input.role,
        organisationId: input.organisationId, contactRole, status: 'invited', preferences: preferencesSchema.parse({ theme: 'clinical-light' }), createdAt, updatedAt: createdAt,
      });
    }

    if (input.organisationId) {
      invalidateCache(`admin:staff:${input.organisationId}`);
      invalidateCollectionCache('organisations', input.organisationId);
      invalidateCache('admin:organisations');
    }

    const firebaseLink = await auth.generatePasswordResetLink(input.email, {
      url: `${config.APP_BASE_URL.replace(/\/$/, '')}/?mode=reset-password`,
      handleCodeInApp: true,
    });
    const actionLink = firstPartyPasswordResetLink(firebaseLink);
    await audit(request, 'staff.invited', { organisationId: input.organisationId, staffUid: user.uid, role: input.role, contactRole, deliveryMode: 'firebase_client' });
    response.status(201).json({ uid: user.uid, email: input.email, displayName: input.displayName, role: input.role, organisationId: input.organisationId, contactRole, status: 'invited', createdAt, invitationQueued: false, actionLink });
  } catch (error) { next(error); }
});

app.delete('/v1/portal/admin/staff/:uid', requireRole('hhh_admin'), async (request, response, next) => {
  try {
    const uid = idSchema.parse(request.params.uid);
    const profileRef = firestore.collection('staffUsers').doc(uid);
    const profileSnapshot = await profileRef.get();
    if (!profileSnapshot.exists) throw new HttpError(404, 'Staff account not found.', 'STAFF_NOT_FOUND');
    const profile = profileSnapshot.data()!;
    if (profile.role !== 'pharmacy_staff' || !profile.organisationId) throw new HttpError(409, 'Only pharmacy staff can be removed here.', 'INVALID_STAFF_ROLE');
    const [organisationSnapshot, staffSnapshot] = await Promise.all([
      firestore.collection('organisations').doc(profile.organisationId).get(),
      firestore.collection('staffUsers').where('organisationId', '==', profile.organisationId).limit(500).get(),
    ]);
    if (!organisationSnapshot.exists) throw new HttpError(404, 'Pharmacy account not found.', 'ORGANISATION_NOT_FOUND');
    const activeStaff = staffSnapshot.docs
      .map(document => document.data())
      .filter(record => record.role === 'pharmacy_staff' && !record.deletedAt)
      .sort((left, right) => String(left.createdAt ?? '').localeCompare(String(right.createdAt ?? '')));
    const canonicalOwnerUid = organisationSnapshot.data()?.primaryContactUid
      ?? activeStaff.find(record => record.contactRole === 'owner')?.id
      ?? activeStaff[0]?.id;
    if (profile.contactRole === 'owner' || canonicalOwnerUid === uid) throw new HttpError(409, 'The pharmacy owner account cannot be removed.', 'OWNER_ACCOUNT_PROTECTED');
    await auth.updateUser(uid, { disabled: true });
    await profileRef.update({ status: 'disabled', deletedAt: timestamp(), deletedBy: identity(request).uid, updatedAt: timestamp() });
    invalidateCache(`admin:staff:${profile.organisationId}`);
    await audit(request, 'staff.removed', { organisationId: profile.organisationId, staffUid: uid, retainedForAudit: true });
    response.status(204).send();
  } catch (error) { next(error); }
});

app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  if (error instanceof z.ZodError) return response.status(400).json({ code: 'VALIDATION_ERROR', message: 'The request data is invalid.', issues: error.issues });
  if (error instanceof HttpError) {
    if (error instanceof CuraleafRequestError) {
      if (error.retryAfterSeconds !== null) response.setHeader('Retry-After', String(error.retryAfterSeconds));
      for (const [name, value] of Object.entries(error.rateLimit)) response.setHeader(name, value);
    }
    return response.status(error.status).json({ code: error.code, message: error.message, reconciliationRequired: error instanceof CuraleafRequestError ? error.ambiguousWrite : undefined });
  }
  console.error(error);
  response.status(500).json({ code: 'INTERNAL_ERROR', message: 'Internal server error.' });
});
