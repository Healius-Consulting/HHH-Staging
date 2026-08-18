import { dataConnect } from '../../bootstrap/firebase.js';
import type { IntegrationEnvironment } from '../ports/integration.port.js';
import type {
  CuraleafQuoteBankEntryRecord,
  CuraleafQuoteBankRepositoryPort,
  UpsertCuraleafQuoteBankEntryInput,
} from '../ports/curaleaf-quote-bank.port.js';

const ENTRY_FIELDS = `
  environment packId sourcedConnectionId formulaId quotedQuantity
  wholesalePackPricePence patientPackPricePence inStock stockStatus source quotedAt updatedAt
`;

const LIST_ENTRIES_GQL = `
  query ListCuraleafQuoteBankEntries($environment: IntegrationEnvironment!) {
    curaleafQuoteBankEntries(
      where: { environment: { eq: $environment } }
      limit: 5000
    ) { ${ENTRY_FIELDS} }
  }
`;

const UPSERT_ENTRY_GQL = `
  mutation UpsertCuraleafQuoteBankEntry(
    $environment: IntegrationEnvironment!
    $packId: String!
    $sourcedConnectionId: UUID!
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
      environment: $environment
      packId: $packId
      sourcedConnectionId: $sourcedConnectionId
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
    $environment: IntegrationEnvironment!
    $sourcedConnectionId: UUID!
    $lastDailyRefreshAt: Timestamp
    $packCount: Int!
    $lastError: String
  ) {
    curaleafQuoteBankSync_upsert(data: {
      environment: $environment
      sourcedConnectionId: $sourcedConnectionId
      lastDailyRefreshAt: $lastDailyRefreshAt
      packCount: $packCount
      lastError: $lastError
      updatedAt_expr: "request.time"
    })
  }
`;

export class SqlCuraleafQuoteBankRepository implements CuraleafQuoteBankRepositoryPort {
  async listEntries(environment: IntegrationEnvironment): Promise<CuraleafQuoteBankEntryRecord[]> {
    const result = await dataConnect.executeGraphql<{ curaleafQuoteBankEntries: CuraleafQuoteBankEntryRecord[] }, any>(
      LIST_ENTRIES_GQL,
      { variables: { environment } },
    );
    return result.data.curaleafQuoteBankEntries ?? [];
  }

  async upsertEntry(input: UpsertCuraleafQuoteBankEntryInput): Promise<void> {
    await dataConnect.executeGraphql(UPSERT_ENTRY_GQL, { variables: input });
  }

  async upsertSync(input: {
    environment: IntegrationEnvironment;
    sourcedConnectionId: string;
    lastDailyRefreshAt?: string | null;
    packCount?: number;
    lastError?: string | null;
  }): Promise<void> {
    await dataConnect.executeGraphql(UPSERT_SYNC_GQL, {
      variables: {
        environment: input.environment,
        sourcedConnectionId: input.sourcedConnectionId,
        lastDailyRefreshAt: input.lastDailyRefreshAt ?? null,
        packCount: input.packCount ?? 0,
        lastError: input.lastError ?? null,
      },
    });
  }
}
