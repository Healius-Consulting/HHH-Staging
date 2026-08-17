export interface PrescriptionFileRecord {
  id: string;
  organisationId: string;
  patientId: string | null;
  storagePath: string;
  originalFilename: string;
  contentType: string;
  sizeBytes: number;
  status: string;
  verifiedAt: string | null;
}

export interface PrescriberRecord {
  id: string;
  name: string;
  initials: string;
  pin: string;
  gmcNumber: number | null;
  gphcNumber: string | null;
  active: boolean;
}

export interface PrescriptionRecord {
  id: string;
  patientId: string;
  prescriberId: string | null;
  fileId: string;
  serialNumber: string;
  issueDate: string;
  expiryDate: string;
  status: string;
  patientNameSnapshot: string;
  patientDobSnapshot: string;
  verifiedAt: string | null;
  createdAt: string;
}

export interface PrescriptionRepositoryPort {
  findFileById(id: string, organisationId: string): Promise<PrescriptionFileRecord | null>;
  createFile(data: {
    id?: string;
    organisationId: string;
    patientId?: string | null;
    storagePath: string;
    originalFilename: string;
    contentType: string;
    sizeBytes: number;
    uploadedByUid?: string | null;
  }): Promise<{ id?: string }>;
  completeFile(id: string, organisationId: string): Promise<boolean>;
  deleteFile(id: string, organisationId: string): Promise<boolean>;
  listActivePrescribers(): Promise<PrescriberRecord[]>;
  listTenantPrescriptions(organisationId: string, limit?: number): Promise<PrescriptionRecord[]>;
}
