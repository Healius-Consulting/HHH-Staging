import type {
  CuraleafConnectionStatus,
  CuraleafActivationInput,
  CreateOrganisationInput,
  CreatedOrganisation,
  EligibilitySubmissionInput,
  EligibilitySubmissionReceipt,
  EligibilitySubmissionRecord,
  PharmacySetupStatus,
  PortalOrganisation,
  PublicPharmacy,
  SetupTaskId,
  StaffAccessibilityPreferences,
  PortalSession,
  UpdatePharmacySetupTaskInput,
} from './contracts';

const configuredApiUrl = import.meta.env.VITE_API_BASE_URL as string | undefined;
const API_BASE_URL = (configuredApiUrl || (import.meta.env.DEV ? 'http://localhost:8080' : undefined))?.replace(/\/$/, '');

export const isApiConfigured = Boolean(API_BASE_URL);

type ApiSecurityTokenProvider = () => Promise<Record<string, string>>;
let securityTokenProvider: ApiSecurityTokenProvider | null = null;

export function setApiSecurityTokenProvider(provider: ApiSecurityTokenProvider | null) {
  securityTokenProvider = provider;
}

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  if (!API_BASE_URL) throw new Error('VITE_API_BASE_URL is not configured.');
  const securityHeaders = securityTokenProvider ? await securityTokenProvider() : {};
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...securityHeaders, ...init?.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(body?.message || `Request failed with status ${response.status}.`);
  }
  return response.json() as Promise<T>;
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
