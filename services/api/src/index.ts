import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import { z } from 'zod';
import { allowedOrigins, config } from './config.js';
import { curaleafConnectionStatus } from './curaleaf.js';
import { db } from './db.js';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) return callback(null, true);
    callback(new Error('Origin is not permitted.'));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
}));
app.use(express.json({ limit: '64kb' }));

const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
const tokenSchema = z.string().min(16).max(160).regex(/^[A-Za-z0-9_-]+$/);
const submissionSchema = z.object({
  referralToken: tokenSchema,
  firstName: z.string().trim().min(1).max(100), surname: z.string().trim().min(1).max(100),
  dob: z.iso.date(), mobile: z.string().trim().min(7).max(30), email: z.email().max(254),
  postcode: z.string().trim().min(2).max(16), condition: z.string().trim().min(1).max(160),
  tried2: z.boolean(), psychExclusion: z.boolean(), consentReferral: z.literal(true), consentShare: z.literal(true),
  marketing: z.boolean(), source: z.string().trim().max(100),
});
const publicSubmissionLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false });

type TenantRecord = {
  id: string; name: string; tradingName: string; logoText: string; gphcNumber: string;
  superintendent: string; address: string; primaryColour: string; tokenId: string;
};
type StoredSubmission = z.infer<typeof submissionSchema> & {
  id: string; organisationId: string; pharmacyName: string; status: 'New'; reviewedAt: null; reviewedBy: null; decisionNote: null; submittedAt: string;
};

const memoryTenants = new Map<string, TenantRecord>([
  [tokenHash('hhh-leeds-7x4p9k'), { id: '11111111-1111-4111-8111-111111111111', name: 'Holistic Health Hub Pharmacy — Leeds', tradingName: 'HHH Leeds', logoText: 'HH', gphcNumber: '9012345', superintendent: 'Shaylen Patel', address: 'Leeds, West Yorkshire, United Kingdom', primaryColour: '#0f766e', tokenId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }],
  [tokenHash('emp-lincoln-3m8q2v'), { id: '22222222-2222-4222-8222-222222222222', name: 'East Midlands Pharmacy Lincoln', tradingName: 'EMP Lincoln', logoText: 'EM', gphcNumber: '9019876', superintendent: 'A. Pharmacist', address: 'Lincoln, Lincolnshire, United Kingdom', primaryColour: '#315b7d', tokenId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }],
]);
const memorySubmissions: StoredSubmission[] = [];

async function findTenant(hash: string): Promise<TenantRecord | null> {
  if (!db) return memoryTenants.get(hash) ?? null;
  const result = await db.query({
    text: `select o.id, o.name, o.trading_name, o.logo_text, o.gphc_number, o.superintendent, o.address, o.brand_primary, rt.id as token_id
           from referral_tokens rt join organisations o on o.id = rt.organisation_id
           where rt.token_hash = $1 and rt.revoked_at is null and o.status in ('live', 'onboarding') limit 1`,
    values: [hash],
  });
  const row = result.rows[0];
  return row ? { id: row.id, name: row.name, tradingName: row.trading_name, logoText: row.logo_text, gphcNumber: row.gphc_number, superintendent: row.superintendent, address: row.address, primaryColour: row.brand_primary, tokenId: row.token_id } : null;
}

app.get('/health', async (_request, response, next) => {
  try {
    if (db) await db.query('select 1');
    response.json({ status: 'ok', storage: db ? 'postgresql' : 'memory' });
  } catch (error) { next(error); }
});

app.get('/v1/public/pharmacies/by-token/:token', async (request, response, next) => {
  try {
    const token = tokenSchema.parse(request.params.token);
    const tenant = await findTenant(tokenHash(token));
    if (!tenant) return response.status(404).json({ message: 'Pharmacy link not found.' });
    response.json({ id: tenant.id, name: tenant.name, tradingName: tenant.tradingName, logoText: tenant.logoText, gphcNumber: tenant.gphcNumber, superintendent: tenant.superintendent, address: tenant.address, primaryColour: tenant.primaryColour });
  } catch (error) { next(error); }
});

