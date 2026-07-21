import { createHash, randomUUID } from 'node:crypto';
import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import { z } from 'zod';
import { audit } from './audit.js';
import { identity, requireRole, requireStaff, tenantFor } from './auth.js';
import { allowedOrigins, config } from './config.js';
import { CuraleafRequestError, curaleafConnectionStatus, curaleafRequest, submitBarcodePrescription, submitManualPrescription } from './curaleaf.js';
import { appCheck, auth, firestore, storage } from './firebase.js';
import { HttpError, nowIso } from './http.js';
import { createRecord, getRecord, getTenantRecord, listTenantRecords, updateTenantRecord } from './repository.js';
import { readIntegrationSecret, writeIntegrationSecret } from './secrets.js';
import type { FulfilmentStatus, IntegrationName, PaymentStatus } from './types.js';
import { createHostedPaymentSession, reconcileWorldpayPayment, type WorldpayCredential, verifyWorldpaySignature } from './worldpay.js';

const idSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);
const tokenSchema = z.string().min(16).max(160).regex(/^[A-Za-z0-9_-]+$/);
const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
const timestamp = () => nowIso();

const setupDefinitions = [
  { id: 'pharmacy_profile', title: 'Confirm pharmacy and registered premises', required: true },
  { id: 'curaleaf_account', title: 'Verify Curaleaf customer account', required: true },
  { id: 'payment_route', title: 'Choose and verify a payment route', required: true },
  { id: 'pricing', title: 'Configure pricing and pharmacy charges', required: true },
  { id: 'notifications', title: 'Confirm notification sender and wording', required: true },
  { id: 'operational_readiness', title: 'Complete operational readiness walkthrough', required: true },
] as const;

const eligibilitySchema = z.object({
  referralToken: tokenSchema,
  firstName: z.string().trim().min(1).max(100),
  surname: z.string().trim().min(1).max(100),
  dob: z.iso.date(),
  mobile: z.string().trim().min(7).max(30),
  email: z.email().max(254),
  postcode: z.string().trim().min(2).max(16),
  condition: z.string().trim().min(1).max(160),
  tried2: z.boolean(),
  psychExclusion: z.boolean(),
  consentReferral: z.literal(true),
  consentShare: z.literal(true),
  marketing: z.boolean().default(false),
  source: z.string().trim().max(100).default(''),
});

const preferencesSchema = z.object({
  theme: z.enum(['clinical-light', 'clinical-dark', 'high-contrast', 'warm-low-glare']),
  textScale: z.enum(['default', 'large', 'larger']).default('default'),
  reduceMotion: z.boolean().default(false),
  enhancedFocus: z.boolean().default(false),
  underlineLinks: z.boolean().default(false),
});

const publicLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false });

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
  const tokens = await firestore.collection('referralTokens').where('tokenHash', '==', tokenHash(rawToken)).where('revokedAt', '==', null).limit(1).get();
  const token = tokens.docs[0]?.data();
  if (!token) throw new HttpError(404, 'Pharmacy link not found.', 'NOT_FOUND');
  const organisation = await getRecord('organisations', token.organisationId as string);
  if (!['live', 'onboarding'].includes(String(organisation.status))) throw new HttpError(404, 'Pharmacy link not found.', 'NOT_FOUND');
  return { token, organisation };
}

