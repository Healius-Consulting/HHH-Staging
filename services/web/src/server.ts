import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

type Surface = 'public' | 'pharmacy' | 'admin';

const surface = (process.env.SURFACE ?? 'public') as Surface;
if (!['public', 'pharmacy', 'admin'].includes(surface)) throw new Error('SURFACE must be public, pharmacy, or admin.');

const staticDirectory = path.resolve(process.env.STATIC_DIR ?? '/app/static');
const indexFile = path.join(staticDirectory, 'index.html');
if (!existsSync(indexFile)) throw new Error(`Static entry point was not found at ${indexFile}.`);

if (!getApps().length) initializeApp({ credential: applicationDefault(), projectId: process.env.GOOGLE_CLOUD_PROJECT });
const auth = getAuth();
const firestore = getFirestore();
const app = express();
const port = Number(process.env.PORT ?? 8080);
const expectedHost = process.env.EXPECTED_HOST?.toLowerCase();

function cookies(request: Request) {
  const parsed: Record<string, string> = {};
  for (const item of (request.headers.cookie ?? '').split(';')) {
    const separator = item.indexOf('=');
    if (separator < 1) continue;
    try { parsed[item.slice(0, separator).trim()] = decodeURIComponent(item.slice(separator + 1)); } catch { /* malformed cookies are ignored */ }
  }
  return parsed;
}

