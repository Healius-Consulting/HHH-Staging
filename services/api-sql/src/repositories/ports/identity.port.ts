export interface StaffUserRecord {
  uid: string;
  organisationId: string | null;
  email: string;
  displayName: string;
  role: 'HHH_ADMIN' | 'PHARMACY_STAFF';
  status: 'INVITED' | 'ACTIVE' | 'DISABLED' | 'REMOVED';
  disabled: boolean;
  preferences?: unknown;
  invitedAt?: string | null;
  activatedAt?: string | null;
  lastSignedInAt?: string | null;
  version: number;
}

export interface StaffSessionRecord {
  sessionHash: string;
  staffUid: string;
  organisationId: string | null;
  surface: string;
  role: 'HHH_ADMIN' | 'PHARMACY_STAFF';
  userAgentHash: string;
  createdAt: string;
  lastActivityAt: string;
  idleExpiresAt: string;
  absoluteExpiresAt: string;
  revokedAt: string | null;
  revokeReason: string | null;
}

export interface PortalAdmissionResult {
  session: StaffSessionRecord | null;
  staff: StaffUserRecord | null;
}

export interface CreateSessionInput {
  sessionHash: string;
  staffUid: string;
  organisationId: string | null;
  surface: 'pharmacy' | 'admin';
  role: 'HHH_ADMIN' | 'PHARMACY_STAFF';
  userAgentHash: string;
  lastActivityAt: string;
  idleExpiresAt: string;
  absoluteExpiresAt: string;
}

export interface AppendAuditInput {
  organisationId?: string | null;
  actorUid?: string | null;
  actorRole?: 'HHH_ADMIN' | 'PHARMACY_STAFF' | null;
  event: string;
  recordType?: string | null;
  recordId?: string | null;
  requestId?: string | null;
  sessionHashPrefix?: string | null;
  ipHash?: string | null;
  surface?: string | null;
  details?: unknown;
}

export interface IdentityRepositoryPort {
  findAdmission(sessionHash: string, staffUid: string): Promise<PortalAdmissionResult>;
  findStaffUser(uid: string): Promise<StaffUserRecord | null>;
  findStaffSession(sessionHash: string): Promise<StaffSessionRecord | null>;
  createSession(input: CreateSessionInput): Promise<void>;
  touchSession(sessionHash: string, lastActivityAt: string, idleExpiresAt: string): Promise<void>;
  revokeSession(sessionHash: string, revokedAt: string, reason: string): Promise<void>;
  appendAudit(input: AppendAuditInput): Promise<void>;
}
