import { dataConnect } from '../../bootstrap/firebase.js';
import type { PaymentRecord, PaymentRepositoryPort, PaymentSqlStatus } from '../ports/payment.port.js';

const PAYMENT_FIELDS = `
  id
  organisationId
  orderId
  patientId
  status
  amountPence
  currency
  route
  receiptHash
  transactionReference
  hostedPaymentUrl
  linkExpiresAt
  providerPayload
  manualTender
  manualReference
  version
  createdAt
  updatedAt
`;

const GET_PAYMENT_BY_WORLDPAY_CODE_GQL = `
  query GetPaymentByWorldpayCode($transactionReference: String!) {
    payments(where: { transactionReference: { eq: $transactionReference } }, limit: 1) {
      ${PAYMENT_FIELDS}
    }
  }
`;

const GET_PAYMENT_BY_RECEIPT_HASH_GQL = `
  query GetPaymentByReceiptHash($receiptHash: String!) {
    payments(where: { receiptHash: { eq: $receiptHash } }, limit: 1) {
      ${PAYMENT_FIELDS}
    }
  }
`;

const GET_PAYMENT_BY_ORDER_ID_GQL = `
  query GetPaymentByOrderId($orderId: UUID!, $organisationId: UUID!) {
    payments(where: { orderId: { eq: $orderId }, organisationId: { eq: $organisationId } }, limit: 5) {
      ${PAYMENT_FIELDS}
    }
  }
`;

const LIST_TENANT_PAYMENTS_GQL = `
  query ListTenantPayments($organisationId: UUID!, $limit: Int!) {
    payments(where: { organisationId: { eq: $organisationId } }, limit: $limit) {
      ${PAYMENT_FIELDS}
    }
  }
`;

const LIST_PENDING_WORLDPAY_PAYMENTS_GQL = `
  query ListPendingWorldpayPayments($limit: Int!) {
    payments(
      where: {
        route: { eq: WORLDPAY }
        status: { in: [PENDING, CANCELLED, EXPIRED] }
      }
      limit: $limit
    ) {
      ${PAYMENT_FIELDS}
    }
  }
`;

const CREATE_PAYMENT_GQL = `
  mutation CreatePayment(
    $organisationId: UUID!
    $orderId: UUID!
    $patientId: UUID!
    $status: PaymentStatus!
    $amountPence: Int64!
    $currency: String!
    $route: PaymentRoute!
    $transactionReference: String
    $receiptHash: String
    $hostedPaymentUrl: String
    $linkExpiresAt: Timestamp
    $manualTender: String
    $manualReference: String
  ) {
    payment_insert(data: {
      organisationId: $organisationId
      orderId: $orderId
      patientId: $patientId
      status: $status
      amountPence: $amountPence
      currency: $currency
      route: $route
      transactionReference: $transactionReference
      receiptHash: $receiptHash
      hostedPaymentUrl: $hostedPaymentUrl
      linkExpiresAt: $linkExpiresAt
      manualTender: $manualTender
      manualReference: $manualReference
      version: 1
    })
  }
`;

const UPDATE_PAYMENT_STATUS_GQL = `
  mutation UpdatePaymentStatus(
    $id: UUID!
    $status: PaymentStatus!
    $receiptHash: String
    $orderId: UUID!
  ) {
    payment_update(
      key: { id: $id }
      data: {
        status: $status
        receiptHash: $receiptHash
        paidAt_expr: "request.time"
        updatedAt_expr: "request.time"
      }
    )
    order_update(
      key: { id: $orderId }
      data: {
        status: PROCESSING
        paymentStatus: $status
        paidAt_expr: "request.time"
        updatedAt_expr: "request.time"
      }
    )
  }
`;

const UPDATE_PAYMENT_OUTCOME_GQL = `
  mutation UpdatePaymentOutcome(
    $id: UUID!
    $status: PaymentStatus!
    $receiptHash: String
    $providerPayload: Any
  ) {
    payment_update(
      key: { id: $id }
      data: {
        status: $status
        receiptHash: $receiptHash
        providerPayload: $providerPayload
        updatedAt_expr: "request.time"
      }
    )
  }
`;

const UPDATE_ORDER_PAYMENT_STATUS_GQL = `
  mutation UpdateOrderPaymentStatus($id: UUID!, $paymentStatus: PaymentStatus!) {
    order_update(
      key: { id: $id }
      data: {
        paymentStatus: $paymentStatus
        updatedAt_expr: "request.time"
      }
    )
  }
`;

const CREATE_REFUND_GQL = `
  mutation CreateRefund(
    $organisationId: UUID!
    $paymentId: UUID!
    $amountPence: Int64!
    $currency: String!
    $status: RefundStatus!
    $reason: String!
    $idempotencyKeyHash: String!
    $issuedByUid: String!
  ) {
    refund_insert(data: {
      organisationId: $organisationId
      paymentId: $paymentId
      amountPence: $amountPence
      currency: $currency
      status: $status
      reason: $reason
      idempotencyKeyHash: $idempotencyKeyHash
      issuedByUid: $issuedByUid
    })
  }
`;

export class SqlPaymentRepository implements PaymentRepositoryPort {
  async findPaymentByWorldpayCode(worldpayOrderCode: string): Promise<PaymentRecord | null> {
    const result = await dataConnect.executeGraphql<{ payments: PaymentRecord[] }, any>(
      GET_PAYMENT_BY_WORLDPAY_CODE_GQL,
      { variables: { transactionReference: worldpayOrderCode } }
    );
    return result.data.payments?.[0] ?? null;
  }

