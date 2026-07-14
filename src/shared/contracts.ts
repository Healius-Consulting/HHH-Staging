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
  writeConfigured: boolean;
  environment: 'test' | 'production';
  checkedAt: string;
  message: string;
}
