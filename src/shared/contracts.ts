export interface PublicPharmacy {
  id: string;
  name: string;
  tradingName: string;
  logoText: string;
  gphcNumber: string;
  superintendent: string;
  address: string;
  primaryColour: string;
}

export interface EligibilitySubmissionInput {
  referralToken: string;
  firstName: string;
  surname: string;
  dob: string;
  mobile: string;
  email: string;
  postcode: string;
  conditions: string[];
  primaryCondition: string;
  tried2: boolean;
  psychExclusion: boolean;
  consentReferral: boolean;
  consentShare: boolean;
  marketing: boolean;
  source: string;
}

export type EligibilitySubmissionRecord = Omit<EligibilitySubmissionInput, 'referralToken'> & {
  id: string;
  organisationId: string;
  pharmacyName: string;
  status: 'New' | 'Under HHH review' | 'Approved' | 'Declined';
  reviewedAt: string | null;
  reviewedBy: string | null;
  decisionNote: string | null;
  recordsCheck: {
    status: 'pending' | 'completed';
    notes: string | null;
    completedAt: string | null;
    completedBy: string | null;
  };
  referral: {
    status: 'pending' | 'completed' | 'declined';
    notes: string | null;
    completedAt: string | null;
    completedBy: string | null;
  };
  emailDelivery: {
    status: 'not_sent' | 'queued' | 'sent' | 'failed';
    queuedAt: string | null;
    sentAt: string | null;
    failedAt: string | null;
  };
  patientId: string | null;
  submittedAt: string;
};

export interface EligibilitySubmissionReceipt {
  id: string;
  organisationId: string;
  pharmacyName: string;
  submittedAt: string;
}

export interface CuraleafConnectionStatus {
  configured: boolean;
  connected: boolean;
  environment: 'test' | 'production';
  checkedAt: string;
  message?: string;
  activated?: boolean;
  maskedIdentifier?: string;
}

export interface CuraleafFormula {
  formulaForm: string;
  id: string;
  printedName: string;
  state: string;
  unit: string;
}

export interface CuraleafProduct {
  customerId: string;
  formulaId: string;
  formulaName: string;
  formulaUnit: string;
  id: string;
  patientPackPrice: string;
  quantity: number;
  state: string;
}

export interface CuraleafCatalogue {
  environment: 'test' | 'production';
  fetchedAt: string;
  formulas: CuraleafFormula[];
  products: CuraleafProduct[];
  formulaTotal: number;
  productTotal: number;
}

export type CuraleafDevCatalogue = CuraleafCatalogue;

export interface CuraleafQuoteItem {
  packId: string;
  quantity: number;
  inStock: boolean;
  wholesalePackPrice: string;
  patientPackPrice: string;
}

export interface CuraleafQuote {
  shippingPrice: string;
  taxRate: string;
  items: CuraleafQuoteItem[];
}

export interface CuraleafPricingSnapshot extends CuraleafQuote {
  quotedAt: string;
  environment: 'test' | 'production';
  productTotalPence: number;
  wholesaleProductPence: number;
  shippingPence: number;
}

export interface CuraleafQuoteRequestItem {
  packId: string;
  quantity: number;
}

export interface CuraleafPurchaseOrderItem {
  id: string;
  purchaseOrderId: string;
  productId: string;
  formulaId: string;
  packSize: number;
  packsOrderedCount: number;
  packsAllocatedCount: number;
  packsReturnedCount: number;
  unit: string;
}

export interface CuraleafPurchaseOrder {
  id: string;
  state: string;
  courier: string;
  customerReference: string | null;
  issuedDate: string;
  createdAt: string;
  items: CuraleafPurchaseOrderItem[];
}

export interface CuraleafShipmentItem {
  id: string;
  shipmentId: string;
  purchaseOrderItemId: string;
  batchNumber: string;
  batchExpiryDate: string;
  packCount: number;
  packsReturnedCount: number;
  packPrice: string;
  productId: string;
  productPackSize: number;
  sku: string;
  unit: string;
  formulaId: string;
}