  async findPaymentByReceiptHash(receiptHash: string): Promise<PaymentRecord | null> {
    const result = await dataConnect.executeGraphql<{ payments: PaymentRecord[] }, any>(
      GET_PAYMENT_BY_RECEIPT_HASH_GQL,
      { variables: { receiptHash } }
    );
    return result.data.payments?.[0] ?? null;
  }

  async findPaymentByOrderId(orderId: string, organisationId: string): Promise<PaymentRecord | null> {
    const result = await dataConnect.executeGraphql<{ payments: PaymentRecord[] }, any>(
      GET_PAYMENT_BY_ORDER_ID_GQL,
      { variables: { orderId, organisationId } }
    );
    return result.data.payments?.[0] ?? null;
  }

  async listTenantPayments(organisationId: string, limit = 200): Promise<PaymentRecord[]> {
    const result = await dataConnect.executeGraphql<{ payments: PaymentRecord[] }, any>(
      LIST_TENANT_PAYMENTS_GQL,
      { variables: { organisationId, limit } }
    );
    return result.data.payments ?? [];
  }

  async listPendingWorldpayPayments(limit = 200): Promise<PaymentRecord[]> {
    const result = await dataConnect.executeGraphql<{ payments: PaymentRecord[] }, any>(
      LIST_PENDING_WORLDPAY_PAYMENTS_GQL,
      { variables: { limit } }
    );
    return result.data.payments ?? [];
  }

  async createPayment(data: {
    organisationId: string;
    orderId: string;
    patientId: string;
    status: 'PENDING' | 'PAID' | 'FAILED' | 'CANCELLED';
    amountPence: number;
    currency: string;
    route: 'MANUAL' | 'WORLDPAY';
    transactionReference?: string | null;
    receiptHash?: string | null;
    hostedPaymentUrl?: string | null;
    linkExpiresAt?: string | null;
    manualTender?: string | null;
    manualReference?: string | null;
  }): Promise<{ id?: string }> {
    const result = await dataConnect.executeGraphql<{ payment_insert: { id: string } }, any>(
      CREATE_PAYMENT_GQL,
      {
        variables: {
          organisationId: data.organisationId,
          orderId: data.orderId,
          patientId: data.patientId,
          status: data.status,
          amountPence: data.amountPence,
          currency: data.currency,
          route: data.route,
          transactionReference: data.transactionReference ?? null,
          receiptHash: data.receiptHash ?? null,
          hostedPaymentUrl: data.hostedPaymentUrl ?? null,
          linkExpiresAt: data.linkExpiresAt ?? null,
          manualTender: data.manualTender ?? null,
          manualReference: data.manualReference ?? null,
        },
      }
    );
    return { id: result.data.payment_insert?.id };
  }

  async updatePaymentStatus(id: string, status: 'PAID' | 'FAILED' | 'CANCELLED', orderId: string, receiptHash?: string | null): Promise<void> {
    await dataConnect.executeGraphql<any, any>(UPDATE_PAYMENT_STATUS_GQL, {
      variables: { id, status, orderId, receiptHash: receiptHash ?? null },
    });
  }

  async updatePaymentOutcome(data: {
    id: string;
    orderId: string;
    status: PaymentSqlStatus;
    receiptHash?: string | null;
    providerPayload?: unknown;
    markOrderPaid?: boolean;
  }): Promise<void> {
    if (data.markOrderPaid || data.status === 'PAID') {
      await this.updatePaymentStatus(data.id, 'PAID', data.orderId, data.receiptHash);
      if (data.providerPayload !== undefined) {
        await dataConnect.executeGraphql<any, any>(UPDATE_PAYMENT_OUTCOME_GQL, {
          variables: {
            id: data.id,
            status: 'PAID',
            receiptHash: data.receiptHash ?? null,
            providerPayload: data.providerPayload ?? null,
          },
        });
      }
      return;
    }
    await dataConnect.executeGraphql<any, any>(UPDATE_PAYMENT_OUTCOME_GQL, {
      variables: {
        id: data.id,
        status: data.status,
        receiptHash: data.receiptHash ?? null,
        providerPayload: data.providerPayload ?? null,
      },
    });
    await dataConnect.executeGraphql<any, any>(UPDATE_ORDER_PAYMENT_STATUS_GQL, {
      variables: { id: data.orderId, paymentStatus: data.status },
    });
  }

  async createRefund(data: {
    organisationId: string;
    paymentId: string;
    amountPence: number;
    currency: string;
    status: 'SUCCEEDED' | 'PENDING' | 'FAILED';
    reason: string;
    idempotencyKeyHash: string;
    issuedByUid: string;
  }): Promise<{ id?: string }> {
    const result = await dataConnect.executeGraphql<{ refund_insert: { id: string } }, any>(
      CREATE_REFUND_GQL,
      {
        variables: {
          organisationId: data.organisationId,
          paymentId: data.paymentId,
          amountPence: data.amountPence,
          currency: data.currency,
          status: data.status,
          reason: data.reason,
          idempotencyKeyHash: data.idempotencyKeyHash,
          issuedByUid: data.issuedByUid,
        },
      }
    );
    return { id: result.data.refund_insert?.id };
  }
}
