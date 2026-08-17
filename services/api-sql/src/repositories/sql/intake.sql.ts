import { dataConnect } from '../../bootstrap/firebase.js';
import { HttpError } from '../../domain/common/errors.js';
import type {
  ActivateSubmissionInput,
  CreateSubmissionInput,
  DeclineSubmissionInput,
  IdempotentSubmissionRecord,
  IntakeRepositoryPort,
  PlatformSubmissionRecord,
  ReassignSubmissionInput,
  SubmissionConditionRecord,
  TenantPendingEnquiryRecord,
  UpdateSubmissionFollowUpInput,
} from '../ports/intake.port.js';

const GET_SUBMISSION_BY_ID_GQL = `
  query GetEligibilitySubmissionById($id: UUID!) {
    eligibilitySubmission(key: { id: $id }) {
      id
      sourceOrganisationId
      assignedOrganisationId
      sourceType
      firstName
      surname
      dob
      mobile
      email
      emailHash
      postcode
      triedTwoTreatments
      psychiatricExclusion
      heardAbout
      idempotencyKeyHash
      assignmentStatus
      assignmentVersion
      pharmacyAccessStatus
      followUpStatus
      pharmacyReviewStatus
      outcomeStatus
      onboardingDecision
      assignmentReason
      privateAllocationNote
      privateOnboardingNote
      consentVersion
      referralConsent
      dataSharingConsent
      marketingConsent
      privacyNoticeVersion
      submittedAt
      allocationCompletedAt
      operationalStartedAt
      reviewedAt
      completedAt
      updatedAt
    }
  }
`;

const LIST_TENANT_PENDING_ENQUIRIES_GQL = `
  query ListTenantPendingEnquiries($organisationId: UUID!, $limit: Int!) {
    eligibilitySubmissions(
      where: {
        assignedOrganisationId: { eq: $organisationId }
        pharmacyAccessStatus: { eq: WITHHELD }
        outcomeStatus: { eq: OPEN }
      }
      limit: $limit
    ) {
      id
      submittedAt
    }
  }
`;

const LIST_PLATFORM_SUBMISSIONS_GQL = `
  query ListPlatformEligibilitySubmissions($limit: Int!) {
    eligibilitySubmissions(limit: $limit) {
      id
      sourceOrganisationId
      assignedOrganisationId
      sourceType
      firstName
      surname
      dob
      mobile
      email
      postcode
      triedTwoTreatments
      psychiatricExclusion
      heardAbout
      assignmentStatus
      assignmentVersion
      pharmacyAccessStatus
      followUpStatus
      pharmacyReviewStatus
      outcomeStatus
      onboardingDecision
      assignmentReason
      privateAllocationNote
      privateOnboardingNote
      consentVersion
      referralConsent
      dataSharingConsent
      marketingConsent
      privacyNoticeVersion
      submittedAt
      allocationCompletedAt
      operationalStartedAt
      reviewedAt
      completedAt
      updatedAt
    }
  }
`;

const LIST_SUBMISSION_CONDITIONS_GQL = `
  query ListEligibilityConditionsForSubmission($submissionId: UUID!) {
    eligibilityConditions(where: { submissionId: { eq: $submissionId } }) {
      conditionCode
      primary
    }
  }
`;

const CREATE_SUBMISSION_GQL = `
  mutation CreateEligibilitySubmission(
    $sourceOrganisationId: UUID
    $assignedOrganisationId: UUID
    $sourceType: ReferralSourceType!
    $firstName: String!
    $surname: String!
    $dob: Date!
    $mobile: String!
    $email: String!
    $emailHash: String!
    $postcode: String!
    $triedTwoTreatments: Boolean!
    $psychiatricExclusion: Boolean!
    $heardAbout: String
    $idempotencyKeyHash: String!
    $assignmentStatus: AssignmentStatus!
    $pharmacyAccessStatus: AccessStatus!
    $consentVersion: String!
    $referralConsent: Boolean!
    $dataSharingConsent: Boolean!
    $marketingConsent: Boolean!
    $privacyNoticeVersion: String!
  ) {
    eligibilitySubmission_insert(data: {
      sourceOrganisationId: $sourceOrganisationId
      assignedOrganisationId: $assignedOrganisationId
      sourceType: $sourceType
      firstName: $firstName
      surname: $surname
      dob: $dob
      mobile: $mobile
      email: $email
      emailHash: $emailHash
      postcode: $postcode
      triedTwoTreatments: $triedTwoTreatments
      psychiatricExclusion: $psychiatricExclusion
      heardAbout: $heardAbout
      idempotencyKeyHash: $idempotencyKeyHash
      assignmentStatus: $assignmentStatus
      pharmacyAccessStatus: $pharmacyAccessStatus
      consentVersion: $consentVersion
      referralConsent: $referralConsent
      dataSharingConsent: $dataSharingConsent
      marketingConsent: $marketingConsent
      privacyNoticeVersion: $privacyNoticeVersion
    })
  }
`;