export interface CuraleafShipment {
  id: string;
  purchaseOrderId: string;
  purchaseOrderCustomerReference: string | null;
  purchaseOrderIssuedDate: string | null;
  shipmentCharge: string;
  taxRate: string;
  createdAt: string;
  items: CuraleafShipmentItem[];
}

export interface CuraleafPrescriber {
  id: string;
  name: string;
  initials: string;
  pin: string;
  gmcNumber: number | null;
  gphcNumber: string | null;
  state: string;
}

export interface CuraleafPrescriptionItem {
  id: string;
  prescriptionId: string;
  formulaId: string;
  formulaName: string;
  unit: string;
  unitsAssignedCount: number;
  unitsNeededCount: number;
}

export interface CuraleafPrescription {
  id: string;
  serialNumber: string;
  issueDate: string;
  expiryDate: string;
  prescriberId: string;
  prescriberName: string;
  state: string;
  items: CuraleafPrescriptionItem[];
}

export interface CuraleafActivity {
  environment: 'test' | 'production';
  fetchedAt: string;
  prescribers: CuraleafPrescriber[];
  prescriptions: CuraleafPrescription[];
  purchaseOrders: CuraleafPurchaseOrder[];
  shipments: CuraleafShipment[];
  prescriberTotal: number;
  prescriptionTotal: number;
  purchaseOrderTotal: number;
  shipmentTotal: number;
}

export interface PortalOrderInput {
  organisationId: string;
  patientId: string;
  lineItems: Array<{
    packId: string;
    quantity: number;
  }>;
  prescriptions: Array<{
    fileId: string;
    clinicScanId?: string;
    curaleafPrescriptionId?: string;
    serialNumber: string;
    issueDate: string;
    expiryDate?: string;
    patient: {
      name: string;
      dob: string;
    };
    prescriber: {
      id?: string;
      pin: string;
      gmcNumber: number | null;
      gphcNumber: string | null;
      name: string;
      initials: string;
    };
    items: Array<{
      formulaId: string;
      unitsNeededCount: number;
      packId: string;
      quantity: number;
    }>;
  }>;
  dispensingFeePence: number;
  currency: 'GBP';
}

