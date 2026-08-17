import { dataConnect } from '../../bootstrap/firebase.js';
import type { PaymentRecord, PaymentRepositoryPort } from '../ports/payment.port.js';

const GET_PAYMENT_BY_WORLDPAY_CODE_GQL = `
  query GetPaymentByWorldpayCode($transactionReference: String!) {
    payments(where: { transactionReference: { eq: $transactionReference } }, limit: 1) {
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
      manualTender
      manualReference
      version
      createdAt
      updatedAt
    }
  }
`;

const GET_PAYMENT_BY_RECEIPT_HASH_GQL = `
  query GetPaymentByReceiptHash($receiptHash: String!) {
    payments(where: { receiptHash: { eq: $receiptHash } }, limit: 1) {
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
      manualTender
      manualReference
      version
      createdAt
      updatedAt
    }
  }
`;

const GET_PAYMENT_BY_ORDER_ID_GQL = `
  query GetPaymentByOrderId($orderId: UUID!, $organisationId: UUID!) {
    payments(where: { orderId: { eq: $orderId }, organisationId: { eq: $organisationId } }, limit: 5) {
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
      manualTender
      manualReference
      version
      createdAt
      updatedAt
    }
  }
`;

const LIST_TENANT_PAYMENTS_GQL = `
  query ListTenantPayments($organisationId: UUID!, $limit: Int!) {
    payments(where: { organisationId: { eq: $organisationId } }, limit: $limit) {
      id
      orderId
      patientId
      status
      amountPence
      currency
      route
      receiptHash
      transactionReference
      hostedPaymentUrl
      manualTender
      manualReference
      version
      createdAt
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
