export interface PatientRecord {
  id: string;
  organisationId: string;
  sourceSubmissionId: string | null;
  firstName: string;
  surname: string;
  dob: string;
  email: string;
  mobile: string;
  address: string | null;
  postcode: string;
  status: 'REFERRED' | 'ACTIVE' | 'INACTIVE';
  activatedAt: string | null;
  statusChangedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface PatientRepositoryPort {
  listTenantPatients(organisationId: string, limit?: number): Promise<PatientRecord[]>;
  listPlatformPatients(limit?: number): Promise<PatientRecord[]>;
}
