import { dataConnect } from '../../bootstrap/firebase.js';
import type { PatientRecord, PatientRepositoryPort } from '../ports/patient.port.js';

const PATIENT_FIELDS = `
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
  patientConditions_on_patient {
    conditionCode
    primary
  }
  sourceSubmission {
    sourceType
    triedTwoTreatments
    psychiatricExclusion
    heardAbout
    marketingConsent
  }
`;

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
      ${PATIENT_FIELDS}
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
      ${PATIENT_FIELDS}
    }
  }
`;

type RawPatient = Omit<PatientRecord, 'conditions' | 'sourceSubmission'> & {
  patientConditions_on_patient?: PatientRecord['conditions'];
  sourceSubmission?: PatientRecord['sourceSubmission'];
};

function mapPatient(raw: RawPatient): PatientRecord {
  const { patientConditions_on_patient, sourceSubmission, ...patient } = raw;
  return {
    ...patient,
    conditions: patientConditions_on_patient ?? [],
    sourceSubmission: sourceSubmission ?? null,
  };
}

export class SqlPatientRepository implements PatientRepositoryPort {
  async listTenantPatients(organisationId: string, limit = 500): Promise<PatientRecord[]> {
    const result = await dataConnect.executeGraphql<{ patients: RawPatient[] }, any>(
      LIST_TENANT_PATIENTS_GQL,
      { variables: { organisationId, limit } },
    );
    return (result.data.patients ?? []).map(mapPatient);
  }

  async listPlatformPatients(limit = 20_001): Promise<PatientRecord[]> {
    const result = await dataConnect.executeGraphql<{ patients: RawPatient[] }, any>(
      LIST_PLATFORM_PATIENTS_GQL,
      { variables: { limit } },
    );
    return (result.data.patients ?? []).map(mapPatient);
  }
}
