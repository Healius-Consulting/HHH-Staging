export type IntegrationName = 'CURALEAF' | 'WORLDPAY';
export type IntegrationEnvironment = 'TEST' | 'PRODUCTION';
export type IntegrationStatus = 'DISCONNECTED' | 'PENDING_VALIDATION' | 'ACTIVE' | 'PAUSED' | 'ERROR';

export interface IntegrationConnectionRecord {
  id: string;
  organisationId: string;
  integration: IntegrationName;
  environment: IntegrationEnvironment;
  status: IntegrationStatus;
  secretResourceName: string | null;
  externalCustomerId: string | null;
  maskedCredential: string | null;
  validatedAt: string | null;
  lastSuccessfulAt: string | null;
  lastErrorCode: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface RestoreIntegrationConnectionInput {
  organisationId: string;
  integration: IntegrationName;
  environment: IntegrationEnvironment;
  status: IntegrationStatus;
  secretResourceName: string;
  externalCustomerId: string | null;
  maskedCredential: string | null;
}

export interface IntegrationRepositoryPort {
  listConnections(): Promise<IntegrationConnectionRecord[]>;
  findConnection(organisationId: string, integration: IntegrationName): Promise<IntegrationConnectionRecord | null>;
  restoreConnection(input: RestoreIntegrationConnectionInput): Promise<IntegrationConnectionRecord>;
}
