import { dataConnect } from '../../bootstrap/firebase.js';

export type WorkerEventRecord = {
  eventKey: string;
  organisationId: string | null;
  transactionReference: string | null;
  payloadHash: string;
  status: string;
  processedAt: string | null;
  failureCode: string | null;
};

const GET_EVENT_GQL = `
  query GetIntegrationWebhookEvent($eventKey: String!) {
    integrationWebhookEvent(key: { eventKey: $eventKey }) {
      eventKey
      organisationId
      transactionReference
      payloadHash
      status
      processedAt
      failureCode
    }
  }
`;

const INSERT_EVENT_GQL = `
  mutation InsertIntegrationWebhookEvent(
    $eventKey: String!
    $integration: IntegrationName!
    $organisationId: UUID
    $transactionReference: String
    $payloadHash: String!
    $status: OperationStatus!
  ) {
    integrationWebhookEvent_insert(data: {
      eventKey: $eventKey
      integration: $integration
      organisationId: $organisationId
      transactionReference: $transactionReference
      payloadHash: $payloadHash
      status: $status
    })
  }
`;

const UPDATE_EVENT_GQL = `
  mutation UpdateIntegrationWebhookEvent(
    $eventKey: String!
    $payloadHash: String!
    $status: OperationStatus!
    $transactionReference: String
    $failureCode: String
  ) {
    integrationWebhookEvent_update(
      key: { eventKey: $eventKey }
      data: {
        payloadHash: $payloadHash
        status: $status
        transactionReference: $transactionReference
        failureCode: $failureCode
        processedAt_expr: "request.time"
      }
    )
  }
`;

export class SqlWorkerEventRepository {
  async find(eventKey: string): Promise<WorkerEventRecord | null> {
    const result = await dataConnect.executeGraphql<{ integrationWebhookEvent: WorkerEventRecord | null }, any>(
      GET_EVENT_GQL,
      { variables: { eventKey } },
    );
    return result.data.integrationWebhookEvent ?? null;
  }

  async remember(input: {
    eventKey: string;
    integration: 'CURALEAF' | 'WORLDPAY';
    organisationId?: string | null;
    transactionReference?: string | null;
    payloadHash: string;
    status?: 'PENDING' | 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED';
  }): Promise<boolean> {
    const existing = await this.find(input.eventKey);
    if (existing) return false;
    try {
      await dataConnect.executeGraphql(INSERT_EVENT_GQL, {
        variables: {
          eventKey: input.eventKey,
          integration: input.integration,
          organisationId: input.organisationId ?? null,
          transactionReference: input.transactionReference ?? null,
          payloadHash: input.payloadHash,
          status: input.status ?? 'SUCCEEDED',
        },
      });
      return true;
    } catch {
      return false;
    }
  }

  async upsertCursor(input: {
    eventKey: string;
    integration: 'CURALEAF' | 'WORLDPAY';
    organisationId?: string | null;
    cursorAt: string;
  }): Promise<void> {
    const existing = await this.find(input.eventKey);
    if (!existing) {
      await this.remember({
        eventKey: input.eventKey,
        integration: input.integration,
        organisationId: input.organisationId,
        transactionReference: input.cursorAt,
        payloadHash: input.cursorAt,
        status: 'SUCCEEDED',
      });
      return;
    }
    await dataConnect.executeGraphql(UPDATE_EVENT_GQL, {
      variables: {
        eventKey: input.eventKey,
        payloadHash: input.cursorAt,
        status: 'SUCCEEDED',
        transactionReference: input.cursorAt,
        failureCode: null,
      },
    });
  }
}
