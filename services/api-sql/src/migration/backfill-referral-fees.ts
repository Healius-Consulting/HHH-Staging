import { createHash } from 'node:crypto';
import { executeGraphqlViaFirebaseCli } from './dataconnect-cli.js';
import {
  REFERRAL_FEE_PENCE,
  dateOnlyInLondon,
} from '../application/patient-finance/patient-finance.js';

function referralFeeIdempotencyKey(patientId: string) {
  return createHash('sha256').update([patientId, 'NEW_REFERRAL'].join(':')).digest('hex');
}

type GraphqlExecutor = {
  executeGraphql<TData>(operation: string, variables?: Record<string, unknown>): Promise<{ data: TData }>;
};

const MIGRATION_ACTOR_UID = 'system:migration';
const DISPENSE_KEY = 'full';
const DRY_RUN = process.env.DRY_RUN === '1';

const LIST_COLLECTED_ORDERS_GQL = `
  query ListCollectedOrdersForReferralBackfill($limit: Int!) {
    orders(
      where: {
        _or: [
          { fulfilmentStatus: { eq: COLLECTED } }
          { status: { eq: COMPLETED } }
        ]
      }
      orderBy: [{ collectedAt: ASC }, { updatedAt: ASC }]
      limit: $limit
    ) {
      id
      organisationId
      patientId
      orderNumber
      status
      fulfilmentStatus
      collectedAt
      updatedAt
    }
  }
`;

const LIST_NEW_REFERRAL_FEES_GQL = `
  query ListNewReferralFees($limit: Int!) {
    referralFeeEvents(where: { kind: { eq: NEW_REFERRAL } }, limit: $limit) {
      patientId
    }
  }
`;

const FIND_DISPENSE_EVENT_GQL = `
  query FindDispenseEventForBackfill($orderId: UUID!, $dispenseKey: String!) {
    dispenseEvents(
      where: { orderId: { eq: $orderId }, dispenseKey: { eq: $dispenseKey } }
      limit: 1
    ) {
      id
    }
  }
`;

const INSERT_DISPENSE_EVENT_GQL = `
  mutation InsertDispenseEventForBackfill(
    $organisationId: UUID!
    $patientId: UUID!
    $orderId: UUID!
    $dispenseKey: String!
    $recordedByUid: String!
  ) {
    dispenseEvent_insert(data: {
      organisationId: $organisationId
      patientId: $patientId
      orderId: $orderId
      dispenseKey: $dispenseKey
      recordedByUid: $recordedByUid
    })
  }
`;

const INSERT_REFERRAL_FEE_EVENT_GQL = `
  mutation InsertReferralFeeEventForBackfill(
    $organisationId: UUID!
    $patientId: UUID!
    $orderId: UUID
    $kind: FeeEventKind!
    $amountPence: Int64!
    $dueDate: Date!
    $status: String!
    $idempotencyKey: String!
  ) {
    referralFeeEvent_insert(data: {
      organisationId: $organisationId
      patientId: $patientId
      orderId: $orderId
      kind: $kind
      amountPence: $amountPence
      dueDate: $dueDate
      status: $status
      idempotencyKey: $idempotencyKey
    })
  }
`;

type CollectedOrderRow = {
  id: string;
  organisationId: string;
  patientId: string;
  orderNumber: string | null;
  status: string;
  fulfilmentStatus: string;
  collectedAt: string | null;
  updatedAt: string;
};

