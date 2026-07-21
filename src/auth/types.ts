export type StaffRole = 'hhh_admin' | 'pharmacy_staff';

export interface AuthenticatedStaff {
  uid: string;
  email: string;
  name: string;
  role: StaffRole;
  organisationId?: string;
  emailVerified: boolean;
  mfaEnrolled: boolean;
}

export type AuthPhase =
  | 'loading'
  | 'unconfigured'
  | 'anonymous'
  | 'email-unverified'
  | 'mfa-challenge'
  | 'mfa-enrollment'
  | 'authenticated'
  | 'error';

export interface AuthState {
  phase: AuthPhase;
  staff: AuthenticatedStaff | null;
  error: string | null;
  notice: string | null;
}
