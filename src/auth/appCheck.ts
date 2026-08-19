import { getApp, getApps, initializeApp, type FirebaseOptions } from 'firebase/app';
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
const configured = Boolean(options.apiKey && options.authDomain && options.projectId && options.appId);
if (configured && typeof window !== 'undefined') {
  const app = getApps().length ? getApp() : initializeApp(options);
  const siteKey = import.meta.env.VITE_FIREBASE_APP_CHECK_SITE_KEY as string | undefined;
  if (siteKey) {
    try {
      appCheck = initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(siteKey), isTokenAutoRefreshEnabled: true });
    } catch {
      appCheck = null;
    }
  }
}

export async function readPublicAppCheckToken(): Promise<string | null> {
  if (!appCheck) return null;
  for (const forceRefresh of [false, true]) {
    try {
      return (await getToken(appCheck, forceRefresh)).token;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 400));
    }
  }
  return null;
}
