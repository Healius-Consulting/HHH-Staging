export interface OrganisationRecord {
  id: string;
  companyId: string | null;
  name: string;
  tradingName: string;
  gphcNumber: string;
  superintendentName: string;
  mainContactName: string | null;
  mainContactPhone: string | null;
  mainContactEmail: string | null;
  address: string;
  primaryColour: string;
  logoText: string;
  status: 'ONBOARDING' | 'INTAKE_LIVE' | 'LIVE' | 'PAUSED';
  classification: 'STANDARD' | 'TRAINING' | 'ALLOCATION_HOLDING';
  platformFeeMonthlyPence: number | null;
  portalName: string;
  intakeEnabled: boolean;
  prescriptionEnabled: boolean;
  paymentsEnabled: boolean;
  supplierOrdersEnabled: boolean;
  patientsEnabled: boolean;
  resourcesEnabled: boolean;
  worldpayEnabled: boolean;
  defaultPaymentRoute: 'MANUAL' | 'WORLDPAY';
  autoPlacementEnabled: boolean;
  gdprComplianceFlag: boolean;
  pausedReason: string | null;
  pausedAt: string | null;
  version: number;
}

export interface PublicPharmacyResolution {
  type: 'future_pharmacy_qr' | 'legacy_pharmacy_qr';
  intakeVersion: 'v1' | 'v2';
  pharmacy: {
    id: string;
    name: string;
    tradingName: string;
    logoText: string;
    gphcNumber: string;
    superintendent: string;
    address: string;
    primaryColour: string;
  };
}

export interface SetupTaskRecord {
  id: string;
  organisationId: string;
  taskCode: string;
  required: boolean;
  completed: boolean;
  evidence: string | null;
  completedByUid: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrganisationRepositoryPort {
  findOrganisationById(id: string): Promise<OrganisationRecord | null>;
  findDirectoryByTokenHash(tokenHash: string): Promise<PublicPharmacyResolution | null>;
  listSetupTasks(organisationId: string): Promise<SetupTaskRecord[]>;
  upsertSetupTask(params: {
    organisationId: string;
    taskCode: string;
    completed: boolean;
    evidence?: string | null;
    completedByUid?: string | null;
  }): Promise<void>;
  updateStaffPreferences(uid: string, preferences: unknown): Promise<void>;
}
