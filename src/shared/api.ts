import type {
  CuraleafConnectionStatus,
  CuraleafActivationInput,
  CreateOrganisationInput,
  CreatedOrganisation,
  EligibilitySubmissionInput,
  EligibilitySubmissionReceipt,
  EligibilitySubmissionRecord,
  PharmacySetupStatus,
  PharmacyStaffAccount,
  PharmacyStaffInvitation,
  CreatePharmacyStaffInput,
  PortalOrganisation,
  PublicPharmacy,
  SetupTaskId,
  StaffAccessibilityPreferences,
  PortalSession,
  UpdatePharmacySetupTaskInput,
  UpdateOrganisationInput,
  FormularyPriceRecord,
  UpdateFormularyPriceInput,
  PaymentSettings,
} from './contracts';

const configuredApiUrl = import.meta.env.VITE_API_BASE_URL as string | undefined;
const API_BASE_URL = (configuredApiUrl || (import.meta.env.DEV ? 'http://localhost:8080' : undefined))?.replace(/\/$/, '');

export const isApiConfigured = Boolean(API_BASE_URL);

type ApiSecurityTokenProvider = () => Promise<Record<string, string>>;
let securityTokenProvider: ApiSecurityTokenProvider | null = null;
const GET_CACHE_TTL_MS = 10_000;
const responseCache = new Map<string, { expiresAt: number; value: unknown }>();
const inFlightGets = new Map<string, { generation: number; request: Promise<unknown> }>();
let cacheGeneration = 0;

function invalidateResponseCache() {
  cacheGeneration += 1;
  responseCache.clear();
  inFlightGets.clear();
}

export function setApiSecurityTokenProvider(provider: ApiSecurityTokenProvider | null) {
  securityTokenProvider = provider;
  invalidateResponseCache();
}

async function performApiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  if (!API_BASE_URL) throw new Error('VITE_API_BASE_URL is not configured.');
  const securityHeaders = securityTokenProvider ? await securityTokenProvider() : {};
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...securityHeaders, ...init?.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { message?: string } | null;
    const retryAfter = response.headers.get('retry-after');
    const rateMessage = response.status === 429
      ? `Too many requests. Try again${retryAfter ? ` in ${retryAfter} seconds` : ' shortly'}.`
      : null;
    throw new Error(body?.message || rateMessage || `Request failed with status ${response.status}.`);
  }
  return response.json() as Promise<T>;
}

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method || 'GET').toUpperCase();
  if (method !== 'GET') {
    invalidateResponseCache();
    return performApiRequest<T>(path, init);
  }

  const cached = responseCache.get(path);
  if (cached && cached.expiresAt > Date.now()) return cached.value as T;
  if (cached) responseCache.delete(path);

  const generation = cacheGeneration;
  const existing = inFlightGets.get(path);
  if (existing?.generation === generation) return existing.request as Promise<T>;

  const request = performApiRequest<T>(path, init)
    .then(value => {
      if (cacheGeneration === generation) {
        responseCache.set(path, { value, expiresAt: Date.now() + GET_CACHE_TTL_MS });
      }
      return value;
    })
    .finally(() => {
      if (inFlightGets.get(path)?.request === request) inFlightGets.delete(path);
    });
  inFlightGets.set(path, { generation, request });
  return request;
}

export function getPublicPharmacy(referralToken: string) {
  return apiRequest<PublicPharmacy>(`/v1/public/pharmacies/by-token/${encodeURIComponent(referralToken)}`);
}

export function createEligibilitySubmission(input: EligibilitySubmissionInput) {
  return apiRequest<EligibilitySubmissionReceipt>('/v1/public/eligibility-submissions', {
    method: 'POST', body: JSON.stringify(input),
  });
}

export function getPortalEligibilitySubmissions(organisationId: string) {
  return apiRequest<EligibilitySubmissionRecord[]>(`/v1/portal/eligibility-submissions?organisationId=${encodeURIComponent(organisationId)}`);
}

export function getCuraleafConnectionStatus() {
  return apiRequest<CuraleafConnectionStatus>('/v1/portal/integrations/curaleaf/status');
}

export function activateCuraleafPharmacy(input: CuraleafActivationInput) {
  return apiRequest<CuraleafConnectionStatus>('/v1/portal/integrations/curaleaf/credentials', {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

export function createOrganisation(input: CreateOrganisationInput) {
  return apiRequest<CreatedOrganisation>('/v1/portal/admin/organisations', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function getAdminOrganisations() {
  return apiRequest<PortalOrganisation[]>('/v1/portal/admin/organisations');
}

export function updateOrganisation(organisationId: string, input: UpdateOrganisationInput) {
  return apiRequest<PortalOrganisation>(`/v1/portal/admin/organisations/${encodeURIComponent(organisationId)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function getPharmacyStaff(organisationId: string) {
  return apiRequest<PharmacyStaffAccount[]>(`/v1/portal/admin/staff?organisationId=${encodeURIComponent(organisationId)}`);
}

export function createPharmacyStaffInvitation(input: CreatePharmacyStaffInput) {
  return apiRequest<PharmacyStaffInvitation>('/v1/portal/admin/staff/invitations', {
    method: 'POST',
    body: JSON.stringify({ ...input, role: 'pharmacy_staff' }),
  });
}

export function getPharmacySetupStatus(organisationId: string) {
  return apiRequest<PharmacySetupStatus>(`/v1/portal/setup?organisationId=${encodeURIComponent(organisationId)}`);
}

export function updatePharmacySetupTask(taskId: SetupTaskId, input: UpdatePharmacySetupTaskInput) {
  return apiRequest<PharmacySetupStatus>(`/v1/portal/setup/${encodeURIComponent(taskId)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function getStaffAccessibilityPreferences() {
  return apiRequest<StaffAccessibilityPreferences>('/v1/portal/preferences');
}

export function getPortalSession() {
  return apiRequest<PortalSession>('/v1/portal/session');
}

export function updateStaffAccessibilityPreferences(preferences: StaffAccessibilityPreferences) {
  return apiRequest<StaffAccessibilityPreferences>('/v1/portal/preferences', {
    method: 'PATCH',
    body: JSON.stringify(preferences),
  });
}

export function getFormularyPrices(organisationId: string) {
  return apiRequest<FormularyPriceRecord[]>(`/v1/portal/formulary-pricing?organisationId=${encodeURIComponent(organisationId)}`);
}

export function updateFormularyPrices(organisationId: string, prices: UpdateFormularyPriceInput[]) {
  return apiRequest<FormularyPriceRecord[]>('/v1/portal/formulary-pricing', {
    method: 'PUT',
    body: JSON.stringify({ organisationId, prices }),
  });
}

export function updatePaymentSettings(organisationId: string, worldpayEnabled: boolean) {
  return apiRequest<PaymentSettings>('/v1/portal/payment-settings', {
    method: 'PUT',
    body: JSON.stringify({ organisationId, worldpayEnabled }),
  });
}
