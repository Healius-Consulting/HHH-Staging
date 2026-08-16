export interface PaymentRecord {
  id: string;
  organisationId: string;
  orderId: string;
  status: 'PENDING' | 'PAID' | 'FAILED' | 'REFUNDED' | 'CANCELLED';
  amountPence: number;
  currency: string;
  route: 'MANUAL' | 'WORLDPAY';
  receiptHash: string | null;
  worldpayOrderCode: string | null;
  version: number;
  createdAt: string;
  updatedAt?: string;
}

export interface PaymentRepositoryPort {
  findPaymentByWorldpayCode(worldpayOrderCode: string): Promise<PaymentRecord | null>;
  findPaymentByReceiptHash(receiptHash: string): Promise<PaymentRecord | null>;
  listTenantPayments(organisationId: string, limit?: number): Promise<PaymentRecord[]>;
  createPayment(data: {
    organisationId: string;
    orderId: string;
    patientId?: string | null;
    status: 'PENDING' | 'PAID' | 'FAILED' | 'CANCELLED';
    amountPence: number;
    currency: string;
    route: 'MANUAL' | 'WORLDPAY';
    worldpayOrderCode?: string | null;
    receiptHash?: string | null;
  }): Promise<{ id?: string }>;
  updatePaymentStatus(id: string, status: 'PAID' | 'FAILED', orderId: string, receiptHash?: string | null): Promise<void>;
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
