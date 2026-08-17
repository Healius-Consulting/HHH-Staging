export interface PaymentRecord {
  id: string;
  organisationId: string;
  orderId: string;
  patientId?: string;
  status: 'PENDING' | 'PAID' | 'FAILED' | 'REFUNDED' | 'CANCELLED';
  amountPence: number;
  currency: string;
  route: 'MANUAL' | 'WORLDPAY';
  transactionReference?: string | null;
  receiptHash: string | null;
  hostedPaymentUrl?: string | null;
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
    manualTender?: string | null;
    manualReference?: string | null;
  }): Promise<{ id?: string }>;
  updatePaymentStatus(id: string, status: 'PAID' | 'FAILED' | 'CANCELLED', orderId: string, receiptHash?: string | null): Promise<void>;
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
