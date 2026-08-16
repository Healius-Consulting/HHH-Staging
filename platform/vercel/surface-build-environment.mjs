export const REQUIRED_FIREBASE_CLIENT_VARIABLES = Object.freeze([
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_APP_ID',
]);

export function missingSurfaceBuildVariables(surface, environment) {
  if (!['public', 'portal'].includes(surface)) return [];
  const required = environment.VITE_REQUIRE_APP_CHECK === 'true'
    ? [...REQUIRED_FIREBASE_CLIENT_VARIABLES, 'VITE_FIREBASE_APP_CHECK_SITE_KEY']
    : REQUIRED_FIREBASE_CLIENT_VARIABLES;
  return required.filter(name => !environment[name]?.trim());
}

export function invalidSurfaceBuildVariables(surface, environment) {
  if (surface !== 'portal' || !environment.VITE_ELIGIBILITY_FORM_URL?.trim()) return [];
  if (environment.VITE_ELIGIBILITY_FORM_URL.trim() === '[SENSITIVE]') return [];
  try {
    const url = new URL(environment.VITE_ELIGIBILITY_FORM_URL);
    const validProtocol = url.protocol === 'https:' || (url.protocol === 'http:' && url.hostname === 'localhost');
    return validProtocol && !url.username && !url.password && !url.hash ? [] : ['VITE_ELIGIBILITY_FORM_URL'];
  } catch {
    return ['VITE_ELIGIBILITY_FORM_URL'];
  }
}



export function assertSurfaceBuildEnvironment(surface, environment) {
  const missing = missingSurfaceBuildVariables(surface, environment);
  if (missing.length) {
    throw new Error(
      `Refusing to build the ${surface} surface without its Firebase client security configuration. Missing: ${missing.join(', ')}.`,
    );
  }
  const invalid = invalidSurfaceBuildVariables(surface, environment);
  if (invalid.length) throw new Error(`Refusing to build the ${surface} surface with invalid public URLs: ${invalid.join(', ')}.`);
}
