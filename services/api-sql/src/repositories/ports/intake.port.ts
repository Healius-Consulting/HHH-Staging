export interface CreateSubmissionInput {
  sourceOrganisationId?: string | null;
  assignedOrganisationId?: string | null;
  sourceType: 'GENERAL_HHH_WEBSITE' | 'PHARMACY_QR' | 'LEGACY_PHARMACY_QR';
  firstName: string;
  surname: string;
  dob: string;
  mobile: string;
  email: string;
  emailHash: string;
  postcode: string;
  triedTwoTreatments: boolean;
  psychiatricExclusion: boolean;
  heardAbout?: string | null;
  idempotencyKeyHash: string;
  assignmentStatus: 'AWAITING_HHH_ALLOCATION' | 'PROVISIONAL' | 'CONFIRMED';
  pharmacyAccessStatus: 'WITHHELD' | 'ACTIVATED';
  consentVersion: string;
  referralConsent: boolean;
  dataSharingConsent: boolean;
  marketingConsent: boolean;
  privacyNoticeVersion: string;
}

export interface SubmissionQueueItem {
  id: string;
  firstName: string;
  surname: string;
  dob: string;
  mobile: string;
  email: string;
  postcode: string;
  assignmentStatus: string;
  pharmacyReviewStatus: string;
  outcomeStatus: string;
  followUpStatus: string;
  submittedAt: string;
  updatedAt: string;
}

export interface ReassignSubmissionInput {
  id: string;
  newOrganisationId: string;
  expectedAssignmentVersion: number;
  newAssignmentVersion: number;
  actorUid: string;
  action: string;
  reasonCode: string;
}

export interface IntakeRepositoryPort {
  createSubmission(input: CreateSubmissionInput): Promise<{ id?: string }>;
  findSubmissionById(id: string): Promise<any | null>;
  listTenantQueue(organisationId: string, limit?: number): Promise<SubmissionQueueItem[]>;
  reassignSubmission(input: ReassignSubmissionInput): Promise<void>;
}
