export type CuraleafQuoteBankSource = 'DAILY_REFRESH' | 'LIVE_QUOTE';
export type CuraleafStockStatus = 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK';

export interface CuraleafQuoteBankEntryRecord {
  organisationId: string;
  connectionId: string;
  packId: string;
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

export interface CuraleafQuoteBankSyncRecord {
  organisationId: string;
  connectionId: string;
  lastDailyRefreshAt: string | null;
  packCount: number;
  lastError: string | null;
  updatedAt: string;
}

export interface UpsertCuraleafQuoteBankEntryInput {
  organisationId: string;
  connectionId: string;
  packId: string;
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
  listEntries(organisationId: string): Promise<CuraleafQuoteBankEntryRecord[]>;
  upsertEntry(input: UpsertCuraleafQuoteBankEntryInput): Promise<void>;
  upsertSync(input: {
    organisationId: string;
    connectionId: string;
    lastDailyRefreshAt?: string | null;
    packCount?: number;
    lastError?: string | null;
  }): Promise<void>;
}
