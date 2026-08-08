import type { DecodedIdToken } from 'firebase-admin/auth';

export type StaffRole = 'hhh_admin' | 'pharmacy_staff';

export type RequestIdentity = {
  uid: string;
  email: string | null;
  role: StaffRole;
  pharmacyId: string | null;
  organisationId: string | null; // Compatibility fallback during migration
  token: DecodedIdToken;
};

export type IntegrationName = 'curaleaf' | 'worldpay' | 'curaleaf_test' | 'curaleaf_live';

export type PlacementState =
  | 'PENDING_PLACEMENT'
  | 'HELD_PRICE'
  | 'HELD_STOCK'
  | 'CANCELLATION_PENDING_REFUND'
  | 'PLACED'
  | 'CANCELLED_REFUNDED';

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

export interface PortalOrganisation {
  id: string;
  orgId?: string;
  name: string;
  tradingName: string;
  logoText: string;
  gphcNumber: string;
  superintendent: string;
  companyNumber?: string;
  mainContactName?: string;
  mainContactPhone?: string;
  mainContactEmail?: string;
  curaleafPharmacyCode?: string;
  address: string;
  websiteDomains?: string[];
  primaryColour: string;
  status: 'onboarding' | 'live' | 'paused';
  referralToken?: string;
  platformFeeMonthly?: number | null;
  portalName?: string;
  modules?: Record<string, boolean>;
  worldpayEnabled?: boolean;
  defaultPaymentRoute?: 'manual' | 'worldpay';
  curaleafTestValidation?: CuraleafValidationRecord | null;
  curaleafLiveValidation?: CuraleafValidationRecord | null;
  gdprComplianceFlag?: boolean;
}

export interface Company {

  id: string;
  legalName: string;
  companyNumber: string;
  registeredAddress: string;
  ownerContact: {
    name: string;
    email: string;
    phone: string;
  };
  superintendent: {
    name: string;
    gphcNumber: string;
  };
  gdprConfirmed: boolean;
  gdprDocUrl: string | null;
  gdprConfirmedAt: string | null;
  gdprConfirmedBy: string | null;
  gdprComplianceFlag?: boolean;
  branchesOwned: string[];
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CuraleafValidationRecord {
  environment: 'test' | 'production';
  validatedAt: string;
  actor: string;
  maskedKey: string;
  observedCustomerId: string | null;
}

export interface PlacementLineItem {
  id: string;
  prescriptionId: string;
  orderId: string;
  formulaId: string;
  formulaName: string;
  unit: string;
  unitsNeededCount: number;
  packId: string;
  quantity: number;
  fixedPatientPricePence: number;
  allocatedDispensingFeePence: number;
  lineMedicineRevenuePence: number;
  linkSendWholesalePence: number;
  latestWholesalePence: number;
  placementState: PlacementState;
  rejectionReason?: string;
  holdEpisodeStartedAt?: string | null;
  notifiedAt48h?: string | null;
  boundaryScheduledAt?: string;
  refundId?: string | null;
  updatedAt: string;
}

export interface PrescriptionPlacement {
  id: string;
  prescriptionId: string;
  orderId: string;
  pharmacyId: string;
  lines: PlacementLineItem[];
  overallState: PlacementState;
  purchaseOrderId?: string | null;
  placedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RefundRecord {
  id: string;
  orderId: string;
  lineId: string;
  pharmacyId: string;
  amountPence: number;
  originalPaymentRef: string;
  paymentRoute: 'manual' | 'worldpay';
  cause: string;
  status: 'pending_confirmation' | 'completed';
  idempotencyKey: string;
  confirmedAt?: string | null;
  confirmedBy?: string | null;
  createdAt: string;
}

export interface SubstitutionProposal {
  id: string;
  lineId: string;
  originalPackId: string;
  substitutePackId: string;
  formulaId: string;
  formulaName: string;
  unitsTotal: number;
  quantity: number;
  wholesalePackPricePence: number;
  wholesaleTotalPence: number;
  rank: number;
}


declare global {
  namespace Express {
    interface Request {
      identity?: RequestIdentity;
      rawBody?: Buffer;
    }
  }
}

