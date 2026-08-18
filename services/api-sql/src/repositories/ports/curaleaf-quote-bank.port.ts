import type { IntegrationEnvironment } from './integration.port.js';

export type CuraleafQuoteBankSource = 'DAILY_REFRESH' | 'LIVE_QUOTE';
export type CuraleafStockStatus = 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK';

export interface CuraleafQuoteBankEntryRecord {
  environment: IntegrationEnvironment;
  packId: string;
  sourcedConnectionId: string | null;
  formulaId: string | null;
  quotedQuantity: number;
  wholesalePackPricePence: number;
  patientPackPricePence: number;
  inStock: boolean;
  stockStatus: CuraleafStockStatus | null;
  source: CuraleafQuoteBankSource;
  quotedAt: string;
  updatedAt: string;
}

export interface UpsertCuraleafQuoteBankEntryInput {
  environment: IntegrationEnvironment;
  packId: string;
  sourcedConnectionId: string;
  formulaId?: string | null;
  quotedQuantity: number;
  wholesalePackPricePence: number;
  patientPackPricePence: number;
  inStock: boolean;
  stockStatus: CuraleafStockStatus | null;
  source: CuraleafQuoteBankSource;
  quotedAt: string;
}

export interface CuraleafQuoteBankRepositoryPort {
  listEntries(environment: IntegrationEnvironment): Promise<CuraleafQuoteBankEntryRecord[]>;
  upsertEntry(input: UpsertCuraleafQuoteBankEntryInput): Promise<void>;
  upsertSync(input: {
    environment: IntegrationEnvironment;
    sourcedConnectionId: string;
    lastDailyRefreshAt?: string | null;
    packCount?: number;
    lastError?: string | null;
  }): Promise<void>;
}