async function createGraphqlExecutor(): Promise<GraphqlExecutor> {
  const { dataConnect } = await import('../bootstrap/firebase.js');
  try {
    await dataConnect.executeGraphql<{ orders: Array<{ id: string }> }, any>(
      'query BackfillReferralFeesAuthProbe { orders(limit: 1) { id } }',
    );
    return {
      executeGraphql<TData>(operation: string, variables: Record<string, unknown> = {}) {
        return dataConnect.executeGraphql<TData, any>(operation, { variables }) as Promise<{ data: TData }>;
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('invalid-credential') && !message.includes('invalid_grant')) {
      throw error;
    }
    console.warn('Application default credentials unavailable; using Firebase CLI auth instead.\n');
    return {
      executeGraphql: executeGraphqlViaFirebaseCli,
    };
  }
}

function eventTimestamp(order: CollectedOrderRow) {
  return order.collectedAt ?? order.updatedAt;
}

async function backfillReferralFees() {
  const graphql = await createGraphqlExecutor();
  const dryRunLabel = DRY_RUN ? ' (DRY RUN)' : '';
  console.log(`Backfilling historical referral fees${dryRunLabel}...\n`);

  const [ordersResult, feesResult] = await Promise.all([
    graphql.executeGraphql<{ orders: CollectedOrderRow[] }>(LIST_COLLECTED_ORDERS_GQL, { limit: 5000 }),
    graphql.executeGraphql<{ referralFeeEvents: Array<{ patientId: string }> }>(LIST_NEW_REFERRAL_FEES_GQL, { limit: 10000 }),
  ]);

  const orders = ordersResult.data.orders ?? [];
  const patientsWithFee = new Set((feesResult.data.referralFeeEvents ?? []).map(event => event.patientId));

  let scanned = 0;
  let skippedExistingFee = 0;
  let dispensesCreated = 0;
  let feesCreated = 0;
  let idempotentHits = 0;
  const failures: string[] = [];

  for (const order of orders) {
    scanned += 1;
    if (!order.patientId) continue;
    if (patientsWithFee.has(order.patientId)) {
      skippedExistingFee += 1;
      continue;
    }

    const collectedAt = eventTimestamp(order);
    const dueDate = dateOnlyInLondon(new Date(collectedAt));
    const idempotencyKey = referralFeeIdempotencyKey(order.patientId);

    try {
      const existingDispense = await graphql.executeGraphql<{ dispenseEvents: Array<{ id: string }> }>(
        FIND_DISPENSE_EVENT_GQL,
        { orderId: order.id, dispenseKey: DISPENSE_KEY },
      );
      const hasDispense = (existingDispense.data.dispenseEvents?.length ?? 0) > 0;

      if (DRY_RUN) {
        console.log(
          `[dry-run] ${order.orderNumber ?? order.id}: patient=${order.patientId} fee=${REFERRAL_FEE_PENCE}p due=${dueDate} dispense=${hasDispense ? 'exists' : 'create'}`,
        );
        if (!hasDispense) dispensesCreated += 1;
        feesCreated += 1;
        patientsWithFee.add(order.patientId);
        continue;
      }

      if (!hasDispense) {
        await graphql.executeGraphql(INSERT_DISPENSE_EVENT_GQL, {
          organisationId: order.organisationId,
          patientId: order.patientId,
          orderId: order.id,
          dispenseKey: DISPENSE_KEY,
          recordedByUid: MIGRATION_ACTOR_UID,
        });
        dispensesCreated += 1;
      } else {
        idempotentHits += 1;
      }

      try {
        await graphql.executeGraphql(INSERT_REFERRAL_FEE_EVENT_GQL, {
          organisationId: order.organisationId,
          patientId: order.patientId,
          orderId: order.id,
          kind: 'NEW_REFERRAL',
          amountPence: REFERRAL_FEE_PENCE,
          dueDate,
          status: 'accrued',
          idempotencyKey,
        });
        feesCreated += 1;
        patientsWithFee.add(order.patientId);
        console.log(`✔ ${order.orderNumber ?? order.id}: referral fee backfilled for patient ${order.patientId}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('idempotencyKey') || message.includes('unique') || message.includes('already exists')) {
          idempotentHits += 1;
          patientsWithFee.add(order.patientId);
          continue;
        }
        throw error;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${order.id}: ${message}`);
      console.error(`✗ ${order.orderNumber ?? order.id}: ${message}`);
    }
  }

  console.log('\nReferral fee backfill complete.');
  console.log(`Mode: ${DRY_RUN ? 'dry-run' : 'apply'}`);
  console.log(`Collected orders scanned: ${scanned}`);
  console.log(`Patients skipped (existing fee): ${skippedExistingFee}`);
  console.log(`Dispense events created: ${dispensesCreated}`);
  console.log(`Referral fees created: ${feesCreated}`);
  console.log(`Idempotent skips: ${idempotentHits}`);
  if (failures.length) {
    console.log(`Failures: ${failures.length}`);
    for (const failure of failures) console.log(`  - ${failure}`);
    process.exitCode = 1;
  }
}

void backfillReferralFees();
