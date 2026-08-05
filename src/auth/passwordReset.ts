import type { ActionCodeSettings } from 'firebase/auth';

const FALLBACK_APP_URL = 'https://hhh.thinktimeless.co.uk';

export function appBaseUrl() {
  const configured = import.meta.env.VITE_APP_URL?.trim().replace(/\/$/, '');
  if (configured) return configured;
  if (typeof window !== 'undefined' && import.meta.env.DEV) return window.location.origin;
  return FALLBACK_APP_URL;
}

export function passwordResetActionSettings(): ActionCodeSettings {
  return { url: `${appBaseUrl()}/?mode=reset-password`, handleCodeInApp: true };
}
