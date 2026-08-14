import type { ActionCodeSettings } from 'firebase/auth';

const FALLBACK_APP_URL = 'https://portal.hhh.thinktimeless.co.uk/pharmacy';

export function appBaseUrl() {
  const configured = import.meta.env.VITE_APP_URL?.trim().replace(/\/$/, '');
  if (configured) return configured;
  if (typeof window !== 'undefined') return window.location.origin;
  return FALLBACK_APP_URL;
}

export function passwordResetActionSettings(): ActionCodeSettings {
  return { url: `${appBaseUrl()}/reset-password`, handleCodeInApp: true };
}