const GET_SUBMISSION_BY_IDEMPOTENCY_HASH_GQL = `
  query GetSubmissionByIdempotencyHash($idempotencyKeyHash: String!) {
    eligibilitySubmissions(
      where: { idempotencyKeyHash: { eq: $idempotencyKeyHash } }
      limit: 1
    ) {
      id
      assignedOrganisationId
      assignmentStatus
      submittedAt
    }
  }
`;

const UPSERT_SUBMISSION_CONDITION_GQL = `
  mutation UpsertSubmissionCondition(
    $submissionId: UUID!
    $conditionCode: String!
    $primary: Boolean!
  ) {
    eligibilityCondition_upsert(data: {
      submissionId: $submissionId
      conditionCode: $conditionCode
      primary: $primary
    })
  }
`;

const REASSIGN_SUBMISSION_GQL = `
  mutation ReassignPendingSubmission(
    $id: UUID!
    $newOrganisationId: UUID!
    $expectedAssignmentVersion: Int!
    $newAssignmentVersion: Int!
    $actorUid: String!
    $reasonCode: String!
    $note: String
    $previousOrganisationId: UUID
    $notePresent: Boolean!
  ) @transaction {
    updated: eligibilitySubmission_updateMany(
      where: {
        id: { eq: $id }
        assignmentVersion: { eq: $expectedAssignmentVersion }
        pharmacyAccessStatus: { eq: WITHHELD }
        outcomeStatus: { eq: OPEN }
      }
      data: {
        assignedOrganisationId: $newOrganisationId
        assignmentStatus: PROVISIONAL
        assignmentVersion: $newAssignmentVersion
        assignmentReason: $reasonCode
        privateAllocationNote: $note
        updatedAt_expr: "request.time"
      }
    ) @check(expr: "this == 1", message: "INTAKE_STATE_CONFLICT") @redact
    eligibilityAssignmentEvent_insert(data: {
      submissionId: $id
      previousOrganisationId: $previousOrganisationId
      newOrganisationId: $newOrganisationId
      actorUid: $actorUid
      action: "pending_reassigned"
      reasonCode: $reasonCode
      previousAssignmentVersion: $expectedAssignmentVersion
      newAssignmentVersion: $newAssignmentVersion
      notePresent: $notePresent
    })
  }
`;

const UPDATE_SUBMISSION_FOLLOW_UP_GQL = `
  mutation UpdateSubmissionFollowUp(
    $id: UUID!
    $expectedAssignmentVersion: Int!
    $newAssignmentVersion: Int!
    $followUpStatus: FollowUpStatus!
  ) @transaction {
    updated: eligibilitySubmission_updateMany(
      where: {
        id: { eq: $id }
        assignmentVersion: { eq: $expectedAssignmentVersion }
        pharmacyAccessStatus: { eq: WITHHELD }
        outcomeStatus: { eq: OPEN }
      }
      data: {
        followUpStatus: $followUpStatus
        assignmentVersion: $newAssignmentVersion
        updatedAt_expr: "request.time"
      }
    ) @check(expr: "this == 1", message: "INTAKE_STATE_CONFLICT") @redact
  }
`;