export interface PortalPatientRecord {
  id: string;
  organisationId: string;
  firstName: string;
  surname: string;
  dob: string;
  email: string;
  mobile: string;
  address: string;
  postcode: string;
  status: 'referred' | 'active' | 'inactive';
  conditions?: string[];
  primaryCondition?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PatientRegisterExportRow {
  id: string;
  name: string;
  email: string;
  mobile: string;
  dob: string;
  organisationId: string;
  pharmacyName: string;
  gphcNumber: string;
  stage: string;
  date: string | null;
}

export interface PatientRegisterExportResult {
  rows: PatientRegisterExportRow[];
  resultCount: number;
  generatedAt: string;
  recordScopeHash: string;
}

export interface PortalOrderRecord {
  id: string;
  organisationId: string;
  patientId: string;
  lineItems: Array<{
    productId: string;
    formulaId: string;
    packId: string;
    name: string;
    quantity: number;
    unitPricePence: number;
  }>;
  prescriptions?: PortalOrderInput['prescriptions'];
  dispensingFeePence: number;
  totalPence: number;
  currency: 'GBP';
  paymentRoute: 'manual' | 'worldpay';
  paymentStatus: string;
  fulfilmentStatus: string;
  paymentId?: string;
  pricingQuote?: CuraleafPricingSnapshot;
  curaleaf?: {
    status: 'prescription_processing' | 'prescription_pending' | 'prescription_mismatch' | 'prescription_closed' | 'reconciliation_required' | 'purchase_order_submitted';
    prescriptionState?: 'ACTIVE' | 'FULFILLED' | 'EXPIRED' | 'CANCELLED' | 'PENDING';
    prescriptionId?: string;
    prescriberId?: string;
    prescriberName?: string;
    customerReference: string;
    purchaseOrderId?: string | null;
    purchaseOrderState?: 'CREATED' | 'PROCESSING' | 'FULLY_ALLOCATED' | 'CANCELLED' | null;
    courier?: string;
    shipmentIds?: string[];
    quote?: CuraleafQuote;
  };
  createdAt: string;
  updatedAt: string;
}

export interface PrescriptionUploadRequest {
  organisationId: string;
  filename: string;
  contentType: 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp';
}

export interface PrescriptionUploadTarget {
  id: string;
  uploadUrl: string;
  expiresAt: string;
  requiredHeaders: Record<string, string>;
}

export interface CuraleafManualPrescriptionInput {
  organisationId: string;
  orderId: string;
  subOrderId?: string;
  fileId: string;
  serialNumber: string;
  issueDate: string;
  prescriber: {
    pin: string;
    gmcNumber: number | null;
    gphcNumber: string | null;
    name: string;
    initials: string;
  };
  items: Array<{
    formulaId: string;
    unitsNeededCount: number;
    packId: string;
    quantity: number;
  }>;
}

export interface CuraleafSubmissionResult {
  status: 'prescription_processing' | 'prescription_pending' | 'prescription_mismatch' | 'prescription_closed' | 'reconciliation_required' | 'purchase_order_submitted';
  prescriptionState?: 'ACTIVE' | 'FULFILLED' | 'EXPIRED' | 'CANCELLED' | 'PENDING';
  prescriptionId?: string;
  prescriberId?: string;
  prescriberName?: string;
  customerReference: string;
  purchaseOrderId?: string | null;
  purchaseOrderState?: 'CREATED' | 'PROCESSING' | 'FULLY_ALLOCATED' | 'CANCELLED' | null;
  quote: CuraleafQuote;
}

export interface CuraleafClinicPrescriptionInput {
  organisationId: string;
  orderId: string;
  subOrderId?: string;
  fileId: string;
  serialNumber: string;
}

export interface CuraleafClinicScan {
  scanId: string;
  status: 'processing' | 'ready';
  prescriptionId?: string;
  prescription?: {
    id: string;
    serialNumber: string;
    state: 'ACTIVE' | 'FULFILLED' | 'EXPIRED' | 'CANCELLED' | 'PENDING';
    issueDate: string;
    expiryDate: string;
    prescriberId: string;
    prescriberName: string;
    patient: {
      name: string;
      dob: string;
    } | null;
    items: Array<{
      formulaId: string;
      formulaName: string;
      unit: string;
      unitsNeededCount: number;
      unitsAssignedCount: number;
    }>;
  };
  prescriber?: {
    id: string;
    name: string;
    initials: string;
    gmcNumber: number | null;
    gphcNumber: string | null;
  };
  matchedItems?: Array<{
    packId: string;
    formulaId: string;
    formulaName: string;
    unit: string;
    packSize: number;
    quantity: number;
    unitsNeededCount: number;
    patientPackPrice: string;
  }>;
}

export interface CuraleafActivationInput {
  organisationId: string;
  customerId: string;
  portalEmail: string;
}

export interface WorldpayConnectionInput {
  organisationId: string;
  username: string;
  password: string;
  entityId: string;
  webhookSecret: string;
}

export interface WorldpayConnectionStatus {
  configured: boolean;
  connected: boolean;
  status?: 'verification_required' | 'connected' | 'attention';
  maskedIdentifier?: string;
  updatedAt?: string;
}

export interface CreateOrganisationInput {
  name: string;
  tradingName: string;
  gphcNumber: string;
  superintendent: string;
  companyNumber?: string;
  mainContactName?: string;
  mainContactPhone?: string;
  mainContactEmail?: string;
  address: string;
  primaryColour: string;
  logoText: string;
  websiteDomains: string[];
  status: 'onboarding';
}

export interface OrganisationModules {
  intake: boolean;
  rx: boolean;
  payments: boolean;
  supplierOrders: boolean;
  patients: boolean;
  resources: boolean;
}

export interface UpdateOrganisationInput {
  name?: string;
  tradingName?: string;
  gphcNumber?: string;
  superintendent?: string;
  companyNumber?: string;
  mainContactName?: string;
  mainContactPhone?: string;
  mainContactEmail?: string;
  address?: string;
  primaryColour?: string;
  logoText?: string;
  websiteDomains?: string[];
  status?: 'onboarding' | 'live' | 'paused';
  platformFeeMonthly?: number | null;
  portalName?: string;
  modules?: OrganisationModules;
}

export interface CreatedOrganisation extends CreateOrganisationInput {
  id: string;
  referralToken: string;
  createdAt: string;
  updatedAt: string;
}

export type SetupTaskId =
  | 'pharmacy_profile'
  | 'curaleaf_account'
  | 'payment_route'
  | 'pricing'
  | 'notifications'
  | 'operational_readiness';

export interface PharmacySetupTask {
  id: SetupTaskId;
  completed: boolean;
  completedAt: string | null;
  completedBy: string | null;
  evidence: string | null;
}

export interface PharmacySetupStatus {
  organisationId: string;
  completed: boolean;
  completedCount: number;
  requiredCount: number;
  tasks: PharmacySetupTask[];
  updatedAt: string;
}

export interface UpdatePharmacySetupTaskInput {
  organisationId: string;
  completed: boolean;
  evidence?: string;
}

export interface StaffAccessibilityPreferences {
  theme: 'clinical-light' | 'clinical-dark' | 'high-contrast' | 'warm-low-glare';
  textScale: 'default' | 'large' | 'larger';
  reduceMotion: boolean;
  enhancedFocus: boolean;
  underlineLinks: boolean;
}

export interface PortalOrganisation {
  id: string;
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
  modules?: OrganisationModules;
  worldpayEnabled?: boolean;
  defaultPaymentRoute?: 'manual' | 'worldpay';
}

export interface PaymentSettings {
  organisationId: string;
  defaultPaymentRoute: 'manual' | 'worldpay';
  updatedAt: string;
}

export interface AdminReferralFinanceRow {
  id: string;
  organisationId: string;
  pharmacyName: string;
  patientId: string;
  patientName?: string;
  patientEmail?: string;
  referralSubmissionId: string | null;
  kind: 'new_referral' | 'annual_patient';
  amountPence: number;
  currency: 'GBP';
  dueDate: string;
  occurredAt: string;
}

export interface AdminReferralFinanceReport {
  currency: 'GBP';
  range: { from: string | null; to: string | null };
  organisationId: string | null;
  totals: {
    eventCount: number;
    newReferralCount: number;
    annualPatientCount: number;
    amountPence: number;
  };
  byPharmacy: Array<{
    organisationId: string;
    pharmacyName: string;
    newReferralCount: number;
    annualPatientCount: number;
    amountPence: number;
  }>;
  rows: AdminReferralFinanceRow[];
}

export interface PortalSession {
  uid: string;
  email: string | null;
  role: 'hhh_admin' | 'pharmacy_staff';
  organisationId: string | null;
  profile: Record<string, unknown> | null;
  organisation: PortalOrganisation | null;
}

export interface PharmacyStaffAccount {
  uid: string;
  email: string;
  displayName: string;
  role: 'pharmacy_staff';
  organisationId: string;
  contactRole: 'owner' | 'staff';
  status: 'invited' | 'active' | 'disabled';
  createdAt: string;
}

export interface CreatePharmacyStaffInput {
  organisationId: string;
  email: string;
  displayName: string;
}

export interface PharmacyStaffInvitation extends PharmacyStaffAccount {
  invitationQueued: boolean;
  actionLink: string;
}
