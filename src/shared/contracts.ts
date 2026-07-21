export interface PublicPharmacy {
  id: string;
  name: string;
  tradingName: string;
  logoText: string;
  gphcNumber: string;
  superintendent: string;
  address: string;
  primaryColour: string;
}

export interface EligibilitySubmissionInput {
  referralToken: string;
  firstName: string;
  surname: string;
  dob: string;
  mobile: string;
  email: string;
  postcode: string;
  condition: string;
  tried2: boolean;
  psychExclusion: boolean;
  consentReferral: boolean;
  consentShare: boolean;
  marketing: boolean;
  source: string;
}

export type EligibilitySubmissionRecord = Omit<EligibilitySubmissionInput, 'referralToken'> & {
  id: string;
  organisationId: string;
  pharmacyName: string;
  status: 'New' | 'Under HHH review' | 'Approved' | 'Declined';
  reviewedAt: string | null;
  reviewedBy: string | null;
  decisionNote: string | null;
  submittedAt: string;
};

export interface EligibilitySubmissionReceipt {
  id: string;
  organisationId: string;
  pharmacyName: string;
  submittedAt: string;
}

export interface CuraleafConnectionStatus {
  configured: boolean;
  connected: boolean;
  environment: 'test' | 'production';
  checkedAt: string;
  message?: string;
  activated?: boolean;
  maskedIdentifier?: string;
}

export interface CuraleafActivationInput {
  organisationId: string;
  customerId: string;
  portalEmail: string;
}

export interface CreateOrganisationInput {
  name: string;
  tradingName: string;
  gphcNumber: string;
  superintendent: string;
  address: string;
  primaryColour: string;
  logoText: string;
  websiteDomains: string[];
  status: 'onboarding';
}

export interface OrganisationModules {
  intake: boolean;
  rx: boolean;
  payments: boolean;
  supplierOrders: boolean;
  patients: boolean;
  resources: boolean;
}

export interface UpdateOrganisationInput {
  name?: string;
  tradingName?: string;
  gphcNumber?: string;
  superintendent?: string;
  address?: string;
  primaryColour?: string;
  logoText?: string;
  websiteDomains?: string[];
  status?: 'onboarding' | 'live' | 'paused';
  platformFeeMonthly?: number | null;
  portalName?: string;
  modules?: OrganisationModules;
}

export interface CreatedOrganisation extends CreateOrganisationInput {
  id: string;
  referralToken: string;
  createdAt: string;
  updatedAt: string;
}

export type SetupTaskId =
  | 'pharmacy_profile'
  | 'curaleaf_account'
  | 'payment_route'
  | 'pricing'
  | 'notifications'
  | 'operational_readiness';

export interface PharmacySetupTask {
  id: SetupTaskId;
  completed: boolean;
  completedAt: string | null;
  completedBy: string | null;
  evidence: string | null;
}

export interface PharmacySetupStatus {
  organisationId: string;
  completed: boolean;
  completedCount: number;
  requiredCount: number;
  tasks: PharmacySetupTask[];
  updatedAt: string;
}

export interface UpdatePharmacySetupTaskInput {
  organisationId: string;
  completed: boolean;
  evidence?: string;
}

export interface StaffAccessibilityPreferences {
  theme: 'clinical-light' | 'clinical-dark' | 'high-contrast' | 'warm-low-glare';
  textScale: 'default' | 'large' | 'larger';
  reduceMotion: boolean;
  enhancedFocus: boolean;
  underlineLinks: boolean;
}

export interface PortalOrganisation {
  id: string;
  name: string;
  tradingName: string;
  logoText: string;
  gphcNumber: string;
  superintendent: string;
  address: string;
  websiteDomains?: string[];
  primaryColour: string;
  status: 'onboarding' | 'live' | 'paused';
  referralToken?: string;
  platformFeeMonthly?: number | null;
  portalName?: string;
  modules?: OrganisationModules;
}

export interface PortalSession {
  uid: string;
  email: string | null;
  role: 'hhh_admin' | 'pharmacy_staff';
  organisationId: string | null;
  profile: Record<string, unknown> | null;
  organisation: PortalOrganisation | null;
}
