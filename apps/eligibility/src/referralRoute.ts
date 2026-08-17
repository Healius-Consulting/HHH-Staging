export type EligibilityReferralRoute =
  | { kind: 'general' }
  | { kind: 'token'; token: string }
  | { kind: 'invalid-token' };

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{12,160}$/;

export function parseEligibilityReferralRoute(search: string): EligibilityReferralRoute {
  const parameters = new URLSearchParams(search);
  if (!parameters.has('token')) return { kind: 'general' };
  const tokens = parameters.getAll('token');
  if (tokens.length !== 1) return { kind: 'invalid-token' };
  const token = tokens[0]?.trim() ?? '';
  return TOKEN_PATTERN.test(token) ? { kind: 'token', token } : { kind: 'invalid-token' };
}