app.post('/v1/public/eligibility-submissions', publicSubmissionLimit, async (request, response, next) => {
  try {
    const input = submissionSchema.parse(request.body);
    const organisation = await findTenant(tokenHash(input.referralToken));
    if (!organisation) return response.status(404).json({ message: 'Pharmacy link not found.' });
    if (!db) {
      const record: StoredSubmission = { ...input, id: randomUUID(), organisationId: organisation.id, pharmacyName: organisation.name, status: 'New', reviewedAt: null, reviewedBy: null, decisionNote: null, submittedAt: new Date().toISOString() };
      memorySubmissions.unshift(record);
      return response.status(201).json({ id: record.id, organisationId: record.organisationId, pharmacyName: record.pharmacyName, submittedAt: record.submittedAt });
    }
    const inserted = await db.query({
      text: `insert into eligibility_submissions
        (organisation_id, referral_token_id, first_name, surname, dob, mobile, email, postcode, condition,
         tried_two_treatments, psychosis_exclusion, consent_referral, consent_share, marketing_consent, source,
         consent_captured_at, request_ip, request_user_agent)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,now(),$16,$17)
        returning id, submitted_at`,
      values: [organisation.id, organisation.tokenId, input.firstName, input.surname, input.dob, input.mobile,
        input.email.toLowerCase(), input.postcode.toUpperCase(), input.condition, input.tried2, input.psychExclusion,
        input.consentReferral, input.consentShare, input.marketing, input.source, request.ip, request.get('user-agent') ?? null],
    });
    response.status(201).json({ id: inserted.rows[0].id, organisationId: organisation.id, pharmacyName: organisation.name, submittedAt: inserted.rows[0].submitted_at });
  } catch (error) { next(error); }
});

function requirePortalAccess(request: Request, response: Response, next: NextFunction) {
  if (config.NODE_ENV === 'production' || config.ALLOW_DEV_PORTAL_TOKEN !== 'true' || !config.PORTAL_API_TOKEN) {
    return response.status(501).json({ message: 'Connect the production identity provider before enabling portal API access.' });
  }
  const supplied = request.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const expected = config.PORTAL_API_TOKEN;
  const valid = supplied.length === expected.length && timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
  if (!valid) return response.status(401).json({ message: 'Unauthorised.' });
  next();
}

app.get('/v1/portal/eligibility-submissions', requirePortalAccess, async (request, response, next) => {
  try {
    const organisationId = z.uuid().parse(request.query.organisationId);
    if (!db) {
      return response.json(memorySubmissions
        .filter(record => record.organisationId === organisationId)
        .map(record => ({ ...record, referralToken: undefined })));
    }
    const result = await db.query({
      text: `select es.id, es.organisation_id, o.name as pharmacy_name, es.first_name, es.surname, es.dob, es.mobile,
                    es.email, es.postcode, es.condition, es.tried_two_treatments, es.psychosis_exclusion,
                    es.consent_referral, es.consent_share, es.marketing_consent, es.source, es.status,
                    es.reviewed_at, es.reviewed_by, es.decision_note, es.submitted_at
             from eligibility_submissions es join organisations o on o.id = es.organisation_id
             where es.organisation_id = $1 order by es.submitted_at desc limit 500`,
      values: [organisationId],
    });
    response.json(result.rows.map(row => ({
      id: row.id, organisationId: row.organisation_id, pharmacyName: row.pharmacy_name,
      firstName: row.first_name, surname: row.surname, dob: row.dob, mobile: row.mobile, email: row.email,
      postcode: row.postcode, condition: row.condition, tried2: row.tried_two_treatments,
      psychExclusion: row.psychosis_exclusion, consentReferral: row.consent_referral,
      consentShare: row.consent_share, marketing: row.marketing_consent, source: row.source,
      status: row.status, reviewedAt: row.reviewed_at, reviewedBy: row.reviewed_by,
      decisionNote: row.decision_note, submittedAt: row.submitted_at,
    })));
  } catch (error) { next(error); }
});

app.get('/v1/portal/integrations/curaleaf/status', requirePortalAccess, async (_request, response, next) => {
  try {
    response.json(await curaleafConnectionStatus());
  } catch (error) { next(error); }
});

app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  if (error instanceof z.ZodError) return response.status(400).json({ message: 'The request data is invalid.', issues: error.issues });
  console.error(error);
  response.status(500).json({ message: 'Internal server error.' });
});

const server = app.listen(config.PORT, () => console.log(`HHH API listening on port ${config.PORT}`));
const shutdown = () => server.close(() => db ? db.end().finally(() => process.exit(0)) : process.exit(0));
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
