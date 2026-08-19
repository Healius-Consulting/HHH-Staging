export type PaymentSqlStatus =
  | 'PENDING'
  | 'PAID'
  | 'FAILED'
  | 'REFUNDED'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'REFUND_REQUIRED'
  | 'RECONCILIATION_REQUIRED';

export interface PaymentRecord {
  id: string;
  organisationId: string;
  orderId: string;
  patientId?: string;
  status: PaymentSqlStatus;
  amountPence: number;
  currency: string;
  route: 'MANUAL' | 'WORLDPAY';
  transactionReference?: string | null;
  receiptHash: string | null;
  hostedPaymentUrl?: string | null;
  linkExpiresAt?: string | null;
  providerPayload?: unknown;
  manualTender?: string | null;
  manualReference?: string | null;
  version: number;
  createdAt: string;
  updatedAt?: string;
}

export interface RefundRecord {
  id: string;
  organisationId: string;
  orderId: string;
  paymentId: string;
  status: 'PENDING_CONFIRMATION' | 'COMPLETED' | 'FAILED' | string;
  amountPence: number | string;
  currency?: string | null;
  cause?: string | null;
  route?: 'MANUAL' | 'WORLDPAY' | string | null;
  idempotencyKey?: string | null;
  externalReference?: string | null;
  confirmedByUid?: string | null;
  createdAt?: string | null;
  confirmedAt?: string | null;
}

export interface PaymentRepositoryPort {
  findPaymentByWorldpayCode(worldpayOrderCode: string): Promise<PaymentRecord | null>;
  findPaymentByReceiptHash(receiptHash: string): Promise<PaymentRecord | null>;
  findPaymentByOrderId(orderId: string, organisationId: string): Promise<PaymentRecord | null>;
  listPaymentsByOrderId(orderId: string, organisationId: string): Promise<PaymentRecord[]>;
  listTenantPayments(organisationId: string, limit?: number): Promise<PaymentRecord[]>;
  listPendingWorldpayPayments(limit?: number): Promise<PaymentRecord[]>;
  cancelPendingPaymentsForOrder(orderId: string, organisationId: string, keepId?: string | null): Promise<void>;
  createPayment(data: {
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
  }): Promise<{ id?: string }>;
  updatePaymentStatus(id: string, status: 'PAID' | 'FAILED' | 'CANCELLED', orderId: string, receiptHash?: string | null): Promise<void>;
  updatePaymentOutcome(data: {
    id: string;
    orderId: string;
    status: PaymentSqlStatus;
    receiptHash?: string | null;
    providerPayload?: unknown;
    markOrderPaid?: boolean;
  }): Promise<void>;
  createRefund(data: {
    organisationId: string;
    orderId: string;
    paymentId: string;
    amountPence: number;
    currency: string;
    cause: string;
    route: 'MANUAL' | 'WORLDPAY';
    status?: 'PENDING_CONFIRMATION' | 'COMPLETED' | 'FAILED';
    idempotencyKey: string;
    confirmedByUid?: string | null;
  }): Promise<RefundRecord>;
  listRefundsByOrderId(orderId: string, organisationId: string): Promise<RefundRecord[]>;
  listTenantRefunds(organisationId: string, limit?: number): Promise<RefundRecord[]>;
  findRefundByIdempotencyKey(idempotencyKey: string): Promise<RefundRecord | null>;
  confirmRefund(data: {
    id: string;
    externalReference: string;
    confirmedByUid: string;
  }): Promise<void>;
}
