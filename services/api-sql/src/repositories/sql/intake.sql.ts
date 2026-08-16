import { dataConnect } from '../../bootstrap/firebase.js';
import type {
  CreateSubmissionInput,
  IntakeRepositoryPort,
  ReassignSubmissionInput,
  SubmissionQueueItem,
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

const LIST_TENANT_QUEUE_GQL = `
  query ListTenantEligibilityQueue($organisationId: UUID!, $limit: Int!) {
    eligibilitySubmissions(
      where: {
        assignedOrganisationId: { eq: $organisationId }
        pharmacyAccessStatus: { eq: ACTIVATED }
      }
      limit: $limit
    ) {
      id
      firstName
      surname
      dob
      mobile
      email
      postcode
      assignmentStatus
      pharmacyReviewStatus
      outcomeStatus
      followUpStatus
      submittedAt
      updatedAt
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

const REASSIGN_SUBMISSION_GQL = `
  mutation ReassignSubmission(
    $id: UUID!
    $newOrganisationId: UUID!
    $expectedAssignmentVersion: Int!
    $newAssignmentVersion: Int!
    $actorUid: String!
    $action: String!
    $reasonCode: String!
  ) {
    eligibilitySubmission_update(
      key: { id: $id }
      data: {
        assignedOrganisationId: $newOrganisationId
        assignmentStatus: CONFIRMED
        pharmacyAccessStatus: ACTIVATED
        assignmentVersion: $newAssignmentVersion
        allocationCompletedAt_expr: "request.time"
      }
    )
    eligibilityAssignmentEvent_insert(data: {
      submissionId: $id
      newOrganisationId: $newOrganisationId
      actorUid: $actorUid
      action: $action
      reasonCode: $reasonCode
      previousAssignmentVersion: $expectedAssignmentVersion
      newAssignmentVersion: $newAssignmentVersion
    })
  }
`;

export class SqlIntakeRepository implements IntakeRepositoryPort {
  async findSubmissionById(id: string): Promise<any | null> {
    const result = await dataConnect.executeGraphql<{ eligibilitySubmission: any | null }, any>(
      GET_SUBMISSION_BY_ID_GQL,
      { variables: { id } }
    );
    return result.data.eligibilitySubmission ?? null;
  }

  async listTenantQueue(organisationId: string, limit = 200): Promise<SubmissionQueueItem[]> {
    const result = await dataConnect.executeGraphql<{ eligibilitySubmissions: SubmissionQueueItem[] }, any>(
      LIST_TENANT_QUEUE_GQL,
      { variables: { organisationId, limit } }
    );
    return result.data.eligibilitySubmissions ?? [];
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

  async reassignSubmission(input: ReassignSubmissionInput): Promise<void> {
    await dataConnect.executeGraphql<any, any>(REASSIGN_SUBMISSION_GQL, {
      variables: {
        id: input.id,
        newOrganisationId: input.newOrganisationId,
        expectedAssignmentVersion: input.expectedAssignmentVersion,
        newAssignmentVersion: input.newAssignmentVersion,
        actorUid: input.actorUid,
        action: input.action,
        reasonCode: input.reasonCode,
      },
    });
  }
}
