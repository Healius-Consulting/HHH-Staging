import {
  browserSessionPersistence,
  getMultiFactorResolver,
  multiFactor,
  onIdTokenChanged,
  reload,
  sendEmailVerification,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
  TotpMultiFactorGenerator,
  type MultiFactorError,
  type MultiFactorResolver,
  type TotpSecret,
  type User,
} from 'firebase/auth';
import { FirebaseError } from 'firebase/app';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { setApiSecurityTokenProvider } from '../shared/api';
import { getStaffAccessibilityPreferences, updateStaffAccessibilityPreferences } from '../shared/api';
import { configureAccessibilitySync, saveAccessibilityPreferences } from '../accessibility/preferences';
import { firebaseConfiguration, mfaRequired, readAppCheckToken, requireFirebaseAuth } from './firebase';
import { AuthContext, type AuthContextValue } from './AuthContext';
import type { AuthState, AuthenticatedStaff, StaffRole } from './types';
import { isLocalPortalPreview, localPreviewStaff } from '../dev/localPortalPreview';

const IDLE_LIMIT_MS = 15 * 60 * 1000;
const ABSOLUTE_LIMIT_MS = 8 * 60 * 60 * 1000;

function friendlyAuthError(error: unknown): string {
  if (!(error instanceof FirebaseError)) return error instanceof Error ? error.message : 'Authentication is unavailable.';
  const messages: Record<string, string> = {
    'auth/invalid-credential': 'Email or password not recognised.',
    'auth/invalid-email': 'Enter a valid email address.',
    'auth/too-many-requests': 'Too many attempts. Wait a few minutes and try again.',
    'auth/user-disabled': 'This staff account has been disabled. Contact an HHH administrator.',
    'auth/code-expired': 'That verification code has expired. Request a new code.',
    'auth/invalid-verification-code': 'That verification code is not valid.',
    'auth/requires-recent-login': 'Please sign in again before changing security settings.',
  };
  return messages[error.code] || error.message;
}

function hasTotp(user: User) {
  return multiFactor(user).enrolledFactors.some(factor => factor.factorId === TotpMultiFactorGenerator.FACTOR_ID);
}

