import { dataConnect } from '../../bootstrap/firebase.js';
import type {
  CuraleafQuoteBankEntryRecord,
  CuraleafQuoteBankRepositoryPort,
  UpsertCuraleafQuoteBankEntryInput,
} from '../ports/curaleaf-quote-bank.port.js';

const ENTRY_FIELDS = `
  organisationId connectionId packId formulaId quotedQuantity
  wholesalePackPricePence patientPackPricePence inStock stockStatus source quotedAt updatedAt
`;

const LIST_ENTRIES_GQL = `
  query ListCuraleafQuoteBankEntries($organisationId: UUID!) {
    curaleafQuoteBankEntries(
      where: { organisationId: { eq: $organisationId } }
      limit: 5000
    ) { ${ENTRY_FIELDS} }
  }
`;

const UPSERT_ENTRY_GQL = `
  mutation UpsertCuraleafQuoteBankEntry(
    $organisationId: UUID!
    $connectionId: UUID!
    $packId: String!
    $formulaId: String
    $quotedQuantity: Int!
    $wholesalePackPricePence: Int64!
    $patientPackPricePence: Int64!
    $inStock: Boolean!
    $stockStatus: CuraleafStockStatus
    $source: CuraleafQuoteBankSource!
    $quotedAt: Timestamp!
  ) {
    curaleafQuoteBankEntry_upsert(data: {
      organisationId: $organisationId
      connectionId: $connectionId
      packId: $packId
      formulaId: $formulaId
      quotedQuantity: $quotedQuantity
      wholesalePackPricePence: $wholesalePackPricePence
      patientPackPricePence: $patientPackPricePence
      inStock: $inStock
      stockStatus: $stockStatus
      source: $source
      quotedAt: $quotedAt
      updatedAt_expr: "request.time"
    })
  }
`;

const UPSERT_SYNC_GQL = `
  mutation UpsertCuraleafQuoteBankSync(
    $organisationId: UUID!
    $connectionId: UUID!
    $lastDailyRefreshAt: Timestamp
    $packCount: Int!
    $lastError: String
  ) {
    curaleafQuoteBankSync_upsert(data: {
      organisationId: $organisationId
      connectionId: $connectionId
      lastDailyRefreshAt: $lastDailyRefreshAt
      packCount: $packCount
      lastError: $lastError
      updatedAt_expr: "request.time"
    })
  }
`;

export class SqlCuraleafQuoteBankRepository implements CuraleafQuoteBankRepositoryPort {
  async listEntries(organisationId: string): Promise<CuraleafQuoteBankEntryRecord[]> {
    const result = await dataConnect.executeGraphql<{ curaleafQuoteBankEntries: CuraleafQuoteBankEntryRecord[] }, any>(
      LIST_ENTRIES_GQL,
      { variables: { organisationId } },
    );
    return result.data.curaleafQuoteBankEntries ?? [];
  }

  async upsertEntry(input: UpsertCuraleafQuoteBankEntryInput): Promise<void> {
    await dataConnect.executeGraphql(UPSERT_ENTRY_GQL, { variables: input });
  }

  async upsertSync(input: {
    organisationId: string;
    connectionId: string;
    lastDailyRefreshAt?: string | null;
    packCount?: number;
    lastError?: string | null;
  }): Promise<void> {
    await dataConnect.executeGraphql(UPSERT_SYNC_GQL, {
      variables: {
        organisationId: input.organisationId,
        connectionId: input.connectionId,
        lastDailyRefreshAt: input.lastDailyRefreshAt ?? null,
        packCount: input.packCount ?? 0,
        lastError: input.lastError ?? null,
      },
    });
  }
}
