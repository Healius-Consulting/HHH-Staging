import { dataConnect } from '../../bootstrap/firebase.js';
import type {
  OrganisationRecord,
  OrganisationRepositoryPort,
  PublicPharmacyResolution,
  SetupTaskRecord,
} from '../ports/organisation.port.js';

const GET_ORGANISATION_BY_ID_GQL = `
  query GetOrganisationById($id: UUID!) {
    organisation(key: { id: $id }) {
      id
      companyId
      name
      tradingName
      gphcNumber
      superintendentName
      mainContactName
      mainContactPhone
      mainContactEmail
      address
      primaryColour
      logoText
      status
      classification
      platformFeeMonthlyPence
      portalName
      intakeEnabled
      prescriptionEnabled
      paymentsEnabled
      supplierOrdersEnabled
      patientsEnabled
      resourcesEnabled
      worldpayEnabled
      defaultPaymentRoute
      autoPlacementEnabled
      gdprComplianceFlag
      pausedReason
      pausedAt
      version
    }
  }
`;

const GET_PHARMACY_DIRECTORY_BY_TOKEN_GQL = `
  query GetPharmacyDirectoryByToken($tokenHash: String!) {
    referralTokens(where: { tokenHash: { eq: $tokenHash }, revokedAt: { isNull: true } }, limit: 1) {
      id
      organisationId
      intakeVersion
      organisation {
        id
        name
        tradingName
        gphcNumber
        superintendentName
        address
        primaryColour
        logoText
        status
      }
    }
  }
`;

const LIST_SETUP_TASKS_GQL = `
  query ListSetupTasksByOrg($organisationId: UUID!) {
    setupTasks(where: { organisationId: { eq: $organisationId } }) {
      id
      organisationId
      taskCode
      required
      completed
      evidence
      completedByUid
      completedAt
      createdAt
      updatedAt
    }
  }
`;

const UPSERT_SETUP_TASK_GQL = `
  mutation UpsertSetupTask(
    $organisationId: UUID!
    $taskCode: String!
    $completed: Boolean!
    $evidence: String
    $completedByUid: String
    $completedAt: Timestamp
  ) {
    setupTask_upsert(data: {
      organisationId: $organisationId
      taskCode: $taskCode
      completed: $completed
      evidence: $evidence
      completedByUid: $completedByUid
      completedAt: $completedAt
    })
  }
`;

const UPDATE_STAFF_PREFERENCES_GQL = `
  mutation UpdateStaffPreferences(
    $uid: String!
    $preferences: Any!
  ) {
    staffUser_update(
      key: { uid: $uid }
      data: {
        preferences: $preferences
      }
    )
  }
`;

export class SqlOrganisationRepository implements OrganisationRepositoryPort {
  async findOrganisationById(id: string): Promise<OrganisationRecord | null> {
    const result = await dataConnect.executeGraphql<{ organisation: OrganisationRecord | null }, any>(
      GET_ORGANISATION_BY_ID_GQL,
      { variables: { id } }
    );
    return result.data.organisation ?? null;
  }

  async findDirectoryByTokenHash(tokenHash: string): Promise<PublicPharmacyResolution | null> {
    const result = await dataConnect.executeGraphql<{
      referralTokens: Array<{
        id: string;
        organisationId: string;
        intakeVersion: string;
        organisation: {
          id: string;
          name: string;
          tradingName: string;
          gphcNumber: string;
          superintendentName: string;
          address: string;
          primaryColour: string;
          logoText: string;
          status: string;
        };
      }>;
    }, any>(GET_PHARMACY_DIRECTORY_BY_TOKEN_GQL, { variables: { tokenHash } });

    const match = result.data.referralTokens?.[0];
    if (!match || !match.organisation) return null;

    const org = match.organisation;
    return {
      type: match.intakeVersion === 'v1' ? 'legacy_pharmacy_qr' : 'future_pharmacy_qr',
      intakeVersion: match.intakeVersion === 'v1' ? 'v1' : 'v2',
      pharmacy: {
        id: org.id,
        name: org.name,
        tradingName: org.tradingName,
        logoText: org.logoText,
        gphcNumber: org.gphcNumber,
        superintendent: org.superintendentName,
        address: org.address,
        primaryColour: org.primaryColour,
      },
    };
  }

  async listSetupTasks(organisationId: string): Promise<SetupTaskRecord[]> {
    const result = await dataConnect.executeGraphql<{ setupTasks: SetupTaskRecord[] }, any>(
      LIST_SETUP_TASKS_GQL,
      { variables: { organisationId } }
    );
    return result.data.setupTasks ?? [];
  }

  async upsertSetupTask(params: {
    organisationId: string;
    taskCode: string;
    completed: boolean;
    evidence?: string | null;
    completedByUid?: string | null;
  }): Promise<void> {
    const completedAt = params.completed ? new Date().toISOString() : null;
    await dataConnect.executeGraphql<any, any>(UPSERT_SETUP_TASK_GQL, {
      variables: {
        organisationId: params.organisationId,
        taskCode: params.taskCode,
        completed: params.completed,
        evidence: params.evidence ?? null,
        completedByUid: params.completedByUid ?? null,
        completedAt,
      },
    });
  }

  async updateStaffPreferences(uid: string, preferences: unknown): Promise<void> {
    await dataConnect.executeGraphql<any, any>(UPDATE_STAFF_PREFERENCES_GQL, {
      variables: { uid, preferences },
    });
  }
}