async function staffFromUser(user: User): Promise<AuthenticatedStaff> {
  const token = await user.getIdTokenResult(true);
  const role = token.claims.role;
  if (role !== 'hhh_admin' && role !== 'pharmacy_staff') {
    throw new Error('This account does not have an HHH staff role. Ask an administrator to assign access.');
  }

  const organisationId = typeof token.claims.organisationId === 'string' ? token.claims.organisationId : undefined;
  if (role === 'pharmacy_staff' && !organisationId) {
    throw new Error('This pharmacy staff account is not assigned to an organisation.');
  }

  return {
    uid: user.uid,
    email: user.email || '',
    name: user.displayName || user.email?.split('@')[0] || 'Staff user',
    role: role as StaffRole,
    organisationId,
    emailVerified: user.emailVerified,
    mfaEnrolled: hasTotp(user),
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(() => isLocalPortalPreview
    ? { phase: 'authenticated', staff: localPreviewStaff, error: null, notice: null }
    : firebaseConfiguration.configured
      ? { phase: 'loading', staff: null, error: null, notice: null }
      : { phase: 'unconfigured', staff: null, error: null, notice: null });
  const mfaResolver = useRef<MultiFactorResolver | null>(null);
  const totpSecret = useRef<TotpSecret | null>(null);
  const sessionNotice = useRef<string | null>(null);
  const lastActivity = useRef(Date.now());
  const absoluteExpiry = useRef<number | null>(null);

  const signOutStaff = useCallback(async (reason?: string) => {
    if (isLocalPortalPreview) {
      window.location.assign(window.location.pathname);
      return;
    }
    if (!firebaseConfiguration.configured) return;
    sessionNotice.current = reason || 'You have signed out.';
    mfaResolver.current = null;
    totpSecret.current = null;
    await signOut(requireFirebaseAuth());
  }, []);

  useEffect(() => {
    if (isLocalPortalPreview) return;
    if (!firebaseConfiguration.configured) return;
    const auth = requireFirebaseAuth();
    void setPersistence(auth, browserSessionPersistence);

    return onIdTokenChanged(auth, async user => {
      if (!user) {
        absoluteExpiry.current = null;
        setState({ phase: 'anonymous', staff: null, error: null, notice: sessionNotice.current });
        sessionNotice.current = null;
        return;
      }

      try {
        const token = await user.getIdTokenResult();
        const authTimeSeconds = Number(token.claims.auth_time || Math.floor(Date.now() / 1000));
        absoluteExpiry.current = authTimeSeconds * 1000 + ABSOLUTE_LIMIT_MS;
        lastActivity.current = Date.now();
        const staff = await staffFromUser(user);
        if (!user.emailVerified) {
          setState({ phase: 'email-unverified', staff, error: null, notice: null });
        } else if (mfaRequired && !staff.mfaEnrolled) {
          setState({ phase: 'mfa-enrollment', staff, error: null, notice: null });
        } else {
          setState({ phase: 'authenticated', staff, error: null, notice: null });
        }
      } catch (error) {
        setState({ phase: 'error', staff: null, error: friendlyAuthError(error), notice: null });
      }
    });
  }, []);

  useEffect(() => {
    if (isLocalPortalPreview) {
      setApiSecurityTokenProvider(null);
      return;
    }
    setApiSecurityTokenProvider(async () => {
      if (!firebaseConfiguration.configured) return {};
      const user = requireFirebaseAuth().currentUser;
      if (!user) return {};
      const [idToken, appCheckToken] = await Promise.all([user.getIdToken(), readAppCheckToken()]);
      return {
        Authorization: `Bearer ${idToken}`,
        ...(appCheckToken ? { 'X-Firebase-AppCheck': appCheckToken } : {}),
      };
    });
    return () => setApiSecurityTokenProvider(null);
  }, []);

  useEffect(() => {
    let active = true;
    let preferenceSaveTimer: number | null = null;
    let pendingPreferences: Parameters<typeof updateStaffAccessibilityPreferences>[0] | null = null;
    let lastPersistedPreferences = '';
    let saveQueue = Promise.resolve();
    configureAccessibilitySync(null);
    if (isLocalPortalPreview) return () => { active = false; };
    if (state.phase !== 'authenticated') return () => { active = false; };

    const flushPreferenceSave = () => {
      if (!active || !pendingPreferences) return;
      const preferences = pendingPreferences;
      const serialised = JSON.stringify(preferences);
      pendingPreferences = null;
      preferenceSaveTimer = null;
      if (serialised === lastPersistedPreferences) return;
      saveQueue = saveQueue
        .then(() => updateStaffAccessibilityPreferences(preferences))
        .then(() => { lastPersistedPreferences = serialised; })
        .catch(error => console.warn('Accessibility preferences could not be synchronised:', error));
    };

    const enableSync = () => {
      if (!active) return;
      configureAccessibilitySync(preferences => {
        pendingPreferences = preferences;
        if (preferenceSaveTimer !== null) window.clearTimeout(preferenceSaveTimer);
        preferenceSaveTimer = window.setTimeout(flushPreferenceSave, 900);
      });
    };

    void getStaffAccessibilityPreferences()
      .then(preferences => {
        if (!active) return;
        lastPersistedPreferences = JSON.stringify(preferences);
        saveAccessibilityPreferences(preferences);
        enableSync();
      })
      .catch(enableSync);

    return () => {
      active = false;
      if (preferenceSaveTimer !== null) window.clearTimeout(preferenceSaveTimer);
      configureAccessibilitySync(null);
    };
  }, [state.phase]);

  useEffect(() => {
    if (isLocalPortalPreview) return;
    if (state.phase !== 'authenticated') return;
    const recordActivity = () => { lastActivity.current = Date.now(); };
    const events: Array<keyof WindowEventMap> = ['pointerdown', 'keydown', 'touchstart', 'focus'];
    events.forEach(event => window.addEventListener(event, recordActivity, { passive: true }));

    const timer = window.setInterval(() => {
      const now = Date.now();
      if (absoluteExpiry.current && now >= absoluteExpiry.current) {
        void signOutStaff('Your eight-hour session ended. Sign in again to continue.');
      } else if (now - lastActivity.current >= IDLE_LIMIT_MS) {
        void signOutStaff('Your session was locked after 15 minutes of inactivity.');
      }
    }, 30_000);

    return () => {
      events.forEach(event => window.removeEventListener(event, recordActivity));
      window.clearInterval(timer);
    };
  }, [signOutStaff, state.phase]);

  const signInStaff = useCallback(async (email: string, password: string) => {
    setState(current => ({ ...current, phase: 'loading', error: null, notice: null }));
    try {
      await signInWithEmailAndPassword(requireFirebaseAuth(), email.trim(), password);
    } catch (error) {
      if (error instanceof FirebaseError && error.code === 'auth/multi-factor-auth-required') {
        mfaResolver.current = getMultiFactorResolver(requireFirebaseAuth(), error as MultiFactorError);
        setState({ phase: 'mfa-challenge', staff: null, error: null, notice: null });
        return;
      }
      setState({ phase: 'anonymous', staff: null, error: friendlyAuthError(error), notice: null });
    }
  }, []);

  const completeMfaChallenge = useCallback(async (code: string) => {
    const resolver = mfaResolver.current;
    const hint = resolver?.hints.find(candidate => candidate.factorId === TotpMultiFactorGenerator.FACTOR_ID);
    if (!resolver || !hint) throw new Error('No TOTP sign-in challenge is active.');
    setState(current => ({ ...current, error: null }));
    try {
      const assertion = TotpMultiFactorGenerator.assertionForSignIn(hint.uid, code.trim());
      await resolver.resolveSignIn(assertion);
      mfaResolver.current = null;
    } catch (error) {
      setState(current => ({ ...current, error: friendlyAuthError(error) }));
      throw error;
    }
  }, []);

  const beginTotpEnrollment = useCallback(async () => {
    const user = requireFirebaseAuth().currentUser;
    if (!user) throw new Error('Sign in before enrolling an authenticator.');
    const session = await multiFactor(user).getSession();
    const secret = await TotpMultiFactorGenerator.generateSecret(session);
    totpSecret.current = secret;
    return {
      secretKey: secret.secretKey,
      qrCodeUrl: secret.generateQrCodeUrl(user.email || user.uid, 'Holistic Health Hub'),
    };
  }, []);

  const completeTotpEnrollment = useCallback(async (code: string) => {
    const user = requireFirebaseAuth().currentUser;
    if (!user || !totpSecret.current) throw new Error('Start authenticator enrolment first.');
    const assertion = TotpMultiFactorGenerator.assertionForEnrollment(totpSecret.current, code.trim());
    await multiFactor(user).enroll(assertion, 'HHH staff authenticator');
    totpSecret.current = null;
    const staff = await staffFromUser(user);
    setState({ phase: 'authenticated', staff, error: null, notice: null });
  }, []);

  const resendVerification = useCallback(async () => {
    const user = requireFirebaseAuth().currentUser;
    if (!user) throw new Error('Sign in before requesting verification.');
    await sendEmailVerification(user);
  }, []);

  const refreshVerification = useCallback(async () => {
    const user = requireFirebaseAuth().currentUser;
    if (!user) throw new Error('Sign in before checking verification.');
    await reload(user);
    await user.getIdToken(true);
    const staff = await staffFromUser(user);
    setState({
      phase: user.emailVerified ? (mfaRequired && !staff.mfaEnrolled ? 'mfa-enrollment' : 'authenticated') : 'email-unverified',
      staff,
      error: null,
      notice: null,
    });
  }, []);

  const sendPasswordReset = useCallback(async (email: string) => {
    await sendPasswordResetEmail(requireFirebaseAuth(), email.trim());
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    state,
    signIn: signInStaff,
    signOutStaff,
    sendPasswordReset,
    resendVerification,
    refreshVerification,
    beginTotpEnrollment,
    completeTotpEnrollment,
    completeMfaChallenge,
  }), [beginTotpEnrollment, completeMfaChallenge, completeTotpEnrollment, refreshVerification, resendVerification, sendPasswordReset, signInStaff, signOutStaff, state]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
