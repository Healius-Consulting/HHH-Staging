import { getApp, getApps, initializeApp, type FirebaseApp, type FirebaseOptions } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import {
  getToken as getAppCheckToken,
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
  type AppCheck,
} from 'firebase/app-check';

const options: FirebaseOptions = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
};

const missingKeys = [
  ['VITE_FIREBASE_API_KEY', options.apiKey],
  ['VITE_FIREBASE_AUTH_DOMAIN', options.authDomain],
  ['VITE_FIREBASE_PROJECT_ID', options.projectId],
  ['VITE_FIREBASE_APP_ID', options.appId],
].filter(([, value]) => !value).map(([key]) => key as string);

export const firebaseConfiguration = {
  configured: missingKeys.length === 0,
  missingKeys,
};

// Keep MFA available in the application without forcing it in early staging.
// Set VITE_REQUIRE_MFA=true alongside REQUIRE_MFA=true on the API when HHH is
// ready to make TOTP enrolment a mandatory access control.
export const mfaRequired = import.meta.env.VITE_REQUIRE_MFA === 'true';

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let appCheck: AppCheck | null = null;

if (firebaseConfiguration.configured) {
  app = getApps().length ? getApp() : initializeApp(options);
  auth = getAuth(app);

  const siteKey = import.meta.env.VITE_FIREBASE_APP_CHECK_SITE_KEY as string | undefined;
  if (siteKey && typeof window !== 'undefined') {
    try {
      appCheck = initializeAppCheck(app, {
        provider: new ReCaptchaEnterpriseProvider(siteKey),
        isTokenAutoRefreshEnabled: true,
      });
    } catch (error) {
      console.warn('Firebase App Check could not be initialised.', error);
    }
  }
}

export function requireFirebaseAuth(): Auth {
  if (!auth) throw new Error(`Firebase is not configured. Missing: ${missingKeys.join(', ')}`);
  return auth;
}

export async function readAppCheckToken(): Promise<string | null> {
  if (!appCheck) return null;
  try {
    return (await getAppCheckToken(appCheck, false)).token;
  } catch (error) {
    console.warn('Firebase App Check token is currently unavailable.', error);
    return null;
  }
}
