import { getApp, getApps, initializeApp, type FirebaseApp, type FirebaseOptions } from 'firebase/app';
import { getToken, initializeAppCheck, ReCaptchaEnterpriseProvider, type AppCheck } from 'firebase/app-check';

const options: FirebaseOptions = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
};

let appCheck: AppCheck | null = null;

function firebaseApp(existing?: FirebaseApp): FirebaseApp | null {
  if (existing) return existing;
  if (getApps().length) return getApp();
  if (!options.apiKey || !options.authDomain || !options.projectId || !options.appId) return null;
  return initializeApp(options);
}

export function ensureAppCheck(existing?: FirebaseApp): AppCheck | null {
  if (appCheck) return appCheck;
  if (typeof window === 'undefined') return null;
  const siteKey = import.meta.env.VITE_FIREBASE_APP_CHECK_SITE_KEY as string | undefined;
  const app = firebaseApp(existing);
  if (!siteKey || !app) return null;
  try {
    appCheck = initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(siteKey),
      isTokenAutoRefreshEnabled: true,
    });
  } catch (error) {
    console.warn('Firebase App Check could not be initialised.', error);
  }
  return appCheck;
}

export async function readAppCheckToken(): Promise<string | null> {
  const instance = ensureAppCheck();
  if (!instance) return null;
  for (const forceRefresh of [false, true]) {
    try {
      return (await getToken(instance, forceRefresh)).token;
    } catch (error) {
      console.warn('Firebase App Check token is currently unavailable.', error);
      await new Promise(resolve => setTimeout(resolve, 400));
    }
  }
  return null;
}

export const readPublicAppCheckToken = readAppCheckToken;

if (typeof window !== 'undefined') ensureAppCheck();