function sessionHash(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

async function securityEvent(request: Request, event: string, details: Record<string, unknown> = {}) {
  const address = request.ip || request.socket.remoteAddress || 'unknown';
  const secret = process.env.IP_HASH_SECRET ?? 'missing-runtime-secret';
  const payload = {
    schemaVersion: 1,
    event,
    surface,
    requestId: request.get('x-request-id') ?? null,
    ipHash: createHmac('sha256', secret).update(address).digest('hex'),
    occurredAt: new Date().toISOString(),
    ...details,
  };
  console.warn(JSON.stringify(payload));
  await firestore.collection('auditLogs').add(payload).catch(() => undefined);
}

function safeReturnTo(value: string) {
  if (!value.startsWith('/') || value.startsWith('//')) return '/';
  try {
    const decoded = decodeURIComponent(decodeURIComponent(value));
    if (decoded.startsWith('//') || decoded.includes('\\') || [...decoded].some(character => character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127)) return '/';
    const parsed = new URL(value, 'https://local.invalid');
    return parsed.origin === 'https://local.invalid' ? `${parsed.pathname}${parsed.search}${parsed.hash}` : '/';
  } catch { return '/'; }
}

function securityHeaders(_request: Request, response: Response, next: NextFunction) {
  response.set({
    'Content-Security-Policy': "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' https://www.google.com https://www.gstatic.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://storage.googleapis.com; font-src 'self'; connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://firebaseappcheck.googleapis.com https://recaptchaenterprise.googleapis.com; frame-src https://www.google.com; worker-src 'self'; upgrade-insecure-requests",
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  });
  if (process.env.ENABLE_HSTS === 'true') response.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
}

async function verifyProtectedPage(request: Request, response: Response, next: NextFunction) {
  if (surface === 'public') return next();
  const sessionCookie = cookies(request)['__Host-hhh_session'];
  if (!sessionCookie) {
    void securityEvent(request, 'auth.session_rejected', { code: 'UNAUTHENTICATED' });
    return rejectPage(request, response);
  }

  let accessDenied = false;
  try {
    const decoded = await auth.verifySessionCookie(sessionCookie, true);
    const hash = sessionHash(sessionCookie);
    const record = (await firestore.collection('staffSessions').doc(hash).get()).data();
    const now = Date.now();
    const expectedRole = surface === 'pharmacy' ? 'pharmacy_staff' : 'hhh_admin';
    const hashBuffer = Buffer.from(hash);
    const storedHash = Buffer.from(String(record?.sessionHash ?? ''));
    if (!record || hashBuffer.length !== storedHash.length || !timingSafeEqual(hashBuffer, storedHash)) throw new Error('Session record mismatch');
    if (record.uid !== decoded.uid || record.surface !== surface || record.role !== expectedRole || decoded.role !== expectedRole) {
      accessDenied = true;
      throw new Error('Session scope mismatch');
    }
    if (record.revokedAt || Date.parse(record.idleExpiresAt) <= now || Date.parse(record.absoluteExpiresAt) <= now) throw new Error('Session expired');
    const staff = (await firestore.collection('staffUsers').doc(decoded.uid).get()).data();
    if (!staff || staff.disabled === true || staff.status !== 'active') throw new Error('Staff access disabled');
    const organisationId = typeof decoded.organisationId === 'string' ? decoded.organisationId : typeof decoded.pharmacyId === 'string' ? decoded.pharmacyId : null;
    const staffOrganisationId = typeof staff.organisationId === 'string' ? staff.organisationId : typeof staff.pharmacyId === 'string' ? staff.pharmacyId : null;
    if (staff.role !== decoded.role || staffOrganisationId !== organisationId) {
      accessDenied = true;
      throw new Error('Staff scope mismatch');
    }
    if (surface === 'pharmacy' && (!record.organisationId || record.organisationId !== organisationId)) {
      accessDenied = true;
      throw new Error('Tenant required');
    }
    if (now - Date.parse(record.lastActivityAt) >= 60_000) {
      const lastActivityAt = new Date(now).toISOString();
      await firestore.collection('staffSessions').doc(hash).set({ lastActivityAt, idleExpiresAt: new Date(now + 15 * 60_000).toISOString(), updatedAt: lastActivityAt }, { merge: true });
    }
    response.locals.sessionHash = hash;
    return next();
  } catch {
    if (accessDenied) {
      void securityEvent(request, 'auth.role_denied', { code: 'SURFACE_FORBIDDEN' });
      response.set('Cache-Control', 'no-store');
      return response.status(403).send('This account cannot access this workspace.');
    }
    void securityEvent(request, 'auth.session_rejected', { code: 'INVALID_OR_EXPIRED' });
    response.clearCookie('__Host-hhh_session', { secure: true, httpOnly: true, sameSite: 'strict', path: '/' });
    return rejectPage(request, response);
  }
}

function rejectPage(request: Request, response: Response) {
  const returnTo = safeReturnTo(request.originalUrl);
  response.set('Cache-Control', 'no-store');
  return response.redirect(303, `/login?returnTo=${encodeURIComponent(returnTo)}`);
}

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use((request, response, next) => {
  const incoming = request.get('x-request-id');
  const requestId = incoming && /^[A-Za-z0-9_-]{8,80}$/.test(incoming) ? incoming : randomUUID();
  request.headers['x-request-id'] = requestId;
  response.setHeader('X-Request-Id', requestId);
  next();
});
app.use(securityHeaders);
app.get('/health', (_request, response) => response.status(200).json({ ok: true, surface }));
app.use((request, response, next) => expectedHost && request.hostname.toLowerCase() !== expectedHost ? response.status(421).send('Misdirected request') : next());
app.use('/assets', express.static(path.join(staticDirectory, 'assets'), { immutable: true, maxAge: '1y', fallthrough: false }));
app.all('/v1/*splat', (_request, response) => response.status(404).json({ code: 'API_ROUTE_NOT_AVAILABLE' }));

if (surface === 'public') {
  app.get('*splat', (_request, response) => { response.set('Cache-Control', 'no-store'); response.sendFile(indexFile); });
} else {
  app.get(['/login', '/reset-password'], (_request, response) => { response.set('Cache-Control', 'no-store'); response.sendFile(indexFile); });
  app.get('*splat', verifyProtectedPage, (_request, response) => { response.set('Cache-Control', 'no-store, private'); response.sendFile(indexFile); });
}

app.use((_error: unknown, _request: Request, response: Response, _next: NextFunction) => response.status(500).send('The service is temporarily unavailable.'));
app.listen(port, '0.0.0.0');