const ACTIVATE_SUBMISSION_GQL = `
  mutation ActivateSubmission(
    $id: UUID!
    $patientId: UUID!
    $organisationId: UUID!
    $expectedAssignmentVersion: Int!
    $newAssignmentVersion: Int!
    $firstName: String!
    $surname: String!
    $dob: Date!
    $email: String!
    $emailHash: String!
    $mobile: String!
    $postcode: String!
    $onboardingNote: String
  ) @transaction {
    updated: eligibilitySubmission_updateMany(
      where: {
        id: { eq: $id }
        assignedOrganisationId: { eq: $organisationId }
        assignmentVersion: { eq: $expectedAssignmentVersion }
        pharmacyAccessStatus: { eq: WITHHELD }
        outcomeStatus: { eq: OPEN }
      }
      data: {
        assignmentStatus: CONFIRMED
        pharmacyAccessStatus: ACTIVATED
        onboardingDecision: APPROVED
        outcomeStatus: COMPLETED
        assignmentVersion: $newAssignmentVersion
        privateOnboardingNote: $onboardingNote
        allocationCompletedAt_expr: "request.time"
        completedAt_expr: "request.time"
        updatedAt_expr: "request.time"
      }
    ) @check(expr: "this == 1", message: "INTAKE_STATE_CONFLICT") @redact
    patient_insert(data: {
      id: $patientId
      organisationId: $organisationId
      sourceSubmissionId: $id
      firstName: $firstName
      surname: $surname
      dob: $dob
      email: $email
      mobile: $mobile
      postcode: $postcode
      status: ACTIVE
      activatedAt_expr: "request.time"
      statusChangedAt_expr: "request.time"
      patientIdentity_on_patient: {
        organisationId: $organisationId
        emailHash: $emailHash
        dob: $dob
      }
    })
  }
`;

const DECLINE_SUBMISSION_GQL = `
  mutation DeclineSubmission(
    $id: UUID!
    $expectedAssignmentVersion: Int!
    $newAssignmentVersion: Int!
    $onboardingNote: String
  ) @transaction {
    updated: eligibilitySubmission_updateMany(
      where: {
        id: { eq: $id }
        assignmentVersion: { eq: $expectedAssignmentVersion }
        pharmacyAccessStatus: { eq: WITHHELD }
        outcomeStatus: { eq: OPEN }
      }
      data: {
        pharmacyAccessStatus: REVOKED
        onboardingDecision: DECLINED
        outcomeStatus: DECLINED
        assignmentVersion: $newAssignmentVersion
        privateOnboardingNote: $onboardingNote
        completedAt_expr: "request.time"
        updatedAt_expr: "request.time"
      }
    ) @check(expr: "this == 1", message: "INTAKE_STATE_CONFLICT") @redact
  }
`;

function rethrowMutationError(error: unknown): never {
  if (error instanceof Error && error.message.includes('INTAKE_STATE_CONFLICT')) {
    throw new HttpError(409, 'This intake changed or is no longer pending. Refresh before continuing.', 'VERSION_CONFLICT');
  }
  if (error instanceof Error && /unique constraint|duplicate key/i.test(error.message)) {
    throw new HttpError(409, 'A patient record already exists for this referral or identity.', 'PATIENT_ALREADY_EXISTS');
  }
  throw error;
}

export class SqlIntakeRepository implements IntakeRepositoryPort {
  async findSubmissionById(id: string): Promise<any | null> {
    const result = await dataConnect.executeGraphql<{ eligibilitySubmission: any | null }, any>(
      GET_SUBMISSION_BY_ID_GQL,
      { variables: { id } }
    );
    return result.data.eligibilitySubmission ?? null;
  }

  async listTenantPendingEnquiries(organisationId: string, limit = 200): Promise<TenantPendingEnquiryRecord[]> {
    const result = await dataConnect.executeGraphql<{
      eligibilitySubmissions: TenantPendingEnquiryRecord[];
    }, any>(
      LIST_TENANT_PENDING_ENQUIRIES_GQL,
      { variables: { organisationId, limit } }
    );
    return (result.data.eligibilitySubmissions ?? [])
      .sort((left, right) => right.submittedAt.localeCompare(left.submittedAt));
  }

  async listPlatformSubmissions(limit = 500): Promise<PlatformSubmissionRecord[]> {
    const result = await dataConnect.executeGraphql<{
      eligibilitySubmissions: PlatformSubmissionRecord[];
    }, any>(LIST_PLATFORM_SUBMISSIONS_GQL, { variables: { limit } });
    return result.data.eligibilitySubmissions ?? [];
  }

