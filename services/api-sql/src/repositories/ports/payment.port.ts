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

export interface PaymentRepositoryPort {
  findPaymentByWorldpayCode(worldpayOrderCode: string): Promise<PaymentRecord | null>;
  findPaymentByReceiptHash(receiptHash: string): Promise<PaymentRecord | null>;
  findPaymentByOrderId(orderId: string, organisationId: string): Promise<PaymentRecord | null>;
  listTenantPayments(organisationId: string, limit?: number): Promise<PaymentRecord[]>;
  listPendingWorldpayPayments(limit?: number): Promise<PaymentRecord[]>;
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
    paymentId: string;
    amountPence: number;
    currency: string;
    status: 'SUCCEEDED' | 'PENDING' | 'FAILED';
    reason: string;
    idempotencyKeyHash: string;
    issuedByUid: string;
  }): Promise<{ id?: string }>;
}
