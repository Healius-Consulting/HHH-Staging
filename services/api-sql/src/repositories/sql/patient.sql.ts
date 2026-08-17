import { dataConnect } from '../../bootstrap/firebase.js';
import type { PatientRecord, PatientRepositoryPort } from '../ports/patient.port.js';

const LIST_TENANT_PATIENTS_GQL = `
  query ListTenantPatients($organisationId: UUID!, $limit: Int!) {
    patients(
      where: {
        organisationId: { eq: $organisationId }
        archivedAt: { isNull: true }
      }
      orderBy: { createdAt: DESC }
      limit: $limit
    ) {
      id
      organisationId
      sourceSubmissionId
      firstName
      surname
      dob
      email
      mobile
      address
      postcode
      status
      activatedAt
      statusChangedAt
      version
      createdAt
      updatedAt
    }
  }
`;

const LIST_PLATFORM_PATIENTS_GQL = `
  query ListPlatformPatients($limit: Int!) {
    patients(
      where: { archivedAt: { isNull: true } }
      orderBy: { createdAt: DESC }
      limit: $limit
    ) {
      id
      organisationId
      sourceSubmissionId
      firstName
      surname
      dob
      email
      mobile
      address
      postcode
      status
      activatedAt
      statusChangedAt
      version
      createdAt
      updatedAt
    }
  }
`;

export class SqlPatientRepository implements PatientRepositoryPort {
  async listTenantPatients(organisationId: string, limit = 500): Promise<PatientRecord[]> {
    const result = await dataConnect.executeGraphql<{ patients: PatientRecord[] }, any>(
      LIST_TENANT_PATIENTS_GQL,
      { variables: { organisationId, limit } },
    );
    return result.data.patients ?? [];
  }

  async listPlatformPatients(limit = 20_001): Promise<PatientRecord[]> {
    const result = await dataConnect.executeGraphql<{ patients: PatientRecord[] }, any>(
      LIST_PLATFORM_PATIENTS_GQL,
      { variables: { limit } },
    );
    return result.data.patients ?? [];
  }
}