async function setupStatus(organisationId: string) {
  const records = await firestore.collection('setupTasks').where('organisationId', '==', organisationId).get();
  const byId = new Map(records.docs.map(document => [document.data().taskId as string, document.data()]));
  const tasks = setupDefinitions.map(definition => ({ ...definition, completed: byId.get(definition.id)?.completed === true, evidence: byId.get(definition.id)?.evidence ?? null, completedAt: byId.get(definition.id)?.completedAt ?? null, completedBy: byId.get(definition.id)?.completedBy ?? null }));
  const requiredCount = tasks.filter(task => task.required).length;
  const completedCount = tasks.filter(task => task.required && task.completed).length;
  const updatedAt = records.docs.map(document => String(document.data().updatedAt ?? '')).filter(Boolean).sort().at(-1) ?? timestamp();
  return { organisationId, completed: completedCount === requiredCount, completedCount, requiredCount, tasks, updatedAt };
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
  if (record.status !== 'uploaded' && record.status !== 'upload_pending') throw new HttpError(409, 'Prescription file is unavailable.', 'FILE_UNAVAILABLE');
  const object = storage.bucket().file(record.storagePath as string);
  const [exists] = await object.exists();
  if (!exists) throw new HttpError(409, 'Complete the prescription file upload first.', 'UPLOAD_INCOMPLETE');
  const [metadata] = await object.getMetadata();
  if (metadata.size && Number(metadata.size) > 10 * 1024 * 1024) throw new HttpError(400, 'Prescription files must be 10 MB or smaller.', 'FILE_TOO_LARGE');
  const [bytes] = await object.download();
  await firestore.collection('prescriptionFiles').doc(fileId).update({ status: 'uploaded', updatedAt: timestamp() });
  return { bytes, contentType: record.contentType as string, filename: record.filename as string };
}