  async listSubmissionConditions(submissionId: string): Promise<SubmissionConditionRecord[]> {
    const result = await dataConnect.executeGraphql<{
      eligibilityConditions: SubmissionConditionRecord[];
    }, any>(LIST_SUBMISSION_CONDITIONS_GQL, { variables: { submissionId } });
    return result.data.eligibilityConditions ?? [];
  }

  async createSubmission(input: CreateSubmissionInput): Promise<{ id?: string }> {
    const result = await dataConnect.executeGraphql<{ eligibilitySubmission_insert: { id: string } }, any>(
      CREATE_SUBMISSION_GQL,
      {
        variables: {
          sourceOrganisationId: input.sourceOrganisationId ?? null,
          assignedOrganisationId: input.assignedOrganisationId ?? null,
          sourceType: input.sourceType,
          firstName: input.firstName,
          surname: input.surname,
          dob: input.dob,
          mobile: input.mobile,
          email: input.email,
          emailHash: input.emailHash,
          postcode: input.postcode,
          triedTwoTreatments: input.triedTwoTreatments,
          psychiatricExclusion: input.psychiatricExclusion,
          heardAbout: input.heardAbout ?? null,
          idempotencyKeyHash: input.idempotencyKeyHash,
          assignmentStatus: input.assignmentStatus,
          pharmacyAccessStatus: input.pharmacyAccessStatus,
          consentVersion: input.consentVersion,
          referralConsent: input.referralConsent,
          dataSharingConsent: input.dataSharingConsent,
          marketingConsent: input.marketingConsent,
          privacyNoticeVersion: input.privacyNoticeVersion,
        },
      }
    );
    return { id: result.data.eligibilitySubmission_insert?.id };
  }

  async findSubmissionByIdempotencyHash(idempotencyKeyHash: string): Promise<IdempotentSubmissionRecord | null> {
    const result = await dataConnect.executeGraphql<{
      eligibilitySubmissions: IdempotentSubmissionRecord[];
    }, any>(GET_SUBMISSION_BY_IDEMPOTENCY_HASH_GQL, {
      variables: { idempotencyKeyHash },
    });
    return result.data.eligibilitySubmissions?.[0] ?? null;
  }

  async upsertSubmissionCondition(submissionId: string, conditionCode: string, primary: boolean): Promise<void> {
    await dataConnect.executeGraphql(UPSERT_SUBMISSION_CONDITION_GQL, {
      variables: { submissionId, conditionCode, primary },
    });
  }

  async reassignPendingSubmission(input: ReassignSubmissionInput): Promise<void> {
    try {
      const current = await this.findSubmissionById(input.id) as PlatformSubmissionRecord | null;
      await dataConnect.executeGraphql<any, any>(REASSIGN_SUBMISSION_GQL, {
        variables: {
          id: input.id,
          newOrganisationId: input.newOrganisationId,
          expectedAssignmentVersion: input.expectedAssignmentVersion,
          newAssignmentVersion: input.newAssignmentVersion,
          actorUid: input.actorUid,
          reasonCode: input.reasonCode,
          note: input.note,
          previousOrganisationId: current?.assignedOrganisationId ?? null,
          notePresent: Boolean(input.note),
        },
      });
    } catch (error) {
      rethrowMutationError(error);
    }
  }

  async updateSubmissionFollowUp(input: UpdateSubmissionFollowUpInput): Promise<void> {
    try {
      await dataConnect.executeGraphql<any, any>(UPDATE_SUBMISSION_FOLLOW_UP_GQL, { variables: input });
    } catch (error) {
      rethrowMutationError(error);
    }
  }

  async activateSubmission(input: ActivateSubmissionInput): Promise<void> {
    try {
      await dataConnect.executeGraphql<any, any>(ACTIVATE_SUBMISSION_GQL, { variables: input });
    } catch (error) {
      rethrowMutationError(error);
    }
  }

  async declineSubmission(input: DeclineSubmissionInput): Promise<void> {
    try {
      await dataConnect.executeGraphql<any, any>(DECLINE_SUBMISSION_GQL, { variables: input });
    } catch (error) {
      rethrowMutationError(error);
    }
  }
}
