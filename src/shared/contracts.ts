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

export interface CuraleafValidationCheck {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
}

export interface CuraleafValidationReport {
  passed: boolean;
  checkedAt: string;
  observedCustomerId: string | null;
  productSampleCount: number;
  checks: CuraleafValidationCheck[];
  message: string;
}

export interface CuraleafConnectionStatus {
  configured: boolean;
  connected: boolean;
  writeConfigured?: boolean;
  approved?: boolean;
  status?: 'not_configured' | 'credential_update_required' | 'validated' | 'connected' | 'attention';
  environment: 'test' | 'production';
  checkedAt: string;
  message?: string;
  activated?: boolean;
  maskedIdentifier?: string;
  validation?: CuraleafValidationReport;
  sampleAvailable?: boolean;
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

export interface ExpiryCheckState {
  isPaid: boolean;
  isDispatched: boolean;
  isArrivedAtPharmacy: boolean;
  recommendation: 'cancel_and_redo' | 'awaiting_delivery_redo' | 'ready_to_collect_redo';
}

export interface RedoOrderContext {
  originalOrderId: string;
  isPaidRedo: boolean;
  prefilledLineItems: Array<{ packId: string; quantity: number }>;
  originalTotalPence: number;
  priceDifferencePence: number;
  requireCuraleafAuth: true;
}

export interface CuraleafPrescription {
  id: string;
  serialNumber?: string;
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
  redoContext?: {
    originalOrderId: string | number;
    isPaidRedo: boolean;
    originalTotalPence?: number;
    priceDifferencePence?: number;
    requireCuraleafAuth?: true;
    priceResolution?: 'absorb' | 'refund_and_recharge';
  };
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
  referralSource?: string | null;
  marketingConsent?: boolean | null;
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
  quotedTotalPence?: number;
  pharmacyContributionPence?: number;
  currency: 'GBP';
  paymentRoute: 'manual' | 'worldpay';
  paymentStatus: string;
  fulfilmentStatus: string;
  paymentId?: string;
  worldpayPaymentId?: string;
  paymentTransactionReference?: string;
  refund?: OrderRefundState;
  cancellation?: OrderCancellationState;
  curaleafCancellation?: CuraleafCancellationState;
  curaleafApprovedAt?: string;
  status?: 'open' | 'archived' | 'rejected' | string;
  isExpired?: boolean;
  archivedAt?: string;
  archivedReason?: string;
  cycleStartedAt?: string;
  cycleExpiresAt?: string;
  unresolvedReason?: 'expired' | 'rejected' | null;
  redoEligible?: boolean;
  redoneByOrderId?: string | null;
  redoOfOrderId?: string | null;
  redoContext?: {
    originalOrderId: string | number;
    isPaidRedo: boolean;
    originalTotalPence?: number;
    priceDifferencePence?: number;
    requireCuraleafAuth?: boolean;
    unresolvedReason?: 'expired' | 'rejected';
    recommendation?: ExpiryCheckState['recommendation'];
    rootOrderId?: string | number;
    replacementSequence?: number;
    priceResolution?: 'absorb' | 'refund_and_recharge';
  };
  expiryCheck?: ExpiryCheckState;
  pricingQuote?: CuraleafPricingSnapshot;
  quoteReview?: {
    status: 'required' | 'approved' | 'recreate_required';
    type: 'out_of_stock' | 'patient_price_changed' | 'supplier_cost_changed';
    fingerprint: string;
    latestQuote: CuraleafQuote;
    differences: Array<{ category: 'stock' | 'patient_price' | 'supplier_cost'; field: string; packId?: string; previous: string | boolean; latest: string | boolean }>;
    checkedAt: string;
    approvedAt?: string;
    approvalNote?: string;
  };
  curaleaf?: {
    status: 'prescription_processing' | 'prescription_pending' | 'prescription_mismatch' | 'prescription_closed' | 'reconciliation_required' | 'quote_review_required' | 'purchase_order_submitted';
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

export interface OrderRefundState {
  id: string;
  status: 'pending_confirmation' | 'completed';
  amountPence: number;
  method: 'worldpay_portal' | 'pharmacy_manual';
  paymentReference: string;
  transactionReference?: string | null;
  reason: 'patient_cancelled' | 'replacement_price_changed';
  resolution: 'cancel' | 'replace_new_payment';
  requestedAt: string;
  requestedBy?: string;
  confirmedAt?: string | null;
  confirmedBy?: string | null;
  externalReference?: string | null;
}

export interface CuraleafCancellationState {
  status: 'contact_required' | 'awaiting_confirmation' | 'confirmed';
  purchaseOrderId?: string | null;
  prescriptionId?: string | null;
  supportCaseId?: string | null;
  requestedAt: string;
  requestedBy?: string | null;
  contactReference?: string | null;
  contactNote?: string | null;
  contactedAt?: string | null;
  contactedBy?: string | null;
  confirmedAt?: string | null;
  confirmedBy?: string | null;
  confirmationReference?: string | null;
}

export interface OrderCancellationState {
  status: 'curaleaf_contact_required' | 'awaiting_curaleaf_confirmation' | 'refund_required' | 'cancelled';
  reason: 'added_in_error' | 'patient_request' | 'other';
  note?: string | null;
  requestedAt: string;
  requestedBy?: string | null;
  paymentLinkStatus?: 'not_applicable' | 'cancelled_in_platform' | 'late_payment_refund_required';
  paymentReference?: string | null;
}

export interface PrescriptionUploadRequest {
  organisationId: string;
  filename: string;
  contentType: 'application/pdf' | 'image/jpeg' | 'image/png';
  sizeBytes: number;
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
  status: 'prescription_processing' | 'prescription_pending' | 'prescription_mismatch' | 'prescription_closed' | 'reconciliation_required' | 'quote_review_required' | 'purchase_order_submitted';
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
  writeApiKey: string;
  readApiKey?: string;
  /** @deprecated No longer required; ignored by the API if sent. */
  portalEmail?: string;
}

export type CuraleafSupportReason = 'prescription_exception' | 'purchase_order_cancellation' | 'quote_review' | 'supplier_exception';
export type CuraleafSupportStatus = 'open' | 'contacted' | 'resolved';

export interface CuraleafSupportCase {
  id: string;
  organisationId: string;
  orderId: string;
  reason: CuraleafSupportReason;
  status: CuraleafSupportStatus;
  note: string;
  prescriptionId: string | null;
  purchaseOrderId: string | null;
  openedBy: string;
  openedByRole: 'hhh_admin' | 'pharmacy_staff';
  openedAt: string;
  contactedAt?: string;
  resolvedAt?: string;
  updatedAt: string;
}

export interface WorldpayConnectionInput {
  organisationId: string;
  username: string;
  password: string;
  entityId: string;
}

export interface WorldpayConnectionStatus {
  configured: boolean;
  connected: boolean;
  status?: 'verification_required' | 'connected' | 'attention';
  maskedIdentifier?: string;
  updatedAt?: string;
  validation?: {
    passed: true;
    checkedAt: string;
    environment: 'try' | 'live';
    entityId: string;
  } | null;
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
  theme: 'light' | 'dark';
  textScale: 'default' | 'large' | 'larger';
  reduceMotion: boolean;
  enhancedFocus: boolean;
  underlineLinks: boolean;
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
  placementState: 'PENDING_PLACEMENT' | 'HELD_PRICE' | 'HELD_STOCK' | 'CANCELLATION_PENDING_REFUND' | 'PLACED' | 'CANCELLED_REFUNDED';
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
  overallState: 'PENDING_PLACEMENT' | 'HELD_PRICE' | 'HELD_STOCK' | 'CANCELLATION_PENDING_REFUND' | 'PLACED' | 'CANCELLED_REFUNDED';
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

export interface PortalOrganisation {
  id: string;
  orgId: string; // Parent Company ID
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
  curaleafTestValidation?: CuraleafValidationRecord | null;
  curaleafLiveValidation?: CuraleafValidationRecord | null;
}

export interface PaymentSettings {
  organisationId: string;
  pharmacyId?: string;
  defaultPaymentRoute: 'manual' | 'worldpay';
  updatedAt: string;
}

export interface AdminReferralFinanceRow {
  id: string;
  organisationId: string;
  pharmacyId?: string;
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
  pharmacyId?: string | null;
  totals: {
    eventCount: number;
    newReferralCount: number;
    annualPatientCount: number;
    amountPence: number;
  };
  byPharmacy: Array<{
    organisationId: string;
    pharmacyId?: string;
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
  pharmacyId: string | null;
  organisationId: string | null;
  profile: Record<string, unknown> | null;
  organisation: PortalOrganisation | null;
  company?: Company | null;
}

export interface PharmacyStaffAccount {
  uid: string;
  email: string;
  displayName: string;
  role: 'pharmacy_staff';
  pharmacyId: string;
  organisationId?: string;
  contactRole: 'owner' | 'staff';
  status: 'invited' | 'active' | 'disabled';
  createdAt: string;
}

export interface CreatePharmacyStaffInput {
  pharmacyId: string;
  organisationId?: string;
  email: string;
  displayName: string;
}

export interface PharmacyStaffInvitation extends PharmacyStaffAccount {
  invitationQueued: boolean;
  actionLink: string;
}
