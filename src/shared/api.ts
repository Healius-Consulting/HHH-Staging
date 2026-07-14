import type { CuraleafConnectionStatus, EligibilitySubmissionInput, EligibilitySubmissionReceipt, EligibilitySubmissionRecord, PublicPharmacy } from './contracts';

const configuredApiUrl = import.meta.env.VITE_API_BASE_URL as string | undefined;
const API_BASE_URL = (configuredApiUrl || (import.meta.env.DEV ? 'http://localhost:8080' : undefined))?.replace(/\/$/, '');

export const isApiConfigured = Boolean(API_BASE_URL);

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  if (!API_BASE_URL) throw new Error('VITE_API_BASE_URL is not configured.');
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
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
  const accessToken = (import.meta.env.VITE_PORTAL_ACCESS_TOKEN as string | undefined) || (import.meta.env.DEV ? 'hhh-local-development-token-2026' : undefined);
  if (!accessToken) return Promise.resolve<EligibilitySubmissionRecord[]>([]);
  return apiRequest<EligibilitySubmissionRecord[]>(`/v1/portal/eligibility-submissions?organisationId=${encodeURIComponent(organisationId)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export function getCuraleafConnectionStatus() {
  const accessToken = (import.meta.env.VITE_PORTAL_ACCESS_TOKEN as string | undefined) || (import.meta.env.DEV ? 'hhh-local-development-token-2026' : undefined);
  if (!accessToken) throw new Error('Portal authentication is not configured.');
  return apiRequest<CuraleafConnectionStatus>('/v1/portal/integrations/curaleaf/status', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}
