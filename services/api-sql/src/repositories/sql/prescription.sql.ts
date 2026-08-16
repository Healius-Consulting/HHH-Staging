import { dataConnect } from '../../bootstrap/firebase.js';
import type {
  PrescriberRecord,
  PrescriptionFileRecord,
  PrescriptionRecord,
  PrescriptionRepositoryPort,
} from '../ports/prescription.port.js';

const GET_PRESCRIPTION_FILE_BY_ID_GQL = `
  query GetPrescriptionFileById($id: UUID!, $organisationId: UUID!) {
    prescriptionFiles(
      where: {
        id: { eq: $id }
        organisationId: { eq: $organisationId }
      }
      limit: 1
    ) {
      id
      organisationId
      patientId
      storagePath
      originalFilename
      contentType
      sizeBytes
      status
      verifiedAt
    }
  }
`;

const LIST_ACTIVE_PRESCRIBERS_GQL = `
  query ListActivePrescribers {
    prescribers(where: { active: { eq: true } }, limit: 200) {
      id
      name
      initials
      pin
      gmcNumber
      gphcNumber
      active
    }
  }
`;

const LIST_TENANT_PRESCRIPTIONS_GQL = `
  query ListTenantPrescriptions($organisationId: UUID!, $limit: Int!) {
    prescriptions(
      where: { organisationId: { eq: $organisationId } }
      limit: $limit
    ) {
      id
      patientId
      prescriberId
      fileId
      serialNumber
      issueDate
      expiryDate
      status
      patientNameSnapshot
      patientDobSnapshot
      verifiedAt
      createdAt
    }
  }
`;

const CREATE_PRESCRIPTION_FILE_GQL = `
  mutation CreatePrescriptionFile(
    $organisationId: UUID!
    $patientId: UUID
    $storagePath: String!
    $originalFilename: String!
    $contentType: String!
    $sizeBytes: Int64!
    $uploadedByUid: String
  ) {
    prescriptionFile_insert(data: {
      organisationId: $organisationId
      patientId: $patientId
      storagePath: $storagePath
      originalFilename: $originalFilename
      contentType: $contentType
      sizeBytes: $sizeBytes
      uploadedByUid: $uploadedByUid
      status: UPLOADED
      uploadedAt_expr: "request.time"
    })
  }
`;

export class SqlPrescriptionRepository implements PrescriptionRepositoryPort {
  async findFileById(id: string, organisationId: string): Promise<PrescriptionFileRecord | null> {
    const result = await dataConnect.executeGraphql<{ prescriptionFiles: PrescriptionFileRecord[] }, any>(
      GET_PRESCRIPTION_FILE_BY_ID_GQL,
      { variables: { id, organisationId } }
    );
    return result.data.prescriptionFiles?.[0] ?? null;
  }

  async listActivePrescribers(): Promise<PrescriberRecord[]> {
    const result = await dataConnect.executeGraphql<{ prescribers: PrescriberRecord[] }, any>(
      LIST_ACTIVE_PRESCRIBERS_GQL
    );
    return result.data.prescribers ?? [];
  }

  async listTenantPrescriptions(organisationId: string, limit = 200): Promise<PrescriptionRecord[]> {
    const result = await dataConnect.executeGraphql<{ prescriptions: PrescriptionRecord[] }, any>(
      LIST_TENANT_PRESCRIPTIONS_GQL,
      { variables: { organisationId, limit } }
    );
    return result.data.prescriptions ?? [];
  }

  async createFile(data: {
    id?: string;
    organisationId: string;
    patientId?: string | null;
    storagePath: string;
    originalFilename: string;
    contentType: string;
    sizeBytes: number;
    uploadedByUid?: string | null;
  }): Promise<{ id?: string }> {
    const result = await dataConnect.executeGraphql<{ prescriptionFile_insert: { id: string } }, any>(
      CREATE_PRESCRIPTION_FILE_GQL,
      {
        variables: {
          organisationId: data.organisationId,
          patientId: data.patientId ?? null,
          storagePath: data.storagePath,
          originalFilename: data.originalFilename,
          contentType: data.contentType,
          sizeBytes: data.sizeBytes,
          uploadedByUid: data.uploadedByUid ?? null,
        },
      }
    );
    return { id: result.data.prescriptionFile_insert?.id };
  }
}
