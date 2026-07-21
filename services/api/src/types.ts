import type { DecodedIdToken } from 'firebase-admin/auth';

export type StaffRole = 'hhh_admin' | 'pharmacy_staff';

export type RequestIdentity = {
  uid: string;
  email: string | null;
  role: StaffRole;
  organisationId: string | null;
  token: DecodedIdToken;
};

export type IntegrationName = 'curaleaf' | 'worldpay';

export type FulfilmentStatus =
  | 'supplier_pending'
  | 'supplier_processing'
  | 'supplier_allocated'
  | 'dispatched_to_pharmacy'
  | 'partially_received'
  | 'received'
  | 'ready_for_collection'
  | 'collected'
  | 'exception';

export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'cancelled' | 'expired' | 'refund_required' | 'refunded' | 'reconciliation_required';

declare global {
  namespace Express {
    interface Request {
      identity?: RequestIdentity;
      rawBody?: Buffer;
    }
  }
}