async function startOperation(organisationId: string, orderId: string, kind: 'manual' | 'barcode') {
  const id = createHash('sha256').update(`${organisationId}:${orderId}:curaleaf`).digest('hex');
  const reference = `HHH-${orderId}`.slice(0, 100);
  const document = firestore.collection('integrationOperations').doc(id);
  try {
    await document.create({ id, schemaVersion: 1, organisationId, orderId, integration: 'curaleaf', kind, customerReference: reference, status: 'started', createdAt: timestamp(), updatedAt: timestamp() });
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

app.get('/health', async (_request, response, next) => {
  try {
    await firestore.collection('_health').limit(1).get();
    response.json({ status: 'ok', storage: 'firestore', region: 'us-central1', checkedAt: timestamp() });
  } catch (error) { next(error); }
});

app.get('/v1/public/pharmacies/by-token/:token', publicLimit, requirePublicAppCheck, async (request, response, next) => {
  try {
    const { organisation } = await resolveReferralToken(tokenSchema.parse(request.params.token));
    response.json({ id: organisation.id, name: organisation.name, tradingName: organisation.tradingName, logoText: organisation.logoText, gphcNumber: organisation.gphcNumber, superintendent: organisation.superintendent, address: organisation.address, primaryColour: organisation.primaryColour });
  } catch (error) { next(error); }
});

app.post('/v1/public/eligibility-submissions', publicLimit, requirePublicAppCheck, async (request, response, next) => {
  try {
    const input = eligibilitySchema.parse(request.body);
    const { token, organisation } = await resolveReferralToken(input.referralToken);
    const record = await createRecord('eligibilitySubmissions', {
      organisationId: organisation.id,
      referralTokenId: token.id,
      firstName: input.firstName,
      surname: input.surname,
      dob: input.dob,
      mobile: input.mobile,
      email: input.email.toLowerCase(),
      postcode: input.postcode.toUpperCase(),
      condition: input.condition,
      triedTwoTreatments: input.tried2,
      psychosisExclusion: input.psychExclusion,
      consentReferral: input.consentReferral,
      consentShare: input.consentShare,
      marketingConsent: input.marketing,
      source: input.source,
      consentCapturedAt: timestamp(),
      requestIp: request.ip,
      requestUserAgent: request.get('user-agent') ?? null,
      status: 'new',
    });
    await audit(request, 'eligibility.submitted', { organisationId: organisation.id, recordId: record.id });
    response.status(201).json({ id: record.id, organisationId: organisation.id, pharmacyName: organisation.name, submittedAt: record.createdAt });
  } catch (error) { next(error); }
});

app.post('/v1/public/worldpay/webhooks/:organisationId', publicLimit, async (request, response, next) => {
  try {
    const organisationId = idSchema.parse(request.params.organisationId);
    const credential = await readIntegrationSecret<WorldpayCredential>(organisationId, 'worldpay');
    if (!verifyWorldpaySignature(request.rawBody ?? Buffer.alloc(0), request.get('worldpay-signature'), credential.webhookSecret)) throw new HttpError(401, 'Webhook signature is invalid.', 'INVALID_WEBHOOK_SIGNATURE');
    const event = z.object({ eventId: z.string().min(1).max(200), transactionReference: z.string().min(1).max(200) }).passthrough().parse(request.body);
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
    if (verified) await firestore.collection('orders').doc(expected.orderId as string).update({ paymentStatus: 'paid', updatedAt: timestamp() });
    await eventRef.update({ status, updatedAt: timestamp() });
    response.status(202).json({ accepted: true, reconciled: verified });
  } catch (error) { next(error); }
});

app.use('/v1/portal', requireStaff);

app.get('/v1/portal/session', async (request, response, next) => {
  try {
    const actor = identity(request);
    const [staffSnapshot, organisation] = await Promise.all([
      firestore.collection('staffUsers').doc(actor.uid).get(),
      actor.organisationId ? getRecord('organisations', actor.organisationId) : Promise.resolve(null),
    ]);
    await audit(request, 'session.verified');
    response.json({ uid: actor.uid, email: actor.email, role: actor.role, organisationId: actor.organisationId, profile: staffSnapshot.data() ?? null, organisation });
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
    await audit(request, 'preferences.updated');
    response.json(preferences);
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
    await audit(request, 'setup.task_updated', { organisationId, taskId, completed: input.completed });
    response.json(await setupStatus(organisationId));
  } catch (error) { next(error); }
});

app.get('/v1/portal/eligibility-submissions', async (request, response, next) => {
  try {
    const organisationId = tenantFor(request, request.query.organisationId);
    const [records, organisation] = await Promise.all([listTenantRecords('eligibilitySubmissions', organisationId, 500), getRecord('organisations', organisationId)]);
    const statusLabels: Record<string, string> = { new: 'New', reviewing: 'Under HHH review', approved: 'Approved', declined: 'Declined' };
    await audit(request, 'eligibility.list_viewed', { organisationId, recordCount: records.length });
    response.json(records.map(record => ({
      id: record.id, organisationId, pharmacyName: organisation.name,
      firstName: record.firstName, surname: record.surname, dob: record.dob, mobile: record.mobile, email: record.email,
      postcode: record.postcode, condition: record.condition, tried2: record.triedTwoTreatments,
      psychExclusion: record.psychosisExclusion, consentReferral: record.consentReferral, consentShare: record.consentShare,
      marketing: record.marketingConsent, source: record.source, status: statusLabels[String(record.status)] ?? 'New',
      reviewedAt: record.reviewedAt ?? null, reviewedBy: record.reviewedBy ?? null, decisionNote: record.decisionNote ?? null,
      submittedAt: record.createdAt,
    })));
  }
  catch (error) { next(error); }
});

app.patch('/v1/portal/eligibility-submissions/:id', async (request, response, next) => {
  try {
    const input = z.object({ organisationId: idSchema.optional(), status: z.enum(['reviewing', 'approved', 'declined']), decisionNote: z.string().trim().max(2000).nullable().optional() }).parse(request.body);
    const organisationId = tenantFor(request, input.organisationId);
    const result = await updateTenantRecord('eligibilitySubmissions', idSchema.parse(request.params.id), organisationId, { status: input.status, decisionNote: input.decisionNote ?? null, reviewedAt: timestamp(), reviewedBy: identity(request).uid });
    await audit(request, 'eligibility.reviewed', { organisationId, recordId: result.id, status: input.status });
    response.json(result);
  } catch (error) { next(error); }
});

const patientSchema = z.object({ firstName: z.string().trim().min(1).max(100), surname: z.string().trim().min(1).max(100), dob: z.iso.date(), email: z.email(), mobile: z.string().trim().min(7).max(30), address: z.string().trim().max(500), postcode: z.string().trim().max(16), status: z.enum(['active', 'inactive']).default('active') });
app.get('/v1/portal/patients', async (request, response, next) => { try { const organisationId = tenantFor(request, request.query.organisationId); const records = await listTenantRecords('patients', organisationId); await audit(request, 'patient.list_viewed', { organisationId, recordCount: records.length }); response.json(records); } catch (error) { next(error); } });
app.post('/v1/portal/patients', async (request, response, next) => {
  try { const organisationId = tenantFor(request, request.body.organisationId); const record = await createRecord('patients', { ...patientSchema.parse(request.body), organisationId }); await audit(request, 'patient.created', { organisationId, recordId: record.id }); response.status(201).json(record); } catch (error) { next(error); }
});
app.patch('/v1/portal/patients/:id', async (request, response, next) => {
  try { const organisationId = tenantFor(request, request.body.organisationId); const record = await updateTenantRecord('patients', idSchema.parse(request.params.id), organisationId, patientSchema.partial().parse(request.body)); await audit(request, 'patient.updated', { organisationId, recordId: record.id }); response.json(record); } catch (error) { next(error); }
});

const lineItemSchema = z.object({ productId: z.string().min(1).max(128), formulaId: z.string().min(1).max(128), packId: z.string().min(1).max(128), name: z.string().min(1).max(200), quantity: z.number().int().positive().max(100), unitPricePence: z.number().int().nonnegative() });
const orderSchema = z.object({ patientId: idSchema, lineItems: z.array(lineItemSchema).min(1).max(50), totalPence: z.number().int().positive(), currency: z.literal('GBP').default('GBP'), paymentRoute: z.enum(['manual', 'worldpay']) });
app.get('/v1/portal/orders', async (request, response, next) => { try { const organisationId = tenantFor(request, request.query.organisationId); const records = await listTenantRecords('orders', organisationId); await audit(request, 'order.list_viewed', { organisationId, recordCount: records.length }); response.json(records); } catch (error) { next(error); } });
app.post('/v1/portal/orders', async (request, response, next) => {
  try { const organisationId = tenantFor(request, request.body.organisationId); const input = orderSchema.parse(request.body); await getTenantRecord('patients', input.patientId, organisationId); const sum = input.lineItems.reduce((total, item) => total + item.unitPricePence * item.quantity, 0); if (sum !== input.totalPence) throw new HttpError(400, 'Order total does not match its line items.', 'AMOUNT_MISMATCH'); const record = await createRecord('orders', { ...input, organisationId, paymentStatus: 'pending', fulfilmentStatus: 'supplier_pending' satisfies FulfilmentStatus }); await audit(request, 'order.created', { organisationId, recordId: record.id }); response.status(201).json(record); } catch (error) { next(error); }
});

app.post('/v1/portal/prescription-files/upload-url', async (request, response, next) => {
  try {
    const input = z.object({ organisationId: idSchema.optional(), filename: z.string().min(1).max(180), contentType: z.enum(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']) }).parse(request.body);
    const organisationId = tenantFor(request, input.organisationId);
    const id = randomUUID();
    const filename = safeFilename(input.filename);
    const storagePath = `prescriptions/${organisationId}/${id}/${filename}`;
    const record = await createRecord('prescriptionFiles', { organisationId, filename, contentType: input.contentType, storagePath, status: 'upload_pending', createdBy: identity(request).uid }, id);
    const [url] = await storage.bucket().file(storagePath).getSignedUrl({ version: 'v4', action: 'write', expires: Date.now() + 15 * 60 * 1000, contentType: input.contentType });
    await audit(request, 'prescription_file.upload_authorised', { organisationId, recordId: id });
    response.status(201).json({ id: record.id, uploadUrl: url, expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(), requiredHeaders: { 'Content-Type': input.contentType } });
  } catch (error) { next(error); }
});

app.get('/v1/portal/prescription-files/:id/download-url', async (request, response, next) => {
  try {
    const organisationId = tenantFor(request, request.query.organisationId);
    const record = await getTenantRecord('prescriptionFiles', idSchema.parse(request.params.id), organisationId);
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
      ? z.object({ customerId: z.string().min(1).max(128), portalEmail: z.email().max(254) }).parse(request.body)
      : z.object({ serviceKey: z.string().min(16).max(1000), entityId: z.string().min(1).max(200), webhookSecret: z.string().min(24).max(1000) }).parse(request.body);
    const safeIdentifier = maskedIdentifier(integration === 'curaleaf'
      ? (credential as { customerId: string }).customerId
      : (credential as { entityId: string }).entityId);
    const stored = await writeIntegrationSecret(organisationId, integration, credential);
    const id = `${organisationId}--${integration}`;
    await firestore.collection('integrationConnections').doc(id).set({ id, schemaVersion: 1, organisationId, integration, secretName: stored.secretName, secretVersion: stored.version, status: integration === 'worldpay' ? 'verification_required' : 'configured', maskedIdentifier: safeIdentifier, updatedAt: timestamp(), updatedBy: identity(request).uid }, { merge: true });
    const status = integration === 'curaleaf' ? await curaleafConnectionStatus(organisationId) : { configured: true, connected: false, verificationRequired: true };
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
      await firestore.collection('integrationConnections').doc(id).set({ status: status.connected ? 'connected' : 'attention', updatedAt: timestamp() }, { merge: true });
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

app.post('/v1/portal/integrations/curaleaf/quote', async (request, response, next) => {
  try { const input = z.object({ organisationId: idSchema.optional(), items: z.array(z.object({ packId: idSchema, quantity: z.number().int().positive().max(100) })).min(1) }).parse(request.body); const organisationId = tenantFor(request, input.organisationId); response.json(await curaleafRequest(organisationId, '/v1/quotes/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: input.items }) })); } catch (error) { next(error); }
});

const manualPrescriptionSchema = z.object({
  organisationId: idSchema.optional(), orderId: idSchema, fileId: idSchema, serialNumber: z.string().min(1).max(200), issueDate: z.iso.date(),
  prescriber: z.object({ pin: z.string().min(1).max(100), gmcNumber: z.number().int().positive().nullable(), gphcNumber: z.string().max(100).nullable(), name: z.string().min(1).max(200), initials: z.string().min(1).max(20) }),
  items: z.array(z.object({ formulaId: idSchema, unitsNeededCount: z.number().int().positive().max(100), packId: idSchema, quantity: z.number().int().positive().max(100) })).min(1).max(50),
});
app.post('/v1/portal/integrations/curaleaf/prescriptions/manual', async (request, response, next) => {
  let operation: Awaited<ReturnType<typeof startOperation>> | undefined;
  try {
    const input = manualPrescriptionSchema.parse(request.body); const organisationId = tenantFor(request, input.organisationId); await requireSetupComplete(organisationId); const order = await getTenantRecord('orders', input.orderId, organisationId); if (order.paymentStatus !== 'paid') throw new HttpError(409, 'Payment must be confirmed before Curaleaf submission.', 'PAYMENT_REQUIRED');
    operation = await startOperation(organisationId, input.orderId, 'manual'); const file = await uploadedFile(organisationId, input.fileId); const result = await submitManualPrescription(organisationId, { ...input, customerReference: operation.reference, file });
    await operation.document.update({ status: 'completed', result, updatedAt: timestamp() }); await firestore.collection('orders').doc(input.orderId).update({ curaleaf: result, fulfilmentStatus: 'supplier_processing', updatedAt: timestamp() }); await audit(request, 'curaleaf.manual_submitted', { organisationId, orderId: input.orderId, operationId: operation.id }); response.status(201).json(result);
  } catch (error) { if (operation) await operation.document.update({ status: error instanceof CuraleafRequestError && error.ambiguousWrite ? 'reconciliation_required' : 'failed', errorCode: error instanceof HttpError ? error.code : 'UNKNOWN', updatedAt: timestamp() }); next(error); }
});

app.post('/v1/portal/integrations/curaleaf/prescriptions/barcode', async (request, response, next) => {
  let operation: Awaited<ReturnType<typeof startOperation>> | undefined;
  try {
    const input = z.object({ organisationId: idSchema.optional(), orderId: idSchema, fileId: idSchema, quoteItems: z.array(z.object({ packId: idSchema, quantity: z.number().int().positive().max(100) })).min(1) }).parse(request.body); const organisationId = tenantFor(request, input.organisationId); await requireSetupComplete(organisationId); const order = await getTenantRecord('orders', input.orderId, organisationId); if (order.paymentStatus !== 'paid') throw new HttpError(409, 'Payment must be confirmed before Curaleaf submission.', 'PAYMENT_REQUIRED');
    operation = await startOperation(organisationId, input.orderId, 'barcode'); const file = await uploadedFile(organisationId, input.fileId); const result = await submitBarcodePrescription(organisationId, { customerReference: operation.reference, file, quoteItems: input.quoteItems });
    const reconciliationRequired = result.status === 'reconciliation_required';
    await operation.document.update({ status: reconciliationRequired ? 'reconciliation_required' : 'completed', result, updatedAt: timestamp() });
    await firestore.collection('orders').doc(input.orderId).update({ curaleaf: result, integrationStatus: reconciliationRequired ? 'reconciliation_required' : 'submitted', fulfilmentStatus: reconciliationRequired ? 'supplier_pending' : 'supplier_processing', updatedAt: timestamp() });
    await audit(request, reconciliationRequired ? 'curaleaf.barcode_reconciliation_required' : 'curaleaf.barcode_submitted', { organisationId, orderId: input.orderId, operationId: operation.id });
    response.status(reconciliationRequired ? 202 : 201).json(result);
  } catch (error) { if (operation) await operation.document.update({ status: error instanceof CuraleafRequestError && error.ambiguousWrite ? 'reconciliation_required' : 'failed', errorCode: error instanceof HttpError ? error.code : 'UNKNOWN', updatedAt: timestamp() }); next(error); }
});

app.post('/v1/portal/orders/:id/payments/manual', async (request, response, next) => {
  try {
    const input = z.object({ organisationId: idSchema.optional(), amountPence: z.number().int().positive(), tender: z.enum(['cash', 'epos', 'bank_transfer', 'other']), reference: z.string().trim().min(1).max(200), notes: z.string().trim().max(1000).optional() }).parse(request.body); const organisationId = tenantFor(request, input.organisationId); await requireSetupComplete(organisationId); const orderId = idSchema.parse(request.params.id); const order = await getTenantRecord('orders', orderId, organisationId); if (input.amountPence !== order.totalPence) throw new HttpError(400, 'Payment amount must match the order total.', 'AMOUNT_MISMATCH');
    const payment = await createRecord('payments', { organisationId, orderId, route: 'manual', status: 'paid' satisfies PaymentStatus, amountPence: input.amountPence, currency: 'GBP', tender: input.tender, reference: input.reference, notes: input.notes ?? null, confirmedBy: identity(request).uid, confirmedAt: timestamp() }); await firestore.collection('orders').doc(orderId).update({ paymentStatus: 'paid', paymentId: payment.id, updatedAt: timestamp() }); await audit(request, 'payment.manual_confirmed', { organisationId, orderId, paymentId: payment.id, amountPence: input.amountPence }); response.status(201).json(payment);
  } catch (error) { next(error); }
});

app.post('/v1/portal/orders/:id/payments/worldpay-session', async (request, response, next) => {
  try {
    const input = z.object({ organisationId: idSchema.optional(), successUrl: z.url(), cancelUrl: z.url() }).parse(request.body); const organisationId = tenantFor(request, input.organisationId); await requireSetupComplete(organisationId); const orderId = idSchema.parse(request.params.id); const order = await getTenantRecord('orders', orderId, organisationId); if (order.paymentStatus === 'paid') throw new HttpError(409, 'This order is already paid.', 'ALREADY_PAID'); const transactionReference = `HHH-${orderId}-${randomUUID().slice(0, 8)}`; const provider = await createHostedPaymentSession(organisationId, { transactionReference, amountPence: order.totalPence as number, currency: 'GBP', successUrl: input.successUrl, cancelUrl: input.cancelUrl }); const payment = await createRecord('payments', { organisationId, orderId, route: 'worldpay', status: 'pending' satisfies PaymentStatus, amountPence: order.totalPence, currency: 'GBP', transactionReference, providerSession: provider }); await firestore.collection('orders').doc(orderId).update({ paymentId: payment.id, paymentStatus: 'pending', updatedAt: timestamp() }); await audit(request, 'payment.worldpay_session_created', { organisationId, orderId, paymentId: payment.id }); response.status(201).json({ paymentId: payment.id, transactionReference, provider });
  } catch (error) { next(error); }
});

app.get('/v1/portal/shipments', async (request, response, next) => { try { const organisationId = tenantFor(request, request.query.organisationId); const records = await listTenantRecords('shipments', organisationId); await audit(request, 'shipment.list_viewed', { organisationId, recordCount: records.length }); response.json(records); } catch (error) { next(error); } });
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
    await audit(request, 'shipment.synchronised', { organisationId, recordCount: synced.length });
    response.json({ syncedCount: synced.length, totalRecordCount: supplierPage.totalRecordCount, shipmentIds: synced });
  } catch (error) { next(error); }
});

app.post('/v1/portal/shipments/:id/goods-receipts', async (request, response, next) => {
  try {
    const input = z.object({ organisationId: idSchema.optional(), items: z.array(z.object({ productId: idSchema, expectedQuantity: z.number().int().nonnegative(), receivedQuantity: z.number().int().nonnegative(), batchNumber: z.string().max(100).nullable().optional(), expiryDate: z.iso.date().nullable().optional(), issue: z.enum(['short', 'damaged', 'incorrect', 'none']).default('none'), notes: z.string().max(500).optional() })).min(1), checksComplete: z.boolean().default(false) }).parse(request.body); const organisationId = tenantFor(request, input.organisationId); const shipmentId = idSchema.parse(request.params.id); await getTenantRecord('shipments', shipmentId, organisationId); const full = input.items.every(item => item.receivedQuantity >= item.expectedQuantity && item.issue === 'none'); const anyReceived = input.items.some(item => item.receivedQuantity > 0); const status: FulfilmentStatus = full ? (input.checksComplete ? 'ready_for_collection' : 'received') : anyReceived ? 'partially_received' : 'exception'; const receipt = await createRecord('goodsReceipts', { organisationId, shipmentId, items: input.items, checksComplete: input.checksComplete, status, receivedBy: identity(request).uid, receivedAt: timestamp() }); await firestore.collection('shipments').doc(shipmentId).update({ status, latestGoodsReceiptId: receipt.id, updatedAt: timestamp() }); await audit(request, 'shipment.goods_received', { organisationId, shipmentId, receiptId: receipt.id, status }); response.status(201).json(receipt);
  } catch (error) { next(error); }
});

app.patch('/v1/portal/shipments/:id/status', async (request, response, next) => {
  try { const input = z.object({ organisationId: idSchema.optional(), status: z.enum(['ready_for_collection', 'collected', 'exception']) }).parse(request.body); const organisationId = tenantFor(request, input.organisationId); const current = await getTenantRecord('shipments', idSchema.parse(request.params.id), organisationId); if (input.status === 'ready_for_collection' && current.status !== 'received') throw new HttpError(409, 'A full goods-in receipt is required before collection readiness.', 'GOODS_IN_REQUIRED'); if (input.status === 'collected' && current.status !== 'ready_for_collection') throw new HttpError(409, 'Only ready medication can be marked collected.', 'INVALID_STATUS_TRANSITION'); const result = await updateTenantRecord('shipments', current.id as string, organisationId, { status: input.status }); await audit(request, 'shipment.status_updated', { organisationId, shipmentId: current.id, status: input.status }); response.json(result); } catch (error) { next(error); }
});

app.get('/v1/portal/admin/organisations', requireRole('hhh_admin'), async (request, response, next) => {
  try {
    const snapshot = await firestore.collection('organisations').limit(500).get();
    const organisations = snapshot.docs
      .map(document => document.data())
      .sort((a, b) => String(a.tradingName ?? a.name).localeCompare(String(b.tradingName ?? b.name)));
    await audit(request, 'organisation.list_viewed', { recordCount: organisations.length });
    response.json(organisations);
  } catch (error) { next(error); }
});

app.post('/v1/portal/admin/organisations', requireRole('hhh_admin'), async (request, response, next) => {
  try {
    const input = z.object({ name: z.string().min(1).max(200), tradingName: z.string().min(1).max(200), gphcNumber: z.string().min(1).max(50), superintendent: z.string().min(1).max(200), address: z.string().min(1).max(500), primaryColour: z.string().regex(/^#[0-9a-fA-F]{6}$/), logoText: z.string().min(1).max(4), websiteDomains: z.array(z.string().trim().min(1).max(253)).max(20).default([]), status: z.literal('onboarding').default('onboarding') }).parse(request.body);
    const rawReferralToken = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
    const record = await createRecord('organisations', { ...input, curaleafActivated: false, referralToken: rawReferralToken });
    const referral = await createRecord('referralTokens', { organisationId: record.id, tokenHash: tokenHash(rawReferralToken), revokedAt: null, createdBy: identity(request).uid });
    await audit(request, 'organisation.created', { organisationId: record.id, referralTokenId: referral.id });
    response.status(201).json({ ...record, referralToken: rawReferralToken });
  } catch (error) { next(error); }
});

app.post('/v1/portal/admin/staff/invitations', requireRole('hhh_admin'), async (request, response, next) => {
  try {
    const input = z.object({ email: z.email(), displayName: z.string().min(1).max(200), role: z.enum(['hhh_admin', 'pharmacy_staff']), organisationId: idSchema.nullable() }).refine(value => value.role === 'hhh_admin' ? value.organisationId === null : Boolean(value.organisationId), { message: 'Pharmacy staff require exactly one organisation.' }).parse(request.body); if (input.organisationId) await getRecord('organisations', input.organisationId); const user = await auth.createUser({ email: input.email.toLowerCase(), displayName: input.displayName, emailVerified: false, disabled: false }); await auth.setCustomUserClaims(user.uid, { role: input.role, organisationId: input.organisationId }); await firestore.collection('staffUsers').doc(user.uid).set({ id: user.uid, schemaVersion: 1, email: input.email.toLowerCase(), displayName: input.displayName, role: input.role, organisationId: input.organisationId, status: 'invited', preferences: preferencesSchema.parse({ theme: 'clinical-light' }), createdAt: timestamp(), updatedAt: timestamp() }); const actionLink = await auth.generatePasswordResetLink(input.email, { url: allowedOrigins.values().next().value ?? 'http://localhost:5173' }); await createRecord('notificationOutbox', { organisationId: input.organisationId, kind: 'staff_invitation', recipient: input.email.toLowerCase(), templateData: { displayName: input.displayName, actionLink }, status: 'pending' }); await audit(request, 'staff.invited', { organisationId: input.organisationId, staffUid: user.uid, role: input.role }); response.status(201).json({ uid: user.uid, email: input.email, role: input.role, organisationId: input.organisationId, invitationQueued: true });
  } catch (error) { next(error); }
});

app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  if (error instanceof z.ZodError) return response.status(400).json({ code: 'VALIDATION_ERROR', message: 'The request data is invalid.', issues: error.issues });
  if (error instanceof HttpError) return response.status(error.status).json({ code: error.code, message: error.message, reconciliationRequired: error instanceof CuraleafRequestError ? error.ambiguousWrite : undefined });
  console.error(error);
  response.status(500).json({ code: 'INTERNAL_ERROR', message: 'Internal server error.' });
});
