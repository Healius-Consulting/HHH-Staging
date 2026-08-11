import { createContext, useContext, useReducer, useEffect, type ReactNode } from 'react';
import { getCuraleafCatalogue, getCuraleafConnectionStatus, getCuraleafTrainingCatalogue, getDevCuraleafCatalogue, getPortalEligibilitySubmissions, getPortalOrders, getPortalPatients, isApiConfigured } from '../shared/api';
import type { CuraleafCancellationState, CuraleafCatalogue, OrderCancellationState, OrderRefundState, PortalOrderRecord } from '../shared/contracts';
import { isLocalPortalPreview, localPortalPreview } from '../dev/localPortalPreview';
import { checkPatientIdentity } from '../utils/patientIdentity';
import { canCreateOrderForPatient } from '../utils/patientOrderEligibility';
import { portalPrescriptionStatus } from '../utils/portalPrescriptionStatus';

/* ═══════════════════════════════════════════════════════════
   Types
   ═══════════════════════════════════════════════════════════ */

export interface CatalogueItem {
  id: string;
  formulaId?: string;
  name: string;
  cost: number | null; // Order-specific wholesale price from a Curaleaf quote.
  retail: number;      // Curaleaf's authoritative patient pack price.
  availability: 'unknown' | 'in' | 'out';
  type: 'oil' | 'flos' | 'capsule' | 'lozenge' | 'vape' | 'other';
  unit?: string;
  packSize?: number;
  source?: 'curaleaf' | 'training';
  supplierState?: string;
}

export interface CRMPatient {
  id: string;
  organisationId: string;
  name: string;
  email: string;
  mobile: string;
  dob?: string;
  address?: string;
  conditions?: string[];
  primaryCondition?: string | null;
  referralSource?: string | null;
  marketingConsent?: boolean | null;
  status: 'Referred' | 'HHH approved' | 'Suspended';
  interactions?: { ts: Date | string; type: string; detail: string }[];
}

export interface LineItem {
  productId: string;
  formulaId?: string;
  name: string;
  qty: number;
  unitsNeededCount?: number;
  cost: number | null;
  retail: number;
}

export type RxStatus =
  | 'draft'
  | 'awaiting-approval'
  | 'approved'
  | 'dispatched'
  | 'partially-received'
  | 'received'
  | 'ready'
  | 'collected';

export interface GoodsReceiptLine {
  productId: string;
  quantityReceived: number;
}

export interface Prescription {
  id: number;
  entryMode: 'clinic' | 'manual';
  clinicScanId?: string;
  curaleafPrescriptionId?: string;
  curaleafPrescriptionState?: 'ACTIVE' | 'FULFILLED' | 'EXPIRED' | 'CANCELLED' | 'PENDING';
  curaleafPatientName?: string;
  curaleafPatientDob?: string;
  prescriber: string;
  prescriberId?: string;
  prescriberPin?: string;
  prescriberGmcNumber?: string;
  prescriberGphcNumber?: string;
  serialNumber?: string;
  issueDate?: string;
  expiryDate?: string;
  copyFileName: string | null;
  fileId?: string | null;
  items: LineItem[];
  placed: boolean;
  poRef: string | null;
  status: RxStatus;
  invoiceRef: string | null;
  trackingNumber: string | null;
  carrier: string | null;
  shipmentId?: string;
  receivedItems?: GoodsReceiptLine[];
  goodsInAt?: Date | string | null;
  goodsInBy?: string | null;
  goodsInNote?: string | null;
  readyAt?: Date | string | null;
}

export type PaymentStatus = 'none' | 'sent' | 'paid' | 'cancelled';
export type PaymentRoute = 'worldpay' | 'pharmacy' | null;
export type ManualTender = 'epos-card' | 'cash' | 'bank-transfer' | 'other';

export type UnresolvedOrderReason = 'expired' | 'rejected';

export interface OrderRedoContext {
  originalOrderId: number;
  originalBackendId?: string;
  rootOrderId?: number;
  rootBackendId?: string;
  replacementSequence?: number;
  priceResolution?: 'absorb' | 'refund_and_recharge';
  isPaidRedo: boolean;
  reason: UnresolvedOrderReason;
}

function replacementSuffix(sequence: number) {
  let value = Math.max(1, Math.floor(sequence));
  let suffix = '';
  while (value > 0) {
    value -= 1;
    suffix = String.fromCharCode(65 + (value % 26)) + suffix;
    value = Math.floor(value / 26);
  }
  return suffix;
}

export function orderReference(order: PatientOrder) {
  if (!order.redoContext) return `#${order.id}`;
  const root = order.redoContext.rootOrderId ?? order.redoContext.originalOrderId;
  return `#${root}${replacementSuffix(order.redoContext.replacementSequence ?? 1)}`;
}

export interface PatientOrder {
  id: number;
  backendId?: string;
  organisationId: string;
  patientId: string | null;
  date: Date;
  dispensingFee: number;
  payment: {
    status: PaymentStatus;
    route: PaymentRoute;
    amount: number;
    ref: string | null;
    sentAt: Date | null;
    paidAt: Date | null;
    manualTender: ManualTender | null;
    manualReference: string | null;
    manualNotes: string | null;
    manualRecordedBy: string | null;
  };
  prescriptions: Prescription[];
  curaleafApprovedAt?: Date | string | null;
  refund?: OrderRefundState;
  cancellation?: OrderCancellationState;
  curaleafCancellation?: CuraleafCancellationState;
  pharmacyContribution?: number;
  quoteReview?: PortalOrderRecord['quoteReview'];
  redoContext?: OrderRedoContext;
  lifecycleStatus?: string;
  isExpired?: boolean;
  unresolvedReason?: UnresolvedOrderReason | null;
  redoEligible?: boolean;
  redoneByOrderId?: string | null;
  cycleExpiresAt?: string;
  expiryCheck?: PortalOrderRecord['expiryCheck'];
}

/** Archived (28-day expired) or Curaleaf-rejected orders that still need a redo. */
export function getUnresolvedReason(order: PatientOrder, now = new Date()): UnresolvedOrderReason | null {
  if (order.payment.status === 'none') return null;
  if (order.prescriptions.length > 0 && order.prescriptions.every(prescription => prescription.status === 'collected')) return null;
  if (order.redoneByOrderId) return null;
  if (order.unresolvedReason === 'expired' || order.unresolvedReason === 'rejected') return order.unresolvedReason;
  if (order.redoEligible === false) return null;
  if (order.quoteReview?.status === 'recreate_required' || order.quoteReview) return 'rejected';
  if (order.lifecycleStatus === 'archived' || order.isExpired) return 'expired';
  const entryDate = new Date(order.date);
  const expiryDate = order.cycleExpiresAt ? new Date(order.cycleExpiresAt) : (() => {
    const value = new Date(entryDate);
    value.setDate(value.getDate() + 28);
    return value;
  })();
  if (now > expiryDate) return 'expired';
  return null;
}

export type SubmissionStatus = 'New' | 'Under HHH review' | 'Approved' | 'Declined';

export interface EligibilitySubmission {
  id: number | string;
  name: string;
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
  status: SubmissionStatus;
  calls: { ts: Date }[];
  reviewedAt: Date | string | null;
  reviewedBy: string | null;
  decisionNote: string | null;
  recordsCheck?: {
    status: 'pending' | 'completed';
    notes: string | null;
    completedAt: Date | string | null;
    completedBy: string | null;
  };
  referral?: {
    status: 'pending' | 'completed' | 'declined';
    notes: string | null;
    completedAt: Date | string | null;
    completedBy: string | null;
  };
  emailDelivery?: {
    status: 'not_sent' | 'queued' | 'sent' | 'failed';
    queuedAt: Date | string | null;
    sentAt: Date | string | null;
    failedAt: Date | string | null;
  };
  patientId?: string | null;
  submittedAt: Date;
  organisationId: string;
  pharmacyName: string;
  referralToken: string;
}

export interface PharmacyTenant {
  id: string;
  slug: string;
  referralToken: string;
  name: string;
  tradingName: string;
  logoText: string;
  emailLogoUrl?: string | null;
  emailLogoStoragePath?: string | null;
  emailLogoWidth?: number | null;
  emailLogoHeight?: number | null;
  emailLogoUpdatedAt?: Date | string | null;
  gphcNumber: string;
  superintendent: string;
  companyNumber?: string;
  mainContactName?: string;
  mainContactPhone?: string;
  mainContactEmail?: string;
  curaleafPharmacyCode?: string;
  address: string;
  websiteDomains: string[];
  status: 'live' | 'onboarding' | 'paused';
  staffCount: number;
  platformFeeMonthly: number | null;
  defaultPaymentRoute: 'manual' | 'worldpay';
  brand: {
    primary: string;
    portalName: string;
  };
  modules: Record<TenantModule, boolean>;
  worldpay: {
    enabled: boolean;
    status: 'not-connected' | 'onboarding' | 'connected' | 'action-required';
    environment: 'sandbox' | 'live';
    merchantId: string | null;
    merchantName: string | null;
    lastSyncedAt: Date | string | null;
  };
}

export const PLATFORM_OPERATOR = {
  operatingName: 'Healius Consulting',
  platformName: 'HHH',
  platformLongName: 'Holistic Health Hub',
  legalName: null as string | null,
  companyNumber: null as string | null,
  registeredOffice: null as string | null,
  website: 'www.healiusconsulting.com',
  contactEmail: 'spatel@healiusconsulting.com',
} as const;

export type TenantModule = 'intake' | 'rx' | 'payments' | 'supplierOrders' | 'patients' | 'resources';

export type ComplianceStatus = 'not-started' | 'in-progress' | 'ready' | 'not-applicable' | 'blocked';

export interface ComplianceItem {
  id: string;
  organisationId: string | null;
  category: 'Data protection' | 'Pharmacy governance' | 'Payments' | 'Security' | 'Clinical scope' | 'Contracts';
  requirement: string;
  reference: string;
  owner: string;
  status: ComplianceStatus;
  requiredForLive: boolean;
  evidence: string | null;
  reviewDate: string | null;
}

export interface PlatformIntegration {
  id: 'curaleaf' | 'worldpay' | 'eligibility-api' | 'notifications';
  name: string;
  description: string;
  status: 'connected' | 'pending' | 'attention';
}

export type Screen = 'home' | 'formulary' | 'create' | 'orders' | 'patients' | 'finance' | 'settings';

export type NavigationTarget =
  | { kind: 'patient'; id: string }
  | { kind: 'order'; key: string }
  | { kind: 'catalogue'; query: string }
  | null;

export type PortalMode = 'gateway' | 'admin' | 'clinician';
export type WorkspaceMode = 'training' | 'live';

export interface StaffSession {
  email: string;
  name: string;
  role: 'admin' | 'pharmacy';
  organisationId?: string;
}

export interface Toast {
  id: string;
  message: string;
  type: 'success' | 'info' | 'warning' | 'error';
}

export interface AppState {
  screen: Screen;
  screenHistory: Screen[];
  navigationTarget: NavigationTarget;
  catalogue: CatalogueItem[];
  catalogueSource: 'curaleaf' | 'training' | 'unavailable';
  catalogueLoading: boolean;
  catalogueError: string | null;
  catalogueUpdatedAt: string | null;
  crm: CRMPatient[];
  submissions: EligibilitySubmission[];
  orders: PatientOrder[];
  activeOrderId: number | null;
  toasts: Toast[];
  nextIds: {
    patient: number;
    rx: number;
    order: number;
    submission: number;
    invoice: number;
  };
  portalMode: PortalMode;
  workspaceMode: WorkspaceMode;
  organisations: PharmacyTenant[];
  currentOrganisationId: string;
  staffSession: StaffSession | null;
  platformIntegrations: PlatformIntegration[];
  complianceItems: ComplianceItem[];
}

/* ═══════════════════════════════════════════════════════════
   Seed Data
   ═══════════════════════════════════════════════════════════ */

export const ORGANISATIONS: PharmacyTenant[] = [
  {
    id: '3e9f74ff-4fed-497d-904d-4d3ee3e5e126', slug: 'primary-branch', referralToken: 'primary-branch-7x4p9k',
    name: 'Primary Branch', tradingName: 'Primary Branch', logoText: 'PB',
    gphcNumber: '1099224', superintendent: 'Shaylen Patel', companyNumber: '1099224', mainContactName: 'Shaylen Patel', mainContactPhone: '0113 000 0000', mainContactEmail: 'pharmacy@primarybranch.co.uk', curaleafPharmacyCode: '109c6bca-585a-4b69-b6bb-072e0731dd10',
    address: 'Leeds, West Yorkshire, United Kingdom', websiteDomains: ['primarybranch.co.uk'],
    status: 'live', staffCount: 4,
    platformFeeMonthly: null,
    defaultPaymentRoute: 'worldpay',
    brand: { primary: '#0f766e', portalName: 'Primary Branch' },
    modules: { intake: true, rx: true, payments: true, supplierOrders: true, patients: true, resources: true },
    worldpay: { enabled: true, status: 'connected', environment: 'sandbox', merchantId: 'WP-PRIMARY-BRANCH', merchantName: 'Primary Branch', lastSyncedAt: new Date(Date.now() - 18 * 60 * 1000) },
  },
  {
    id: '6d0176bb-89a0-4e32-9bce-c934c9557c42', slug: 'eastwood-health-pharmacy', referralToken: 'eastwood-3m8q2v',
    name: 'Eastwood Health Pharmacy', tradingName: 'Eastwood Health Ltd', logoText: 'EH',
    gphcNumber: '9012726', superintendent: 'Shaylen Patel', companyNumber: '9012726', mainContactName: 'Shaylen Patel', mainContactPhone: '01522 000 000', mainContactEmail: 'contact@eastwoodhealthpharmacy.co.uk', curaleafPharmacyCode: '04568c82-b3d2-4082-9277-3313b48d10f4',
    address: 'Nottinghamshire, United Kingdom', websiteDomains: ['eastwoodhealthpharmacy.co.uk'],
    status: 'live', staffCount: 2,
    platformFeeMonthly: null,
    defaultPaymentRoute: 'manual',
    brand: { primary: '#1e40af', portalName: 'Eastwood Health Pharmacy' },
    modules: { intake: true, rx: true, payments: true, supplierOrders: true, patients: true, resources: true },
    worldpay: { enabled: false, status: 'not-connected', environment: 'sandbox', merchantId: null, merchantName: null, lastSyncedAt: null },
  },
  {
    id: '70913a30-71c3-4a41-952e-d532927af58c', slug: 'primary-branch', referralToken: 'primary-br-9k2p',
    name: 'Primary Branch', tradingName: 'Primary Branch', logoText: 'PB',
    gphcNumber: 'TRAINING-PHARM1', superintendent: 'Shaylen Patel', companyNumber: '1099224', mainContactName: 'Shaylen Patel', mainContactPhone: '0113 000 0000', mainContactEmail: 'spatel@healiusconsulting.com', curaleafPharmacyCode: '109c6bca-585a-4b69-b6bb-072e0731dd10',
    address: 'Primary Training Branch, United Kingdom', websiteDomains: ['training-pharm1.co.uk'],
    status: 'live', staffCount: 2,
    platformFeeMonthly: null,
    defaultPaymentRoute: 'manual',
    brand: { primary: '#0f766e', portalName: 'Primary Branch' },
    modules: { intake: true, rx: true, payments: true, supplierOrders: true, patients: true, resources: true },
    worldpay: { enabled: false, status: 'not-connected', environment: 'sandbox', merchantId: null, merchantName: null, lastSyncedAt: null },
  },
  {
    id: 'f486a221-2236-44a5-b072-f06de399ab0e', slug: 'alternate-branch', referralToken: 'alternate-br-4b1',
    name: 'Alternate Branch', tradingName: 'Alternate Branch', logoText: 'AB',
    gphcNumber: 'TRAINING-PHARM2', superintendent: 'Shaylen Patel', companyNumber: '9012726', mainContactName: 'Shaylen Patel', mainContactPhone: '01522 000 000', mainContactEmail: 'shaylenpatel.locum@hotmail.com', curaleafPharmacyCode: '04568c82-b3d2-4082-9277-3313b48d10f4',
    address: 'Alternate Training Branch, United Kingdom', websiteDomains: ['training-pharm2.co.uk'],
    status: 'live', staffCount: 2,
    platformFeeMonthly: null,
    defaultPaymentRoute: 'manual',
    brand: { primary: '#1e40af', portalName: 'Alternate Branch' },
    modules: { intake: true, rx: true, payments: true, supplierOrders: true, patients: true, resources: true },
    worldpay: { enabled: false, status: 'not-connected', environment: 'sandbox', merchantId: null, merchantName: null, lastSyncedAt: null },
  },
];



const SEED_CRM: CRMPatient[] = [
  { id: 'P-1001', organisationId: ORGANISATIONS[0].id, name: 'James Doe',        email: 'j.doe@email.com',      mobile: '07700 900111', dob: '1988-06-14', address: '12 High St, Leeds LS1 4AB',     conditions: ['chronic-pain', 'low-back-pain-and-sciatica'], primaryCondition: 'chronic-pain', referralSource: 'Google', marketingConsent: false, status: 'HHH approved' },
  { id: 'P-1002', organisationId: ORGANISATIONS[0].id, name: 'Aisha Smith',      email: 'a.smith@email.com',    mobile: '07700 900222', dob: '1992-09-03', address: '4 Oak Rd, Leeds LS2 8PQ',       status: 'HHH approved',
    conditions: ['anxiety', 'insomnia'], primaryCondition: 'anxiety', referralSource: 'Pharmacy website', marketingConsent: true,
    interactions: [
      { ts: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000), type: 'Invoice Dispatched', detail: 'Sent Worldpay invoice link for £48.00.' },
      { ts: new Date(Date.now() - 12 * 24 * 60 * 60 * 1000), type: 'Prescription Ready', detail: 'Meds received from wholesaler. Sent counter collection alert SMS.' }
    ]
  },
  { id: 'P-1003', organisationId: ORGANISATIONS[0].id, name: 'Mohammed Khan',    email: 'm.khan@email.com',     mobile: '07700 900333', dob: '1979-12-21', address: '9 Park Ave, Leeds LS6 1RT',     conditions: ['neuropathic-pain'], primaryCondition: 'neuropathic-pain', referralSource: 'Patient recommendation', marketingConsent: false, status: 'HHH approved' },
  { id: 'P-1004', organisationId: ORGANISATIONS[0].id, name: 'Sophie Bennett',   email: 's.bennett@email.com',  mobile: '07700 900444', dob: '1987-04-11', address: '27 Cardigan Rd, Leeds LS6 3AA', status: 'HHH approved',
    conditions: ['insomnia'], primaryCondition: 'insomnia', referralSource: 'Text message', marketingConsent: false,
    interactions: [
      { ts: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000), type: 'Meds Collected', detail: 'Training record: medicine collected at the pharmacy counter.' }
    ]
  },
  { id: 'P-1005', organisationId: ORGANISATIONS[0].id, name: "Daniel O'Connor",  email: 'd.oconnor@email.com',  mobile: '07700 900555', dob: '1991-01-30', address: '8 Burley St, Leeds LS3 1JX',    conditions: ['post-traumatic-stress-disorder'], primaryCondition: 'post-traumatic-stress-disorder', referralSource: 'HHH social media', marketingConsent: true, status: 'HHH approved' },
  { id: 'P-1006', organisationId: ORGANISATIONS[0].id, name: 'Priya Patel',      email: 'p.patel@email.com',    mobile: '07700 900666', dob: '1984-08-16', address: '15 Roundhay Rd, Leeds LS8 5AQ', conditions: ['fibromyalgia', 'chronic-pain'], primaryCondition: 'fibromyalgia', referralSource: 'In-pharmacy leaflet', marketingConsent: false, status: 'HHH approved' },
  { id: 'P-1007', organisationId: ORGANISATIONS[0].id, name: 'Liam Murphy',      email: 'l.murphy@email.com',   mobile: '07700 900777', dob: '1975-05-24', address: '3 Kirkstall Ln, Leeds LS5 3BW', conditions: ['arthritis'], primaryCondition: 'arthritis', referralSource: 'Google', marketingConsent: false, status: 'HHH approved' },
  { id: 'P-1008', organisationId: ORGANISATIONS[0].id, name: 'Grace Thompson',   email: 'g.thompson@email.com', mobile: '07700 900888', dob: '1996-10-08', address: '41 Otley Rd, Leeds LS16 5JT',   conditions: ['migraine'], primaryCondition: 'migraine', referralSource: 'Pharmacy website', marketingConsent: true, status: 'HHH approved' },
  { id: 'P-1009', organisationId: ORGANISATIONS[1].id, name: 'Daniel Price',     email: 'd.price@email.com',    mobile: '07700 900503', dob: '1977-07-23', address: 'LS2 7DR',                       status: 'HHH approved' },
];

/* ═══════════════════════════════════════════════════════════
   Helpers
   ═══════════════════════════════════════════════════════════ */

export const money = (n: number) => '£' + n.toFixed(2);
export const marginPct = (cost: number | null, retail: number) => cost !== null && retail > 0 ? Math.round((1 - cost / retail) * 100) : null;

export const lineRevenue = (item: LineItem) => item.retail * item.qty;
export const lineCost = (item: LineItem) => (item.cost ?? 0) * item.qty;
export const lineMargin = (item: LineItem) => {
  if (item.cost === null) return null;
  const rev = lineRevenue(item);
  return rev > 0 ? Math.round((rev - lineCost(item)) / rev * 100) : 0;
};

function prescriptionDateIsCurrent(prescription: Prescription, now = new Date()) {
  if (!prescription.issueDate) return false;
  const issueDate = new Date(`${prescription.issueDate}T00:00:00`);
  if (Number.isNaN(issueDate.getTime()) || issueDate.getTime() > now.getTime()) return false;
  const expiryDate = prescription.expiryDate
    ? new Date(`${prescription.expiryDate}T23:59:59.999`)
    : new Date(issueDate.getTime() + 28 * 24 * 60 * 60 * 1000);
  return !Number.isNaN(expiryDate.getTime()) && expiryDate.getTime() >= now.getTime();
}

function prescriptionIsPaymentReady(prescription: Prescription, patient: CRMPatient) {
  const sourceVerified = prescription.entryMode === 'manual'
    ? Boolean(prescription.serialNumber?.trim())
    : Boolean(prescription.clinicScanId && prescription.curaleafPrescriptionId);
  const prescriberComplete = Boolean(
    prescription.issueDate
    && prescription.prescriber.trim()
    && (prescription.entryMode === 'manual' ? prescription.prescriberPin?.trim() : prescription.prescriberId),
  );
  const medicinesComplete = prescription.items.length > 0 && prescription.items.every(item => (
    Boolean(item.productId && item.formulaId)
    && Number.isInteger(item.qty) && item.qty > 0
    && Number.isInteger(item.unitsNeededCount) && item.unitsNeededCount! > 0
    && Number.isFinite(item.retail) && item.retail > 0
  ));
  return Boolean(prescription.copyFileName)
    && sourceVerified
    && prescriberComplete
    && prescriptionDateIsCurrent(prescription)
    && medicinesComplete
    && checkPatientIdentity({
      selectedName: patient.name,
      selectedDob: patient.dob,
      prescriptionName: prescription.curaleafPatientName,
      prescriptionDob: prescription.curaleafPatientDob,
    }).status === 'match';
}

export const rxRevenue = (rx: Prescription) => rx.items.reduce((t, i) => t + lineRevenue(i), 0);
export const rxCost = (rx: Prescription) => rx.items.reduce((t, i) => t + lineCost(i), 0);
export const orderRevenue = (o: PatientOrder) => o.prescriptions.reduce((t, r) => t + rxRevenue(r), 0) + (o.dispensingFee || 0);
export const orderCost = (o: PatientOrder) => o.prescriptions.reduce((t, r) => t + rxCost(r), 0);

export const TYPE_LABELS: Record<string, string> = {
  flos: 'Flower (Flos)', oil: 'Oil', capsule: 'Capsule', lozenge: 'Lozenge / Pastille', vape: 'Vape', other: 'Other',
};

function catalogueType(form: string | undefined): CatalogueItem['type'] {
  if (form === 'FLOS' || form === 'GRANULATE' || form === 'SHAKE' || form === 'PRE_ROLL') return 'flos';
  if (form === 'OIL' || form === 'ORAL_DROPS' || form === 'ORAL_SPRAY') return 'oil';
  if (form === 'CAPSULE') return 'capsule';
  if (form === 'LOZENGE' || form === 'PASTILLE') return 'lozenge';
  if (form === 'VAPE_CARTRIDGE' || form === 'DEVICE') return 'vape';
  return 'other';
}

function mapCuraleafCatalogue(catalogue: CuraleafCatalogue): CatalogueItem[] {
  const formulaById = new Map(catalogue.formulas.map(formula => [formula.id, formula]));
  return catalogue.products
    .filter(product => {
      const name = product.formulaName || formulaById.get(product.formulaId)?.printedName || '';
      return !/(?:BPTEST|onerror\s*=|<(?:script|img|a|b)\b)/i.test(name);
    })
    .map(product => {
      const formula = formulaById.get(product.formulaId);
      const packSize = Math.max(0, Number(product.quantity) || 0);
      const patientPackPrice = Math.max(0, Number(product.patientPackPrice) || 0);
      return {
        id: product.id,
        formulaId: product.formulaId,
        name: product.formulaName || formula?.printedName || product.id,
        cost: null,
        retail: patientPackPrice,
        availability: 'unknown' as const,
        type: catalogueType(formula?.formulaForm),
        unit: product.formulaUnit || formula?.unit,
        packSize,
        source: 'curaleaf' as const,
        supplierState: product.state,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export const RX_STATUS_LABELS: Record<RxStatus, string> = {
  draft: 'Draft',
  'awaiting-approval': 'Awaiting supplier approval',
  approved: 'Approved',
  dispatched: 'Dispatched to pharmacy',
  'partially-received': 'Partially received',
  received: 'Received — checks required',
  ready: 'Ready for collection',
  collected: 'Collected by patient',
};

const params = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
const token = params.get('token');
const urlOrganisation = ORGANISATIONS.find(org => org.referralToken === token) ?? ORGANISATIONS[0];
const PORTAL_ORDER_SYNC_INTERVAL_MS = 15_000;

export const PHARMACY = {
  name: urlOrganisation.name,
  initials: urlOrganisation.logoText,
  logoText: urlOrganisation.logoText,
  formUrl: `?mode=eligibility&token=${urlOrganisation.referralToken}`,
  brandName: `${urlOrganisation.tradingName} × Curaleaf`,
  collectionPlace: urlOrganisation.tradingName,
};

/* ═══════════════════════════════════════════════════════════
   Actions
   ═══════════════════════════════════════════════════════════ */

export type Action =
  | { type: 'SET_PORTAL_MODE'; mode: PortalMode }
  | { type: 'SET_WORKSPACE_MODE'; mode: WorkspaceMode; organisationId?: string }
  | { type: 'SIGN_IN_STAFF'; session: StaffSession }
  | { type: 'SIGN_OUT_STAFF' }
  | { type: 'SET_CURRENT_ORGANISATION'; organisationId: string }
  | { type: 'SET_ORGANISATIONS'; organisations: PharmacyTenant[] }
  | { type: 'ADD_ORGANISATION'; organisation: PharmacyTenant }
  | { type: 'UPDATE_ORGANISATION'; organisationId: string; updates: Partial<PharmacyTenant> }
  | { type: 'UPDATE_WORLDPAY'; organisationId: string; updates: Partial<PharmacyTenant['worldpay']> }
  | { type: 'UPDATE_COMPLIANCE'; itemId: string; status: ComplianceStatus; evidence?: string }
  | { type: 'UPDATE_PLATFORM_INTEGRATION'; integrationId: PlatformIntegration['id']; status: PlatformIntegration['status']; description?: string }
  | { type: 'SET_SCREEN'; screen: Screen }
  | { type: 'GO_BACK' }
  | { type: 'SET_NAVIGATION_TARGET'; target: NavigationTarget }
  | { type: 'CLEAR_NAVIGATION_TARGET' }
  | { type: 'SET_CATALOGUE_LOADING' }
  | { type: 'SET_CATALOGUE'; catalogue: CatalogueItem[]; updatedAt: string }
  | { type: 'SET_CATALOGUE_ERROR'; message: string }
  | { type: 'APPLY_CURALEAF_QUOTE'; items: Array<{ productId: string; wholesalePrice: number; patientPrice: number; inStock: boolean }> }
  | { type: 'SYNC_CRM_PATIENTS'; organisationId: string; patients: CRMPatient[] }
  | { type: 'SYNC_PORTAL_ORDERS'; organisationId: string; orders: PatientOrder[] }
  | { type: 'LOG_INTERACTION'; patientId: string; interactionType: string; detail: string }
  // Referrals
  | { type: 'ADD_SUBMISSION'; submission: EligibilitySubmission }
  | { type: 'UPDATE_SUBMISSION'; subId: EligibilitySubmission['id']; updates: Partial<EligibilitySubmission> }
  | { type: 'LOG_CALL'; subId: EligibilitySubmission['id'] }
  | { type: 'APPROVE_ONBOARDING'; subId: EligibilitySubmission['id']; note?: string }
  | { type: 'DECLINE_ONBOARDING'; subId: EligibilitySubmission['id']; note?: string }
  // Orders
  | { type: 'NEW_ORDER'; patientId?: string }
  | { type: 'START_REDO_ORDER'; sourceOrderId: number }
  | { type: 'APPLY_REDO_FROM_ORDER'; orderId: number; sourceOrderId: number }
  | { type: 'CLEAR_ORDER_REDO_CONTEXT'; orderId: number }
  | { type: 'SET_ACTIVE_ORDER'; orderId: number }
  | { type: 'SET_ORDER_PATIENT'; orderId: number; patientId: string }
  | { type: 'SET_ORDER_DISPENSING_FEE'; orderId: number; amount: number }
  | { type: 'ADD_RX'; orderId: number }
  | { type: 'SET_RX_ENTRY_MODE'; orderId: number; rxId: number; mode: 'clinic' | 'manual' }
  | { type: 'SET_RX_PRESCRIBER'; orderId: number; rxId: number; prescriber: string }
  | { type: 'SET_RX_PATIENT_IDENTITY'; orderId: number; rxId: number; name: string; dob: string }
  | { type: 'SET_RX_METADATA'; orderId: number; rxId: number; updates: Partial<Pick<Prescription, 'prescriberPin' | 'prescriberGmcNumber' | 'prescriberGphcNumber' | 'serialNumber' | 'issueDate'>> }
  | { type: 'SET_RX_COPY'; orderId: number; rxId: number; fileName: string }
  | { type: 'SET_RX_FILE'; orderId: number; rxId: number; fileName: string; fileId: string | null }
  | {
      type: 'APPLY_CURALEAF_SCAN';
      orderId: number;
      rxId: number;
      scan: {
        scanId: string;
        prescriptionId: string;
        state: 'ACTIVE' | 'FULFILLED' | 'EXPIRED' | 'CANCELLED' | 'PENDING';
        serialNumber: string;
        issueDate: string;
        expiryDate: string;
        prescriberId: string;
        prescriberName: string;
        prescriberGmcNumber: string;
        prescriberGphcNumber: string;
        patientName?: string;
        patientDob?: string;
        items: LineItem[];
      };
    }
  | { type: 'SET_ORDER_BACKEND_ID'; orderId: number; backendId: string }
  | { type: 'SYNC_ORDER_PATIENT_PRICES'; orderId: number; items: Array<{ productId: string; patientPrice: number }> }
  | { type: 'CONFIRM_CURALEAF_SUBMISSION'; orderId: number; rxId: number; customerReference: string }
  | { type: 'ADD_ITEM_TO_RX'; orderId: number; rxId: number; item: LineItem }
  | { type: 'REMOVE_ITEM_FROM_RX'; orderId: number; rxId: number; productId: string }
  | { type: 'UPDATE_ITEM_QTY'; orderId: number; rxId: number; productId: string; qty: number }
  | { type: 'UPDATE_ITEM_UNITS'; orderId: number; rxId: number; productId: string; unitsNeededCount: number }
  | { type: 'REMOVE_RX'; orderId: number; rxId: number }
  | { type: 'CLEAR_ORDER'; orderId: number }
  // Payment
  | { type: 'SEND_PAYMENT_LINK'; orderId: number }
  | { type: 'START_MANUAL_PAYMENT'; orderId: number }
  | { type: 'CARRY_OVER_PAYMENT'; orderId: number; sourceOrderId: number }
  | { type: 'SET_REDO_PRICE_RESOLUTION'; orderId: number; resolution: 'absorb' | 'refund_and_recharge' | undefined }
  | { type: 'START_ORDER_REFUND'; orderId: number; reason: OrderRefundState['reason']; resolution: OrderRefundState['resolution'] }
  | { type: 'CONFIRM_ORDER_REFUND'; orderId: number; externalReference: string }
  | { type: 'SET_ORDER_REFUND'; orderId: number; refund: OrderRefundState }
  | { type: 'REQUEST_ORDER_CANCELLATION'; orderId: number; reason: OrderCancellationState['reason']; note?: string }
  | { type: 'RECORD_CURALEAF_CANCELLATION_CONTACT'; orderId: number; reference: string; note?: string }
  | { type: 'CONFIRM_CURALEAF_CANCELLATION'; orderId: number; reference: string }
  | { type: 'SET_ORDER_CANCELLATION'; orderId: number; cancellation: OrderCancellationState; curaleafCancellation?: CuraleafCancellationState; lifecycleStatus?: string; paymentStatus?: PaymentStatus }
  | { type: 'CONFIRM_PAYMENT'; orderId: number }
  | { type: 'RECORD_MANUAL_PAYMENT'; orderId: number; tender: ManualTender; reference?: string; notes?: string }
  // Submission to Curaleaf.
  | { type: 'PLACE_ORDER'; orderId: number }
  | { type: 'RECORD_GOODS_RECEIPT'; orderId: number; rxId: number; lines: GoodsReceiptLine[]; note?: string }
  | { type: 'MARK_READY_FOR_COLLECTION'; orderId: number; rxId: number }
  | { type: 'HANDOVER_TO_PATIENT'; orderId: number; rxId: number }
  // Toasts
  | { type: 'ADD_TOAST'; message: string; toastType?: 'success' | 'info' | 'warning' | 'error' }
  | { type: 'REMOVE_TOAST'; id: string }
  ;

/* ═══════════════════════════════════════════════════════════
   Initial State
   ═══════════════════════════════════════════════════════════ */

function blankRx(id: number): Prescription {
  return {
    id, entryMode: 'clinic', prescriber: '', copyFileName: null, items: [], placed: false,
    poRef: null, status: 'draft', invoiceRef: null, trackingNumber: null, carrier: null,
  };
}

function blankOrder(id: number, patientId: string | null, organisationId: string): PatientOrder {
  return {
    id, organisationId, patientId, date: new Date(), dispensingFee: 0,
    payment: { status: 'none', route: null, amount: 0, ref: null, sentAt: null, paidAt: null, manualTender: null, manualReference: null, manualNotes: null, manualRecordedBy: null },
    prescriptions: [blankRx(1)],
  };
}

function mapPortalOrder(record: PortalOrderRecord, index: number, records: PortalOrderRecord[]): PatientOrder {
  const orderId = index + 1;
  const rxStatus: RxStatus = portalPrescriptionStatus(record);
  const persistedQuote = record.pricingQuote ?? record.curaleaf?.quote;
  const quoteItems = new Map(persistedQuote?.items.map(item => [item.packId, item]) ?? []);
  const orderItems = (items: Array<{ packId: string; formulaId: string; quantity: number; unitsNeededCount?: number }>): LineItem[] => items.map(item => {
    const persisted = record.lineItems.find(line => line.packId === item.packId);
    const quote = quoteItems.get(item.packId);
    return {
      productId: item.packId,
      formulaId: item.formulaId || persisted?.formulaId,
      name: persisted?.name ?? 'Curaleaf formulary product',
      qty: item.quantity,
      unitsNeededCount: item.unitsNeededCount,
      cost: quote ? Number(quote.wholesalePackPrice) : null,
      retail: persisted ? persisted.unitPricePence / 100 : Number(quote?.patientPackPrice ?? 0),
    };
  });
  const prescriptions: Prescription[] = record.prescriptions?.length
    ? record.prescriptions.map((prescription, rxIndex) => ({
        id: orderId * 100 + rxIndex + 1,
        entryMode: prescription.clinicScanId ? 'clinic' : 'manual',
        clinicScanId: prescription.clinicScanId,
        curaleafPrescriptionId: prescription.curaleafPrescriptionId,
        curaleafPrescriptionState: record.curaleaf?.prescriptionState,
        prescriber: record.curaleaf?.prescriberName ?? prescription.prescriber.name,
        prescriberId: prescription.prescriber.id,
        prescriberPin: prescription.prescriber.pin,
        prescriberGmcNumber: prescription.prescriber.gmcNumber?.toString(),
        prescriberGphcNumber: prescription.prescriber.gphcNumber ?? undefined,
        serialNumber: prescription.serialNumber,
        issueDate: prescription.issueDate,
        expiryDate: prescription.expiryDate,
        copyFileName: null,
        fileId: prescription.fileId,
        items: orderItems(prescription.items),
        placed: record.curaleaf?.status === 'purchase_order_submitted',
        poRef: record.curaleaf?.customerReference ?? null,
        status: rxStatus,
        invoiceRef: null,
        trackingNumber: null,
        carrier: record.curaleaf?.courier ?? null,
        shipmentId: record.curaleaf?.shipmentIds?.[rxIndex] ?? record.curaleaf?.shipmentIds?.[0],
      }))
    : [{
        id: orderId * 100 + 1,
        entryMode: 'clinic',
        prescriber: 'Curaleaf prescription',
        copyFileName: null,
        items: orderItems(record.lineItems.map(item => ({ packId: item.packId, formulaId: item.formulaId, quantity: item.quantity }))),
        placed: record.curaleaf?.status === 'purchase_order_submitted',
        poRef: record.curaleaf?.customerReference ?? null,
        status: rxStatus,
        invoiceRef: null,
        trackingNumber: null,
        carrier: record.curaleaf?.courier ?? null,
        shipmentId: record.curaleaf?.shipmentIds?.[0],
      }];
  const paid = ['paid', 'refund_required', 'refunded'].includes(record.paymentStatus);
  const cancelled = record.paymentStatus === 'cancelled';
  const redoSourceBackendId = record.redoContext ? String(record.redoOfOrderId ?? record.redoContext.originalOrderId) : null;
  let redoSource = redoSourceBackendId ? records.find(candidate => candidate.id === redoSourceBackendId) : undefined;
  let redoSequence = 0;
  const seenRedoIds = new Set<string>();
  while (redoSource && !seenRedoIds.has(redoSource.id)) {
    seenRedoIds.add(redoSource.id);
    redoSequence += 1;
    const nextSourceId = redoSource.redoContext ? String(redoSource.redoOfOrderId ?? redoSource.redoContext.originalOrderId) : null;
    if (!nextSourceId) break;
    redoSource = records.find(candidate => candidate.id === nextSourceId);
  }
  const rootBackendId = record.redoContext?.rootOrderId ? String(record.redoContext.rootOrderId) : redoSource?.id ?? redoSourceBackendId ?? undefined;
  const rootIndex = rootBackendId ? records.findIndex(candidate => candidate.id === rootBackendId) : -1;
  const sourceIndex = redoSourceBackendId ? records.findIndex(candidate => candidate.id === redoSourceBackendId) : -1;
  return {
    id: orderId,
    backendId: record.id,
    organisationId: record.organisationId,
    patientId: record.patientId,
    date: new Date(record.createdAt),
    dispensingFee: record.dispensingFeePence / 100,
    payment: {
      status: paid ? 'paid' : cancelled ? 'cancelled' : 'sent',
      route: record.paymentRoute === 'manual' ? 'pharmacy' : 'worldpay',
      amount: record.totalPence / 100,
      ref: record.worldpayPaymentId ?? record.paymentTransactionReference ?? record.paymentId ?? null,
      sentAt: new Date(record.createdAt),
      paidAt: paid ? new Date(record.updatedAt) : null,
      manualTender: null,
      manualReference: null,
      manualNotes: null,
      manualRecordedBy: null,
    },
    prescriptions,
    curaleafApprovedAt: record.curaleafApprovedAt ?? null,
    refund: record.refund,
    cancellation: record.cancellation,
    curaleafCancellation: record.curaleafCancellation,
    pharmacyContribution: record.pharmacyContributionPence ? record.pharmacyContributionPence / 100 : 0,
    quoteReview: record.quoteReview,
    lifecycleStatus: record.status,
    isExpired: Boolean(record.isExpired || record.unresolvedReason === 'expired'),
    unresolvedReason: record.unresolvedReason ?? null,
    redoEligible: record.redoEligible,
    redoneByOrderId: record.redoneByOrderId ?? null,
    cycleExpiresAt: record.cycleExpiresAt,
    expiryCheck: record.expiryCheck,
    redoContext: record.redoContext ? {
      originalOrderId: sourceIndex >= 0 ? sourceIndex + 1 : 0,
      originalBackendId: String(record.redoOfOrderId ?? record.redoContext.originalOrderId),
      rootOrderId: rootIndex >= 0 ? rootIndex + 1 : sourceIndex >= 0 ? sourceIndex + 1 : orderId,
      rootBackendId,
      replacementSequence: record.redoContext.replacementSequence ?? Math.max(1, redoSequence),
      priceResolution: record.redoContext.priceResolution,
      isPaidRedo: Boolean(record.redoContext.isPaidRedo),
      reason: record.redoContext.unresolvedReason ?? 'expired',
    } : undefined,
  };
}

function buildSeedSubmissions(): EligibilitySubmission[] {
  const base = { tried2: true, psychExclusion: false, consentReferral: true, consentShare: true, organisationId: '11111111-1111-4111-8111-111111111111', pharmacyName: 'Holistic Health Hub Pharmacy — Leeds', referralToken: 'hhh-leeds-7x4p9k' };
  const s1: EligibilitySubmission = {
    id: 1, name: 'Tom Hughes', dob: '1989-04-12', mobile: '07700 900501', email: 't.hughes@email.com',
    postcode: 'LS1 6PJ', conditions: ['chronic-pain', 'neuropathic-pain', 'arthritis'], primaryCondition: 'chronic-pain', ...base, marketing: false, source: 'Google',
    status: 'New', calls: [], reviewedAt: null, reviewedBy: null, decisionNote: null, submittedAt: new Date(),
  };
  const s2: EligibilitySubmission = {
    id: 2, name: 'Rebecca Allen', dob: '1994-11-02', mobile: '07700 900502', email: 'r.allen@email.com',
    postcode: 'LS2 8PQ', conditions: ['anxiety'], primaryCondition: 'anxiety', ...base, marketing: true, source: 'Website',
    status: 'Under HHH review', calls: [{ ts: new Date(Date.now() - 24 * 60 * 60 * 1000) }], reviewedAt: null, reviewedBy: null, decisionNote: null, submittedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), // 3 days ago
  };
  const s3: EligibilitySubmission = {
    id: 3, name: 'Daniel Price', dob: '1977-07-23', mobile: '07700 900503', email: 'd.price@email.com',
    postcode: 'LS2 7DR', conditions: ['chronic-pain', 'low-back-pain-and-sciatica'], primaryCondition: 'chronic-pain', ...base, marketing: false, source: 'Poster',
    status: 'Approved', calls: [{ ts: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) }], reviewedAt: new Date(Date.now() - 24 * 60 * 60 * 1000), reviewedBy: 'Shaylen Patel', decisionNote: 'Approved for programme onboarding after telephone review.', submittedAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000),
  };
  const s4: EligibilitySubmission = {
    id: 4, name: 'Sara Knight', dob: '1985-02-15', mobile: '07700 900504', email: 's.knight@email.com',
    postcode: 'LS1 5DA', conditions: ['insomnia'], primaryCondition: 'insomnia', ...base, marketing: false, source: 'Text',
    status: 'Declined', calls: [{ ts: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) }], reviewedAt: new Date(Date.now() - 24 * 60 * 60 * 1000), reviewedBy: 'Shaylen Patel', decisionNote: 'Not onboarded following HHH review.', submittedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
  };
  s3.organisationId = '22222222-2222-4222-8222-222222222222';
  s3.pharmacyName = 'East Midlands Pharmacy Lincoln';
  s3.referralToken = 'emp-lincoln-3m8q2v';
  return [s1, s2, s3, s4];
}

function buildSeedOrders(): { orders: PatientOrder[]; nextRx: number } {
  const rx1: Prescription = {
    id: 1, entryMode: 'clinic', prescriber: 'Dr. A. Lee', copyFileName: 'prescription_jdoe_1.pdf',
    items: [],
    placed: false, poRef: null, status: 'draft', invoiceRef: null, trackingNumber: null, carrier: null,
  };
  const rx2: Prescription = {
    id: 2, entryMode: 'clinic', prescriber: 'Dr. A. Lee', copyFileName: 'prescription_jdoe_2.pdf',
    items: [],
    placed: false, poRef: null, status: 'draft', invoiceRef: null, trackingNumber: null, carrier: null,
  };
  const o1: PatientOrder = {
    id: 1, organisationId: ORGANISATIONS[0].id, patientId: 'P-1001', date: new Date(), dispensingFee: 0,
    payment: { status: 'none', route: null, amount: 0, ref: null, sentAt: null, paidAt: null, manualTender: null, manualReference: null, manualNotes: null, manualRecordedBy: null },
    prescriptions: [rx1, rx2],
  };

  const rx3: Prescription = {
    id: 3, entryMode: 'clinic', prescriber: 'Dr. R. Okafor', copyFileName: 'prescription_asmith.pdf',
    items: [],
    placed: true, poRef: 'PO-9002', status: 'ready', invoiceRef: 'INV-4071', trackingNumber: null, carrier: null,
    receivedItems: [], goodsInAt: new Date(Date.now() - 12 * 24 * 60 * 60 * 1000), goodsInBy: 'S. Patel',
    readyAt: new Date(Date.now() - 12 * 24 * 60 * 60 * 1000), // 12 days ago
  };
  const o2: PatientOrder = {
    id: 2, organisationId: ORGANISATIONS[0].id, patientId: 'P-1002', date: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000), dispensingFee: 0,
    payment: { status: 'paid', route: 'worldpay', amount: 48, ref: 'WP-8812', sentAt: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000), paidAt: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000), manualTender: null, manualReference: null, manualNotes: null, manualRecordedBy: null },
    prescriptions: [rx3],
  };

  const rx4: Prescription = {
    id: 4, entryMode: 'clinic', prescriber: 'Dr. S. Patel', copyFileName: 'prescription_jdoe_overdue.pdf',
    items: [
      { productId: 'seed-pack-khan-oil', formulaId: 'seed-formula-khan-oil', name: 'Curaleaf 20:10 Oil 30ml', qty: 1, unitsNeededCount: 1, cost: 42, retail: 79 },
    ],
    placed: true, poRef: 'PO-9003', status: 'approved', invoiceRef: 'INV-4073', trackingNumber: null, carrier: null,
  };
  const o3: PatientOrder = {
    id: 3, organisationId: ORGANISATIONS[0].id, patientId: 'P-1003', date: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000), dispensingFee: 0,
    payment: {
      status: 'paid',
      route: 'worldpay',
      amount: 79,
      ref: 'WP-8815',
      sentAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), // 5 days ago
      paidAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), manualTender: null, manualReference: null, manualNotes: null, manualRecordedBy: null,
    },
    prescriptions: [rx4],
    quoteReview: {
      status: 'recreate_required',
      type: 'patient_price_changed',
      fingerprint: 'seed-price-shift',
      latestQuote: { shippingPrice: '0', taxRate: '0', items: [] },
      differences: [{ category: 'patient_price', field: 'patientPackPrice', previous: '79', latest: '92' }],
      checkedAt: new Date().toISOString(),
    },
  };

  const rx5: Prescription = {
    id: 5, entryMode: 'clinic', prescriber: 'Dr. R. Okafor', copyFileName: 'prescription_sbennett.pdf',
    items: [
      { productId: 'seed-pack-flower', formulaId: 'seed-formula-flower', name: 'Curaleaf Access TT1 Flower 10g', qty: 2, unitsNeededCount: 2, cost: 28, retail: 55 },
      { productId: 'seed-pack-oil', formulaId: 'seed-formula-oil', name: 'Curaleaf 10:10 Oil 30ml', qty: 1, unitsNeededCount: 1, cost: 36, retail: 69 },
    ],
    placed: true, poRef: 'PO-9004', status: 'collected', invoiceRef: 'INV-4074', trackingNumber: null, carrier: null,
  };
  const o4: PatientOrder = {
    id: 4, organisationId: ORGANISATIONS[0].id, patientId: 'P-1004', date: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000), dispensingFee: 0, // 45 days ago
    payment: {
      status: 'paid',
      route: 'pharmacy',
      amount: 69,
      ref: null,
      sentAt: new Date(Date.now() - 44 * 24 * 60 * 60 * 1000),
      paidAt: new Date(Date.now() - 44 * 24 * 60 * 60 * 1000), manualTender: 'cash', manualReference: 'TILL-1048', manualNotes: 'Paid at pharmacy counter.', manualRecordedBy: 'S. Patel',
    },
    prescriptions: [rx5],
  };

  const rx6: Prescription = {
    id: 6, entryMode: 'clinic', prescriber: 'Dr. A. Lee', copyFileName: 'prescription_jdoe_cycle.pdf',
    items: [
      { productId: 'seed-pack-doe-flower', formulaId: 'seed-formula-doe-flower', name: 'Curaleaf Access T20 Flower 10g', qty: 1, unitsNeededCount: 1, cost: 30, retail: 58 },
      { productId: 'seed-pack-doe-oil', formulaId: 'seed-formula-doe-oil', name: 'Curaleaf 20:10 Oil 30ml', qty: 1, unitsNeededCount: 1, cost: 42, retail: 79 },
    ],
    placed: true, poRef: 'PO-9005', status: 'collected', invoiceRef: 'INV-4075', trackingNumber: null, carrier: null,
  };
  const o5: PatientOrder = {
    id: 5, organisationId: ORGANISATIONS[0].id, patientId: 'P-1001', date: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000), dispensingFee: 0,
    payment: {
      status: 'paid',
      route: 'worldpay',
      amount: 137,
      ref: 'WP-8891',
      sentAt: new Date(Date.now() - 34 * 24 * 60 * 60 * 1000),
      paidAt: new Date(Date.now() - 34 * 24 * 60 * 60 * 1000),
      manualTender: null, manualReference: null, manualNotes: null, manualRecordedBy: null,
    },
    prescriptions: [rx6],
  };

  const rx7: Prescription = {
    id: 7, entryMode: 'clinic', prescriber: 'Dr. A. Lee', copyFileName: 'prescription_jdoe_approved.pdf',
    items: [
      { productId: 'seed-pack-approved-oil', formulaId: 'seed-formula-approved-oil', name: 'Curaleaf 20:10 Oil 30ml', qty: 1, unitsNeededCount: 1, cost: 42, retail: 79 },
    ],
    placed: true, poRef: 'PO-9006', status: 'approved', invoiceRef: null, trackingNumber: null, carrier: 'Curaleaf',
  };
  const o6: PatientOrder = {
    id: 6, organisationId: ORGANISATIONS[0].id, patientId: 'P-1001', date: new Date('2026-08-06T13:45:00Z'), dispensingFee: 0,
    payment: {
      status: 'paid', route: 'worldpay', amount: 79, ref: 'WP-9006',
      sentAt: new Date('2026-08-06T13:20:00Z'), paidAt: new Date('2026-08-06T13:30:00Z'),
      manualTender: null, manualReference: null, manualNotes: null, manualRecordedBy: null,
    },
    prescriptions: [rx7],
    curaleafApprovedAt: new Date('2026-08-06T14:00:00Z'),
  };

  return { orders: [o1, o2, o3, o4, o5, o6], nextRx: 8 };
}

const seed = buildSeedOrders();

function buildComplianceItems(): ComplianceItem[] {
  const platform: ComplianceItem[] = [
    { id: 'CON-00', organisationId: null, category: 'Contracts', requirement: 'Verify the legal entity behind the Healius Consulting business name and HHH platform, including legal name, company status/number, registered office and authority to contract', reference: 'Contracting-party and statutory disclosure gate', owner: 'Shaylen Patel + solicitor', status: 'blocked', requiredForLive: true, evidence: 'Business name and domain seen in correspondence; registered legal identity not yet supplied', reviewDate: '2026-07-28' },
    { id: 'CON-00A', organisationId: null, category: 'Contracts', requirement: 'Record ownership or licence of the HHH name, domains, software, content and patient-facing materials', reference: 'Brand and intellectual-property chain of title', owner: 'Director + solicitor', status: 'not-started', requiredForLive: true, evidence: null, reviewDate: null },
    { id: 'ICO-01', organisationId: null, category: 'Data protection', requirement: 'Confirm Healius Consulting / HHH controller and processor roles and register the verified legal entity with the ICO where required', reference: 'UK GDPR · ICO data protection fee', owner: 'Director + legal adviser', status: 'in-progress', requiredForLive: true, evidence: null, reviewDate: '2026-08-14' },
    { id: 'ICO-02', organisationId: null, category: 'Data protection', requirement: 'Approve DPIA for special-category patient data and tenant model', reference: 'UK GDPR Art. 35', owner: 'DPO adviser + Healius Consulting', status: 'not-started', requiredForLive: true, evidence: null, reviewDate: '2026-08-14' },
    { id: 'ICO-03', organisationId: null, category: 'Data protection', requirement: 'Document Article 6 lawful bases, Article 9 conditions and ROPA', reference: 'UK GDPR Arts. 6, 9 and 30', owner: 'Legal adviser', status: 'not-started', requiredForLive: true, evidence: null, reviewDate: null },
    { id: 'ICO-04', organisationId: null, category: 'Data protection', requirement: 'Publish patient, pharmacy staff and eligibility privacy notices naming the verified Healius legal entity and each party’s role', reference: 'UK GDPR Arts. 13–14', owner: 'Healius Consulting + legal adviser', status: 'not-started', requiredForLive: true, evidence: null, reviewDate: null },
    { id: 'ICO-05', organisationId: null, category: 'Data protection', requirement: 'Approve retention, deletion, DSAR and breach-response procedures', reference: 'UK GDPR accountability', owner: 'Healius Consulting operations', status: 'not-started', requiredForLive: true, evidence: null, reviewDate: null },
    { id: 'ICO-06', organisationId: null, category: 'Data protection', requirement: 'Approve consent records, Appropriate Policy Document and withdrawal process where applicable', reference: 'DPA 2018 · UK GDPR Art. 9', owner: 'DPO adviser + legal adviser', status: 'not-started', requiredForLive: true, evidence: null, reviewDate: null },
    { id: 'ICO-07', organisationId: null, category: 'Data protection', requirement: 'Document cookie use and separate care communications from optional marketing', reference: 'PECR + UK GDPR', owner: 'Healius Consulting operations + legal adviser', status: 'not-started', requiredForLive: true, evidence: null, reviewDate: null },
    { id: 'CON-01', organisationId: null, category: 'Contracts', requirement: 'Approve pharmacy services agreement, DPA and sub-processor schedule in the verified Healius legal entity name (trading as HHH)', reference: 'UK GDPR Art. 28', owner: 'Director + solicitor', status: 'not-started', requiredForLive: true, evidence: null, reviewDate: null },
    { id: 'CON-02', organisationId: null, category: 'Contracts', requirement: 'Confirm professional indemnity, cyber insurance and supplier liability cover is held by the verified operator and covers the HHH service', reference: 'Commercial assurance', owner: 'Director + insurance adviser', status: 'not-started', requiredForLive: true, evidence: null, reviewDate: null },
    { id: 'SEC-01', organisationId: null, category: 'Security', requirement: 'MFA, role-based access and tenant isolation verified', reference: 'Security go-live control', owner: 'Technical lead', status: 'in-progress', requiredForLive: true, evidence: 'Prototype roles implemented; production identity pending', reviewDate: '2026-08-14' },
    { id: 'SEC-02', organisationId: null, category: 'Security', requirement: 'Encryption, backups, recovery test, audit logs and incident runbook verified', reference: 'UK GDPR Art. 32', owner: 'Technical lead', status: 'not-started', requiredForLive: true, evidence: null, reviewDate: null },
    { id: 'SEC-03', organisationId: null, category: 'Security', requirement: 'Independent penetration test and vulnerability remediation', reference: 'Security assurance', owner: 'Technical lead', status: 'not-started', requiredForLive: true, evidence: null, reviewDate: null },
    { id: 'SEC-04', organisationId: null, category: 'Security', requirement: 'Supplier due diligence, UK/EU data locations and international transfer safeguards recorded', reference: 'UK GDPR processor assurance', owner: 'DPO adviser + technical lead', status: 'not-started', requiredForLive: true, evidence: null, reviewDate: null },
    { id: 'SEC-05', organisationId: null, category: 'Security', requirement: 'Business continuity, disaster recovery and restore test completed', reference: 'Operational resilience', owner: 'Technical lead + director', status: 'not-started', requiredForLive: true, evidence: null, reviewDate: null },
    { id: 'PAY-01', organisationId: null, category: 'Payments', requirement: 'Worldpay confirms each pharmacy can connect an approved merchant account and receive patient funds directly', reference: 'Worldpay platform and merchant approval', owner: 'Director + Worldpay', status: 'blocked', requiredForLive: true, evidence: 'Awaiting Worldpay confirmation of the tenant connection model', reviewDate: '2026-07-28' },
    { id: 'PAY-02', organisationId: null, category: 'Payments', requirement: 'Hosted checkout, signed webhooks and PCI DSS scope approved', reference: 'PCI DSS', owner: 'Worldpay + technical lead', status: 'not-started', requiredForLive: true, evidence: null, reviewDate: null },
    { id: 'PAY-03', organisationId: null, category: 'Payments', requirement: 'Refunds, chargebacks, reconciliation, descriptor and settlement responsibilities documented', reference: 'Worldpay operating model', owner: 'Director + Worldpay', status: 'not-started', requiredForLive: true, evidence: null, reviewDate: null },
    { id: 'CLN-01', organisationId: null, category: 'Clinical scope', requirement: 'Document whether CQC, NHS DSPT, DCB0129 or MHRA scope is triggered', reference: 'Scope assessment — professional advice required', owner: 'Director + regulatory adviser', status: 'in-progress', requiredForLive: true, evidence: 'Initial scope: software and administration only', reviewDate: '2026-08-14' },
    { id: 'CLN-02', organisationId: null, category: 'Clinical scope', requirement: 'Patient-facing accessibility and reasonable-adjustment review completed', reference: 'Equality Act 2010 · target WCAG 2.2 AA', owner: 'Technical lead + operations', status: 'in-progress', requiredForLive: true, evidence: 'Responsive layout tested; formal audit pending', reviewDate: null },
    { id: 'CLN-03', organisationId: null, category: 'Clinical scope', requirement: 'HHH programme-onboarding approval is defined as an administrative gate, with telephone review, decision reason and approver audit; it does not replace diagnosis, prescribing or pharmacy checks', reference: 'Operating scope and clinical safety boundary', owner: 'Shaylen + solicitor/regulatory adviser', status: 'in-progress', requiredForLive: true, evidence: 'Prototype enforces HHH approval before the patient enters the pharmacy ordering CRM', reviewDate: '2026-08-14' },
  ];

  const tenantItems = ORGANISATIONS.flatMap((organisation, index): ComplianceItem[] => [
    { id: `${organisation.slug}-GPHC`, organisationId: organisation.id, category: 'Pharmacy governance', requirement: 'GPhC registration, premises and superintendent details verified', reference: 'GPhC standards', owner: 'Pharmacy + Healius Consulting onboarding', status: index === 0 ? 'ready' : 'in-progress', requiredForLive: true, evidence: index === 0 ? `GPhC ${organisation.gphcNumber}` : null, reviewDate: '2027-07-01' },
    { id: `${organisation.slug}-DPA`, organisationId: organisation.id, category: 'Contracts', requirement: 'Pharmacy agreement and data processing terms signed', reference: 'Tenant go-live gate', owner: 'Director + pharmacy', status: index === 0 ? 'in-progress' : 'not-started', requiredForLive: true, evidence: null, reviewDate: null },
    { id: `${organisation.slug}-RISK`, organisationId: organisation.id, category: 'Pharmacy governance', requirement: 'CBPM and distance-service risk assessments held on file', reference: 'GPhC pharmacy responsibility', owner: 'Superintendent pharmacist', status: 'not-started', requiredForLive: true, evidence: null, reviewDate: null },
    { id: `${organisation.slug}-TRAIN`, organisationId: organisation.id, category: 'Pharmacy governance', requirement: 'Staff training, confidentiality and UAT sign-off completed', reference: 'Tenant go-live gate', owner: 'Pharmacy manager', status: index === 0 ? 'in-progress' : 'not-started', requiredForLive: true, evidence: null, reviewDate: null },
    { id: `${organisation.slug}-WP`, organisationId: organisation.id, category: 'Payments', requirement: 'Pharmacy Worldpay merchant and direct settlement destination approved', reference: 'Worldpay tenant connection', owner: 'Pharmacy + Worldpay', status: organisation.worldpay.status === 'connected' ? 'ready' : 'not-started', requiredForLive: true, evidence: organisation.worldpay.merchantId, reviewDate: null },
    { id: `${organisation.slug}-FORM`, organisationId: organisation.id, category: 'Data protection', requirement: 'Eligibility link, operator/controller identity, privacy wording, consent capture and attribution UAT approved', reference: 'Patient intake go-live gate', owner: 'Healius Consulting + pharmacy', status: index === 0 ? 'in-progress' : 'not-started', requiredForLive: true, evidence: index === 0 ? 'Sandbox attribution verified; legal identity/privacy approval outstanding' : null, reviewDate: null },
    { id: `${organisation.slug}-PI`, organisationId: organisation.id, category: 'Pharmacy governance', requirement: 'Professional indemnity and responsible pharmacist arrangements confirmed', reference: 'GPhC pharmacy responsibility', owner: 'Pharmacy superintendent', status: 'not-started', requiredForLive: true, evidence: null, reviewDate: null },
    { id: `${organisation.slug}-CD`, organisationId: organisation.id, category: 'Pharmacy governance', requirement: 'Controlled-drug storage, register, incident and destruction SOPs confirmed', reference: 'Pharmacy-owned controlled drug obligations', owner: 'Responsible pharmacist', status: 'not-started', requiredForLive: true, evidence: null, reviewDate: null },
    { id: `${organisation.slug}-RX`, organisationId: organisation.id, category: 'Clinical scope', requirement: 'Prescription validity, prescriber verification and dispensing SOP approved', reference: 'HMR / CBPM workflow', owner: 'Superintendent pharmacist', status: 'not-started', requiredForLive: true, evidence: null, reviewDate: null },
    { id: `${organisation.slug}-COMPLAINTS`, organisationId: organisation.id, category: 'Pharmacy governance', requirement: 'Patient complaints, safeguarding and clinical escalation routes published', reference: 'Pharmacy governance', owner: 'Pharmacy manager', status: 'not-started', requiredForLive: true, evidence: null, reviewDate: null },
    { id: `${organisation.slug}-ACCESS`, organisationId: organisation.id, category: 'Security', requirement: 'Staff roles, MFA enrolment and access review signed off', reference: 'Tenant access control', owner: 'Pharmacy manager + Healius Consulting', status: 'not-started', requiredForLive: true, evidence: null, reviewDate: null },
  ]);

  return [...platform, ...tenantItems];
}

const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
const usePrototypeState = import.meta.env.DEV && (!import.meta.env.VITE_FIREBASE_API_KEY || isLocalPortalPreview);
let storedStaffSession: StaffSession | null = null;
try {
  storedStaffSession = usePrototypeState
    ? JSON.parse(sessionStorage.getItem('hhh_staff_session') || 'null') as StaffSession | null
    : null;
} catch { storedStaffSession = null; }
const initialPortalMode: PortalMode = localPortalPreview === 'admin' ? 'admin' : localPortalPreview === 'pharmacy' ? 'clinician' : storedStaffSession?.role === 'admin' ? 'admin' : storedStaffSession?.role === 'pharmacy' ? 'clinician' : 'gateway';
const initialToken = urlParams?.get('token');
const initialOrganisation = ORGANISATIONS.find(org => org.referralToken === initialToken || org.id === storedStaffSession?.organisationId) ?? ORGANISATIONS[0];

const initialState: AppState = {
  screen: 'home',
  screenHistory: [],
  navigationTarget: null,
  catalogue: [],
  catalogueSource: 'unavailable',
  catalogueLoading: isApiConfigured,
  catalogueError: null,
  catalogueUpdatedAt: null,
  crm: usePrototypeState ? [...SEED_CRM] : [],
  submissions: usePrototypeState ? buildSeedSubmissions() : [],
  orders: usePrototypeState ? seed.orders : [],
  activeOrderId: usePrototypeState ? 1 : null,
  toasts: [],
  nextIds: { patient: 2000, rx: seed.nextRx, order: 7, submission: 5, invoice: 4072 },
  portalMode: initialPortalMode,
  workspaceMode: 'training',
  organisations: usePrototypeState ? ORGANISATIONS : [],
  currentOrganisationId: usePrototypeState ? initialOrganisation.id : '',
  staffSession: storedStaffSession,
  platformIntegrations: [
    { id: 'eligibility-api', name: 'HHH Eligibility API', description: 'Token routing and patient intake', status: 'connected' },
    { id: 'curaleaf', name: 'Curaleaf', description: 'Product, prescription and supplier ordering', status: 'pending' },
    { id: 'worldpay', name: 'Worldpay', description: 'Pharmacy-owned hosted checkout, payment webhooks and direct settlement', status: 'pending' },
    { id: 'notifications', name: 'Patient notifications', description: 'Ready-for-collection SMS and email', status: 'pending' },
  ],
  complianceItems: usePrototypeState ? buildComplianceItems() : [],
};

/* ═══════════════════════════════════════════════════════════
   Reducer
   ═══════════════════════════════════════════════════════════ */

function findOrder(state: AppState, orderId: number) {
  return state.orders.find(o => o.id === orderId);
}

function applyRedoOntoDraft(draft: PatientOrder, source: PatientOrder, reason: UnresolvedOrderReason): PatientOrder {
  const items = source.prescriptions.flatMap(rx => rx.items).map(item => ({ ...item }));
  const targetRxId = draft.prescriptions[0]?.id;
  return {
    ...draft,
    patientId: source.patientId ?? draft.patientId,
    redoContext: {
      originalOrderId: source.id,
      originalBackendId: source.backendId,
      rootOrderId: source.redoContext?.rootOrderId ?? source.redoContext?.originalOrderId ?? source.id,
      rootBackendId: source.redoContext?.rootBackendId ?? source.redoContext?.originalBackendId ?? source.backendId,
      replacementSequence: (source.redoContext?.replacementSequence ?? 0) + 1,
      isPaidRedo: source.payment.status === 'paid' && source.refund?.status !== 'completed',
      reason,
    },
    prescriptions: draft.prescriptions.map(rx => {
      if (rx.id !== targetRxId) return rx;
      return {
        ...rx,
        items,
        copyFileName: null,
        fileId: undefined,
        clinicScanId: undefined,
        curaleafPrescriptionId: undefined,
        serialNumber: undefined,
        issueDate: undefined,
        expiryDate: undefined,
        curaleafPatientName: undefined,
        curaleafPatientDob: undefined,
        placed: false,
        poRef: null,
        status: 'draft',
        invoiceRef: null,
        trackingNumber: null,
        carrier: null,
      };
    }),
  };
}

function mapOrder(state: AppState, orderId: number, fn: (o: PatientOrder) => PatientOrder): AppState {
  return { ...state, orders: state.orders.map(o => o.id === orderId ? fn({ ...o }) : o) };
}

function mapRx(order: PatientOrder, rxId: number, fn: (rx: Prescription) => Prescription): PatientOrder {
  return { ...order, prescriptions: order.prescriptions.map(r => r.id === rxId ? fn({ ...r }) : r) };
}

function buildTenantTrainingData(organisationId: string) {
  const trainingSeed = buildSeedOrders();
  return {
    crm: SEED_CRM.map(patient => ({ ...patient, organisationId })),
    submissions: buildSeedSubmissions().map(submission => ({ ...submission, organisationId, pharmacyName: 'Training pharmacy', referralToken: 'training-only' })),
    orders: trainingSeed.orders.map(order => ({ ...order, organisationId })),
    nextRx: trainingSeed.nextRx,
  };
}

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'SET_SCREEN':
      if (action.screen === state.screen) return state;
      return { ...state, screen: action.screen, screenHistory: [...state.screenHistory.slice(-7), state.screen] };
    case 'GO_BACK': {
      const previous = state.screenHistory.at(-1);
      if (!previous) return state;
      return { ...state, screen: previous, screenHistory: state.screenHistory.slice(0, -1), navigationTarget: null };
    }
    case 'SET_NAVIGATION_TARGET':
      return { ...state, navigationTarget: action.target };
    case 'CLEAR_NAVIGATION_TARGET':
      return { ...state, navigationTarget: null };
    case 'SET_CATALOGUE_LOADING':
      return { ...state, catalogueLoading: true, catalogueError: null };
    case 'SET_CATALOGUE':
      return {
        ...state,
        catalogue: action.catalogue,
        catalogueSource: 'curaleaf',
        catalogueLoading: false,
        catalogueError: null,
        catalogueUpdatedAt: action.updatedAt,
        platformIntegrations: state.platformIntegrations.map(integration => integration.id === 'curaleaf'
          ? { ...integration, status: 'connected', description: `${action.catalogue.length} Curaleaf products loaded from the connected environment.` }
          : integration),
      };
    case 'SET_CATALOGUE_ERROR':
      return {
        ...state,
        catalogueLoading: false,
        catalogueError: action.message,
        catalogueSource: state.catalogue.length ? state.catalogueSource : 'unavailable',
        platformIntegrations: state.platformIntegrations.map(integration => integration.id === 'curaleaf'
          ? { ...integration, status: 'attention', description: action.message }
          : integration),
      };
    case 'APPLY_CURALEAF_QUOTE': {
      const quoted = new Map(action.items.map(item => [item.productId, item]));
      return {
        ...state,
        catalogue: state.catalogue.map(product => {
          const item = quoted.get(product.id);
          return item ? { ...product, retail: item.patientPrice, availability: item.inStock ? 'in' : 'out' } : product;
        }),
        orders: state.orders.map(order => order.payment.status !== 'none' ? order : ({
          ...order,
          prescriptions: order.prescriptions.map(rx => ({
            ...rx,
            items: rx.items.map(line => {
              const item = quoted.get(line.productId);
              return item ? { ...line, cost: item.wholesalePrice, retail: item.patientPrice } : line;
            }),
          })),
        })),
      };
    }
    case 'SYNC_CRM_PATIENTS': {
      const retained = state.workspaceMode === 'training'
        ? state.crm
        : state.crm.filter(patient => patient.organisationId !== action.organisationId);
      const byId = new Map(retained.map(patient => [patient.id, patient]));
      action.patients.forEach(patient => byId.set(patient.id, patient));
      return { ...state, crm: [...byId.values()] };
    }
    case 'SYNC_PORTAL_ORDERS': {
      const retained = state.orders.filter(order => order.organisationId !== action.organisationId || order.payment.status === 'none');
      const orders = [...retained, ...action.orders];
      const nextOrderId = Math.max(state.nextIds.order, ...orders.map(order => order.id + 1));
      const nextRxId = Math.max(state.nextIds.rx, ...orders.flatMap(order => order.prescriptions.map(rx => rx.id + 1)));
      return { ...state, orders, nextIds: { ...state.nextIds, order: nextOrderId, rx: nextRxId } };
    }
    case 'LOG_INTERACTION': {
      return {
        ...state,
        crm: state.crm.map(p =>
          p.id === action.patientId
            ? {
                ...p,
                interactions: [
                  ...(p.interactions || []),
                  { ts: new Date(), type: action.interactionType, detail: action.detail }
                ]
              }
            : p
        )
      };
    }
    case 'SET_PORTAL_MODE':
      return { ...state, portalMode: action.mode, screenHistory: [], navigationTarget: null };
    case 'SET_WORKSPACE_MODE': {
      if (action.mode === 'training') {
        const organisationId = action.organisationId ?? state.currentOrganisationId;
        if (state.workspaceMode === 'training' && state.orders.length > 0 && state.orders.every(order => order.organisationId === organisationId)) return state;
        const training = buildTenantTrainingData(organisationId);
        const patients = new Map(training.crm.map(patient => [patient.id, patient]));
        state.crm
          .filter(patient => patient.organisationId === organisationId)
          .forEach(patient => patients.set(patient.id, patient));
        return {
          ...state,
          workspaceMode: 'training',
          screen: 'home',
          screenHistory: [],
          navigationTarget: null,
          catalogue: state.catalogueSource === 'curaleaf' ? state.catalogue : [],
          catalogueSource: state.catalogueSource === 'curaleaf' ? 'curaleaf' : 'unavailable',
          crm: [...patients.values()],
          submissions: training.submissions,
          orders: training.orders,
          activeOrderId: 1,
        nextIds: { patient: 2000, rx: training.nextRx, order: 7, submission: 5, invoice: 4072 },
        };
      }
      if (state.workspaceMode === action.mode) return state;
      return {
        ...state,
        workspaceMode: 'live',
        screen: 'home',
        screenHistory: [],
        navigationTarget: null,
        catalogue: state.catalogueSource === 'curaleaf' ? state.catalogue : [],
        crm: [],
        submissions: [],
        orders: [],
        activeOrderId: null,
      };
    }
    case 'SIGN_IN_STAFF':
      return {
        ...state,
        staffSession: action.session,
        currentOrganisationId: action.session.organisationId ?? state.currentOrganisationId,
        portalMode: action.session.role === 'admin' ? 'admin' : 'clinician',
      };
    case 'SIGN_OUT_STAFF': {
      const trainingSeed = buildSeedOrders();
      return {
        ...state,
        staffSession: null,
        portalMode: 'gateway',
        workspaceMode: 'training',
        screen: 'home',
        screenHistory: [],
        navigationTarget: null,
        catalogue: state.catalogueSource === 'curaleaf' ? state.catalogue : [],
        catalogueSource: state.catalogueSource === 'curaleaf' ? 'curaleaf' : 'unavailable',
        crm: usePrototypeState ? [...SEED_CRM] : [],
        submissions: usePrototypeState ? buildSeedSubmissions() : [],
        orders: usePrototypeState ? trainingSeed.orders : [],
        activeOrderId: usePrototypeState ? 1 : null,
        organisations: usePrototypeState ? ORGANISATIONS : [],
        currentOrganisationId: usePrototypeState ? initialOrganisation.id : '',
        complianceItems: usePrototypeState ? buildComplianceItems() : [],
      };
    }
    case 'SET_CURRENT_ORGANISATION':
      return { ...state, currentOrganisationId: action.organisationId };
    case 'SET_ORGANISATIONS':
      return {
        ...state,
        organisations: action.organisations,
        currentOrganisationId: action.organisations.some(organisation => organisation.id === state.currentOrganisationId)
          ? state.currentOrganisationId
          : action.organisations[0]?.id ?? '',
      };
    case 'UPDATE_PLATFORM_INTEGRATION':
      return { ...state, platformIntegrations: state.platformIntegrations.map(integration => integration.id === action.integrationId ? { ...integration, status: action.status, description: action.description ?? integration.description } : integration) };
    case 'ADD_ORGANISATION':
      if (state.organisations.some(organisation => organisation.id === action.organisation.id)) {
        return { ...state, organisations: state.organisations.map(organisation => organisation.id === action.organisation.id ? action.organisation : organisation) };
      }
      return { ...state, organisations: [...state.organisations, action.organisation] };
    case 'UPDATE_ORGANISATION':
      return { ...state, organisations: state.organisations.map(org => org.id === action.organisationId ? { ...org, ...action.updates } : org) };
    case 'UPDATE_WORLDPAY':
      return { ...state, organisations: state.organisations.map(org => org.id === action.organisationId ? { ...org, worldpay: { ...org.worldpay, ...action.updates } } : org) };
    case 'UPDATE_COMPLIANCE':
      return { ...state, complianceItems: state.complianceItems.map(item => item.id === action.itemId ? { ...item, status: action.status, evidence: action.evidence ?? item.evidence } : item) };
    // ---- Referrals ----
    case 'ADD_SUBMISSION': {
      if (state.submissions.some(s =>
        s.id === action.submission.id ||
        (s.organisationId === action.submission.organisationId &&
          s.email.toLowerCase() === action.submission.email.toLowerCase())
      )) {
        return {
          ...state,
          submissions: state.submissions.map(submission =>
            submission.id === action.submission.id ||
            (submission.organisationId === action.submission.organisationId &&
              submission.email.toLowerCase() === action.submission.email.toLowerCase())
              ? { ...submission, ...action.submission }
              : submission
          ),
        };
      }
      return {
        ...state,
        submissions: [action.submission, ...state.submissions],
      };
    }
    case 'UPDATE_SUBMISSION':
      return {
        ...state,
        submissions: state.submissions.map(submission => submission.id === action.subId ? { ...submission, ...action.updates } : submission),
      };
    case 'LOG_CALL': {
      return {
        ...state,
        submissions: state.submissions.map(s =>
          s.id === action.subId && s.status !== 'Approved' && s.status !== 'Declined'
            ? { ...s, calls: [...s.calls, { ts: new Date() }], status: 'Under HHH review' as const }
            : s
        ),
      };
    }
    case 'APPROVE_ONBOARDING': {
      const sub = state.submissions.find(s => s.id === action.subId);
      if (!sub || sub.calls.length === 0 || sub.status === 'Declined') return state;
      const existing = state.crm.find(patient => patient.organisationId === sub.organisationId && patient.email.toLowerCase() === sub.email.toLowerCase());
      const patientId = existing?.id ?? `P-${state.nextIds.patient}`;
      const approvedBy = state.staffSession?.name ?? 'HHH administrator';
      const approvedAt = new Date();
      return {
        ...state,
        crm: existing ? state.crm.map(patient => patient.id === existing.id ? { ...patient, dob: sub.dob, conditions: sub.conditions, primaryCondition: sub.primaryCondition, referralSource: sub.source, marketingConsent: sub.marketing, status: 'HHH approved' as const } : patient) : [...state.crm, {
          id: patientId,
          organisationId: sub.organisationId,
          name: sub.name,
          email: sub.email,
          mobile: sub.mobile,
          dob: sub.dob,
          address: sub.postcode,
          conditions: sub.conditions,
          primaryCondition: sub.primaryCondition,
          referralSource: sub.source,
          marketingConsent: sub.marketing,
          status: 'HHH approved' as const,
          interactions: [{ ts: approvedAt, type: 'HHH onboarding approved', detail: `${approvedBy} approved programme onboarding after patient review.` }],
        }],
        nextIds: { ...state.nextIds, patient: existing ? state.nextIds.patient : state.nextIds.patient + 1 },
        submissions: state.submissions.map(s =>
          s.id === action.subId ? { ...s, status: 'Approved' as const, reviewedAt: approvedAt, reviewedBy: approvedBy, decisionNote: action.note?.trim() || 'Approved for programme onboarding after HHH telephone review.' } : s
        ),
      };
    }
    case 'DECLINE_ONBOARDING': {
      const sub = state.submissions.find(s => s.id === action.subId);
      if (!sub || sub.calls.length === 0 || sub.status === 'Approved') return state;
      const reviewedBy = state.staffSession?.name ?? 'HHH administrator';
      return {
        ...state,
        submissions: state.submissions.map(s =>
          s.id === action.subId ? { ...s, status: 'Declined' as const, reviewedAt: new Date(), reviewedBy, decisionNote: action.note?.trim() || 'Not onboarded following HHH review.' } : s
        ),
      };
    }

    // ---- Orders ----
    case 'NEW_ORDER': {
      if (action.patientId && !state.crm.some(patient => patient.id === action.patientId && patient.organisationId === state.currentOrganisationId && canCreateOrderForPatient(patient))) return state;
      const id = state.nextIds.order;
      const rxId = state.nextIds.rx;
      const newOrder = blankOrder(id, action.patientId || null, state.currentOrganisationId);
      newOrder.prescriptions = [blankRx(rxId)];
      return {
        ...state,
        orders: [...state.orders, newOrder],
        activeOrderId: id,
        nextIds: { ...state.nextIds, order: id + 1, rx: rxId + 1 },
      };
    }
    case 'START_REDO_ORDER': {
      const source = state.orders.find(order => order.id === action.sourceOrderId && order.organisationId === state.currentOrganisationId);
      if (!source?.patientId || source.payment.status === 'none') return state;
      const reason = getUnresolvedReason(source);
      if (!reason) return state;
      if (!state.crm.some(patient => patient.id === source.patientId && patient.organisationId === state.currentOrganisationId && canCreateOrderForPatient(patient))) return state;
      const existingDraft = state.orders.find(order => order.organisationId === state.currentOrganisationId && order.payment.status === 'none' && order.redoContext?.originalOrderId === source.id);
      if (existingDraft) return {
        ...state,
        activeOrderId: existingDraft.id,
        screen: 'create',
        screenHistory: state.screen === 'create' ? state.screenHistory : [...state.screenHistory.slice(-7), state.screen],
      };
      const id = state.nextIds.order;
      const rxId = state.nextIds.rx;
      const draft = blankOrder(id, source.patientId, state.currentOrganisationId);
      draft.prescriptions = [blankRx(rxId)];
      const redone = applyRedoOntoDraft(draft, source, reason);
      return {
        ...state,
        orders: [...state.orders, redone],
        activeOrderId: id,
        nextIds: { ...state.nextIds, order: id + 1, rx: rxId + 1 },
        screen: 'create',
        screenHistory: state.screen === 'create' ? state.screenHistory : [...state.screenHistory.slice(-7), state.screen],
      };
    }
    case 'APPLY_REDO_FROM_ORDER': {
      const source = state.orders.find(order => order.id === action.sourceOrderId && order.organisationId === state.currentOrganisationId);
      const draft = state.orders.find(order => order.id === action.orderId && order.organisationId === state.currentOrganisationId);
      if (!source || !draft || draft.payment.status !== 'none') return state;
      const reason = getUnresolvedReason(source);
      if (!reason) return state;
      if (source.patientId && draft.patientId && source.patientId !== draft.patientId) return state;
      const existingDraft = state.orders.find(order => order.id !== draft.id && order.organisationId === state.currentOrganisationId && order.payment.status === 'none' && order.redoContext?.originalOrderId === source.id);
      if (existingDraft) return { ...state, activeOrderId: existingDraft.id };
      return mapOrder(state, action.orderId, order => applyRedoOntoDraft(order, source, reason));
    }
    case 'CLEAR_ORDER_REDO_CONTEXT':
      return mapOrder(state, action.orderId, order => {
        if (!order.redoContext) return order;
        const { redoContext: _removed, ...rest } = order;
        return rest;
      });
    case 'SET_ACTIVE_ORDER':
      return { ...state, activeOrderId: action.orderId };
    case 'SET_ORDER_PATIENT': {
      const order = state.orders.find(item => item.id === action.orderId);
      const patient = state.crm.find(item => item.id === action.patientId && item.organisationId === order?.organisationId && canCreateOrderForPatient(item));
      return patient ? mapOrder(state, action.orderId, o => ({
        ...o,
        patientId: patient.id,
        redoContext: o.redoContext && o.redoContext.originalOrderId
          ? (state.orders.find(source => source.id === o.redoContext!.originalOrderId)?.patientId === patient.id ? o.redoContext : undefined)
          : undefined,
        prescriptions: o.prescriptions.map(prescription => prescription.entryMode === 'manual' ? {
          ...prescription,
          curaleafPatientName: patient.name,
          curaleafPatientDob: patient.dob ?? '',
        } : prescription),
      })) : state;
    }
    case 'SET_ORDER_DISPENSING_FEE':
      return mapOrder(state, action.orderId, order => ({ ...order, dispensingFee: Math.max(0, action.amount) }));
    case 'ADD_RX': {
      const rxId = state.nextIds.rx;
      return {
        ...mapOrder(state, action.orderId, o => ({ ...o, prescriptions: [...o.prescriptions, blankRx(rxId)] })),
        nextIds: { ...state.nextIds, rx: rxId + 1 },
      };
    }
    case 'SET_RX_ENTRY_MODE':
      return mapOrder(state, action.orderId, order => {
        const patient = order.patientId
          ? state.crm.find(item => item.id === order.patientId && item.organisationId === order.organisationId && canCreateOrderForPatient(item))
          : null;
        return mapRx(order, action.rxId, prescription => ({
          ...blankRx(prescription.id),
          entryMode: action.mode,
          ...(action.mode === 'manual' && patient ? {
            curaleafPatientName: patient.name,
            curaleafPatientDob: patient.dob ?? '',
          } : {}),
        }));
      });
    case 'SET_RX_PRESCRIBER':
      return mapOrder(state, action.orderId, o => mapRx(o, action.rxId, r => ({ ...r, prescriber: action.prescriber })));
    case 'SET_RX_PATIENT_IDENTITY':
      return mapOrder(state, action.orderId, o => mapRx(o, action.rxId, r => ({
        ...r,
        curaleafPatientName: action.name,
        curaleafPatientDob: action.dob,
      })));
    case 'SET_RX_METADATA':
      return mapOrder(state, action.orderId, o => mapRx(o, action.rxId, r => ({ ...r, ...action.updates })));
    case 'SET_RX_COPY':
      return mapOrder(state, action.orderId, o => mapRx(o, action.rxId, r => ({ ...r, copyFileName: action.fileName })));
    case 'SET_RX_FILE':
      return mapOrder(state, action.orderId, o => mapRx(o, action.rxId, r => ({
        ...r,
        copyFileName: action.fileName,
        fileId: action.fileId,
        ...(r.entryMode === 'clinic' ? {
          clinicScanId: undefined,
          curaleafPrescriptionId: undefined,
          curaleafPrescriptionState: undefined,
          curaleafPatientName: undefined,
          curaleafPatientDob: undefined,
          serialNumber: undefined,
          issueDate: undefined,
          expiryDate: undefined,
          prescriberId: undefined,
          prescriber: '',
          prescriberPin: undefined,
          prescriberGmcNumber: undefined,
          prescriberGphcNumber: undefined,
          items: [],
        } : {}),
      })));
    case 'APPLY_CURALEAF_SCAN':
      return mapOrder(state, action.orderId, o => mapRx(o, action.rxId, r => ({
        ...r,
        clinicScanId: action.scan.scanId,
        curaleafPrescriptionId: action.scan.prescriptionId,
        curaleafPrescriptionState: action.scan.state,
        entryMode: 'clinic',
        curaleafPatientName: action.scan.patientName,
        curaleafPatientDob: action.scan.patientDob,
        serialNumber: action.scan.serialNumber,
        issueDate: action.scan.issueDate,
        expiryDate: action.scan.expiryDate,
        prescriberId: action.scan.prescriberId,
        prescriber: action.scan.prescriberName,
        prescriberPin: '',
        prescriberGmcNumber: action.scan.prescriberGmcNumber,
        prescriberGphcNumber: action.scan.prescriberGphcNumber,
        items: action.scan.items,
      })));
    case 'SET_ORDER_BACKEND_ID':
      return mapOrder(state, action.orderId, o => ({ ...o, backendId: action.backendId }));
    case 'SYNC_ORDER_PATIENT_PRICES': {
      const prices = new Map(action.items.map(item => [item.productId, item.patientPrice]));
      return {
        ...mapOrder(state, action.orderId, order => ({
          ...order,
          prescriptions: order.prescriptions.map(rx => ({
            ...rx,
            items: rx.items.map(item => prices.has(item.productId) ? { ...item, retail: prices.get(item.productId)! } : item),
          })),
        })),
        catalogue: state.catalogue.map(product => prices.has(product.id) ? { ...product, retail: prices.get(product.id)! } : product),
      };
    }
    case 'CONFIRM_CURALEAF_SUBMISSION':
      return mapOrder(state, action.orderId, o => mapRx(o, action.rxId, r => ({
        ...r,
        placed: true,
        poRef: action.customerReference,
        status: 'awaiting-approval',
      })));
    case 'ADD_ITEM_TO_RX':
      return mapOrder(state, action.orderId, o => mapRx(o, action.rxId, r => ({ ...r, items: [...r.items, action.item] })));
    case 'REMOVE_ITEM_FROM_RX':
      return mapOrder(state, action.orderId, o => mapRx(o, action.rxId, r => ({
        ...r, items: r.items.filter(i => i.productId !== action.productId),
      })));
    case 'UPDATE_ITEM_QTY':
      return mapOrder(state, action.orderId, o => mapRx(o, action.rxId, r => ({
        ...r, items: r.items.map(i => i.productId === action.productId ? { ...i, qty: Math.max(1, action.qty) } : i),
      })));
    case 'UPDATE_ITEM_UNITS':
      return mapOrder(state, action.orderId, o => mapRx(o, action.rxId, r => ({
        ...r, items: r.items.map(i => i.productId === action.productId ? { ...i, unitsNeededCount: Math.max(1, Math.floor(action.unitsNeededCount)) } : i),
      })));
    case 'REMOVE_RX':
      return mapOrder(state, action.orderId, o => ({
        ...o, prescriptions: o.prescriptions.filter(r => r.id !== action.rxId),
      }));
    case 'CLEAR_ORDER':
    {
      const removedOrder = state.orders.find(order => order.id === action.orderId);
      const orders = state.orders.filter(order => order.id !== action.orderId);
      const nextDraft = orders.find(order => order.organisationId === removedOrder?.organisationId && order.payment.status === 'none');
      return {
        ...state,
        orders,
        activeOrderId: state.activeOrderId === action.orderId ? nextDraft?.id ?? null : state.activeOrderId,
      };
    }

    // ---- Payment ----
    case 'SEND_PAYMENT_LINK': {
      const order = findOrder(state, action.orderId);
      const patient = state.crm.find(candidate => candidate.id === order?.patientId && candidate.organisationId === order?.organisationId && canCreateOrderForPatient(candidate));
      const prescriptionReady = Boolean(patient && order?.prescriptions.length && order.prescriptions.every(rx => prescriptionIsPaymentReady(rx, patient)));
      if (!order || !patient || !prescriptionReady) return state;
      const amount = orderRevenue(order);
      const nextState = mapOrder(state, action.orderId, o => ({
        ...o,
        payment: { ...o.payment, status: 'sent', route: 'worldpay', amount, ref: null, sentAt: new Date(), paidAt: null, manualTender: null, manualReference: null, manualNotes: null, manualRecordedBy: null },
      }));
      // Find another draft order (payment status 'none') to make active
      const nextDraft = nextState.orders.find(o => o.payment.status === 'none' && o.id !== action.orderId);
      nextState.activeOrderId = nextDraft ? nextDraft.id : null;
      return nextState;
    }
    case 'START_MANUAL_PAYMENT': {
      const order = findOrder(state, action.orderId);
      const patient = state.crm.find(candidate => candidate.id === order?.patientId && candidate.organisationId === order?.organisationId && canCreateOrderForPatient(candidate));
      const prescriptionReady = Boolean(patient && order?.prescriptions.length && order.prescriptions.every(rx => prescriptionIsPaymentReady(rx, patient)));
      if (!order || !patient || !prescriptionReady) return state;
      const amount = orderRevenue(order);
      const nextState = mapOrder(state, action.orderId, o => ({
        ...o,
        payment: { ...o.payment, status: 'sent', route: 'pharmacy', amount, ref: null, sentAt: new Date(), paidAt: null, manualTender: null, manualReference: null, manualNotes: null, manualRecordedBy: null },
      }));
      const nextDraft = nextState.orders.find(o => o.payment.status === 'none' && o.id !== action.orderId);
      nextState.activeOrderId = nextDraft ? nextDraft.id : null;
      return nextState;
    }
    case 'CARRY_OVER_PAYMENT': {
      const order = findOrder(state, action.orderId);
      const source = findOrder(state, action.sourceOrderId);
      if (!order?.redoContext?.isPaidRedo || order.redoContext.originalOrderId !== source?.id || source.payment.status !== 'paid') return state;
      const amount = orderRevenue(order);
      const absorbedDifference = order.redoContext.priceResolution === 'absorb' ? Math.max(0, amount - source.payment.amount) : 0;
      if (Math.abs(amount - source.payment.amount) >= 0.005 && absorbedDifference <= 0) return state;
      const nextState = {
        ...state,
        orders: state.orders.map(candidate => {
          if (candidate.id === order.id) return {
            ...candidate,
            payment: {
              ...source.payment,
              status: 'paid' as const,
              amount: absorbedDifference > 0 ? source.payment.amount : amount,
              paidAt: source.payment.paidAt ?? new Date(),
            },
            pharmacyContribution: absorbedDifference,
          };
          if (candidate.id === source.id) return {
            ...candidate,
            redoneByOrderId: String(order.id),
            unresolvedReason: order.redoContext?.reason,
            redoEligible: false,
            ...(order.redoContext?.reason === 'expired' ? { lifecycleStatus: 'archived', isExpired: true } : {}),
          };
          return candidate;
        }),
      };
      const nextDraft = nextState.orders.find(candidate => candidate.payment.status === 'none' && candidate.id !== action.orderId);
      nextState.activeOrderId = nextDraft ? nextDraft.id : null;
      return nextState;
    }
    case 'SET_REDO_PRICE_RESOLUTION':
      return mapOrder(state, action.orderId, order => order.redoContext ? { ...order, redoContext: { ...order.redoContext, priceResolution: action.resolution } } : order);
    case 'START_ORDER_REFUND':
      return mapOrder(state, action.orderId, order => {
        if (order.payment.status !== 'paid' || order.refund) return order;
        const requestedAt = new Date().toISOString();
        return {
          ...order,
          refund: {
            id: `training-refund-${order.id}`,
            status: 'pending_confirmation',
            amountPence: Math.round(order.payment.amount * 100),
            method: order.payment.route === 'worldpay' ? 'worldpay_portal' : 'pharmacy_manual',
            paymentReference: order.payment.ref ?? `ORDER-${order.id}`,
            reason: action.reason,
            resolution: action.resolution,
            requestedAt,
            requestedBy: state.staffSession?.name ?? 'Pharmacy staff',
          },
        };
      });
    case 'CONFIRM_ORDER_REFUND':
      return mapOrder(state, action.orderId, order => order.refund?.status === 'pending_confirmation' ? {
        ...order,
        refund: { ...order.refund, status: 'completed', externalReference: action.externalReference, confirmedAt: new Date().toISOString(), confirmedBy: state.staffSession?.name ?? 'Pharmacy staff' },
      } : order);
    case 'SET_ORDER_REFUND':
      return mapOrder(state, action.orderId, order => ({ ...order, refund: action.refund }));
    case 'REQUEST_ORDER_CANCELLATION':
      return mapOrder(state, action.orderId, order => {
        const requestedAt = new Date().toISOString();
        const hasCuraleafOrder = order.prescriptions.some(prescription => prescription.placed || prescription.poRef);
        return {
          ...order,
          lifecycleStatus: hasCuraleafOrder ? order.lifecycleStatus : 'cancelled',
          payment: hasCuraleafOrder || order.payment.status === 'paid' ? order.payment : { ...order.payment, status: 'cancelled' },
          cancellation: {
            status: hasCuraleafOrder ? 'curaleaf_contact_required' : order.payment.status === 'paid' ? 'refund_required' : 'cancelled',
            reason: action.reason,
            note: action.note?.trim() || null,
            requestedAt,
            requestedBy: state.staffSession?.name ?? 'Pharmacy staff',
            paymentLinkStatus: order.payment.status === 'sent' ? 'cancelled_in_platform' : 'not_applicable',
            paymentReference: order.payment.ref,
          },
          curaleafCancellation: hasCuraleafOrder ? {
            status: 'contact_required',
            purchaseOrderId: order.prescriptions.find(prescription => prescription.poRef)?.poRef ?? null,
            prescriptionId: order.prescriptions.find(prescription => prescription.curaleafPrescriptionId)?.curaleafPrescriptionId ?? null,
            requestedAt,
            requestedBy: state.staffSession?.name ?? 'Pharmacy staff',
          } : order.curaleafCancellation,
        };
      });
    case 'RECORD_CURALEAF_CANCELLATION_CONTACT':
      return mapOrder(state, action.orderId, order => order.curaleafCancellation ? ({
        ...order,
        cancellation: order.cancellation ? { ...order.cancellation, status: 'awaiting_curaleaf_confirmation' } : order.cancellation,
        curaleafCancellation: {
          ...order.curaleafCancellation,
          status: 'awaiting_confirmation',
          contactReference: action.reference,
          contactNote: action.note?.trim() || null,
          contactedAt: new Date().toISOString(),
          contactedBy: state.staffSession?.name ?? 'Pharmacy staff',
        },
      }) : order);
    case 'CONFIRM_CURALEAF_CANCELLATION':
      return mapOrder(state, action.orderId, order => order.curaleafCancellation ? ({
        ...order,
        lifecycleStatus: 'cancelled',
        cancellation: order.cancellation ? { ...order.cancellation, status: order.payment.status === 'paid' ? 'refund_required' : 'cancelled' } : order.cancellation,
        curaleafCancellation: {
          ...order.curaleafCancellation,
          status: 'confirmed',
          confirmationReference: action.reference,
          confirmedAt: new Date().toISOString(),
          confirmedBy: state.staffSession?.name ?? 'Pharmacy staff',
        },
      }) : order);
    case 'SET_ORDER_CANCELLATION':
      return mapOrder(state, action.orderId, order => ({
        ...order,
        cancellation: action.cancellation,
        curaleafCancellation: action.curaleafCancellation ?? order.curaleafCancellation,
        lifecycleStatus: action.lifecycleStatus ?? order.lifecycleStatus,
        payment: action.paymentStatus ? { ...order.payment, status: action.paymentStatus } : order.payment,
      }));
    case 'CONFIRM_PAYMENT':
      return mapOrder(state, action.orderId, o => ({
        ...o,
        payment: { ...o.payment, status: 'paid', paidAt: new Date() },
      }));
    case 'RECORD_MANUAL_PAYMENT':
      return mapOrder(state, action.orderId, o => o.payment.route !== 'pharmacy' ? o : ({
        ...o,
        payment: {
          ...o.payment,
          status: 'paid',
          paidAt: new Date(),
          manualTender: action.tender,
          manualReference: action.reference?.trim() || null,
          manualNotes: action.notes?.trim() || null,
          manualRecordedBy: state.staffSession?.name || 'Pharmacy staff',
        },
      }));

    // ---- Curaleaf submission simulation ----
    case 'PLACE_ORDER': {
      const order = findOrder(state, action.orderId);
      const patient = state.crm.find(candidate => candidate.id === order?.patientId && candidate.organisationId === order?.organisationId && canCreateOrderForPatient(candidate));
      const prescriptionReady = Boolean(patient && order?.prescriptions.length && order.prescriptions.every(rx => prescriptionIsPaymentReady(rx, patient)));
      if (!order || order.payment.status !== 'paid' || !patient || !prescriptionReady) return state;
      return {
        ...mapOrder(state, action.orderId, o => ({
          ...o,
          prescriptions: o.prescriptions.map(r => {
            return {
              ...r,
              placed: true,
              // Supplier references are populated only from the Curaleaf response or
              // a later reconciliation. Never invent courier or invoice data.
              poRef: null,
              status: 'awaiting-approval' as const,
              invoiceRef: null,
              trackingNumber: null,
              carrier: null,
            };
          }),
        })),
      };
    }
    case 'RECORD_GOODS_RECEIPT': {
      const nextState = mapOrder(state, action.orderId, o => mapRx(o, action.rxId, r => {
        if (r.status !== 'dispatched' && r.status !== 'partially-received') return r;
        const totals = new Map((r.receivedItems ?? []).map(line => [line.productId, line.quantityReceived]));
        action.lines.forEach(line => {
          const ordered = r.items.find(item => item.productId === line.productId)?.qty ?? 0;
          const safeQuantity = Math.max(0, Math.min(ordered, Math.floor(line.quantityReceived)));
          totals.set(line.productId, safeQuantity);
        });
        const receivedItems = r.items.map(item => ({
          productId: item.productId,
          quantityReceived: totals.get(item.productId) ?? 0,
        }));
        const complete = r.items.length > 0 && r.items.every(item =>
          (totals.get(item.productId) ?? 0) >= item.qty
        );
        return {
          ...r,
          status: complete ? 'received' : 'partially-received',
          receivedItems,
          goodsInAt: new Date(),
          goodsInBy: state.staffSession?.name ?? 'Pharmacy staff',
          goodsInNote: action.note?.trim() || null,
        };
      }));
      const receipt = action.lines.map(line => `${line.productId}: ${line.quantityReceived}`).join(', ');
      nextState.toasts = [...nextState.toasts, {
        id: Date.now().toString() + Math.random(),
        message: `Goods-in saved for Rx #${action.rxId} (${receipt}). Collection messaging remains blocked until pharmacy checks are complete.`,
        type: 'success' as const,
      }];
      return nextState;
    }
    case 'MARK_READY_FOR_COLLECTION': {
      const current = findOrder(state, action.orderId)?.prescriptions.find(rx => rx.id === action.rxId);
      if (!current || current.status !== 'received') return state;
      const nextState = mapOrder(state, action.orderId, o => mapRx(o, action.rxId, r => ({
        ...r,
        status: 'ready',
        readyAt: new Date(),
      })));
      const order = state.orders.find(o => o.id === action.orderId);
      const patientObj = order?.patientId ? state.crm.find(p => p.id === order.patientId) : null;
      const patientNameStr = patientObj?.name ?? 'Patient';

      const msg = `Ready-to-collect confirmed for Rx #${action.rxId}. Customer email queued for ${patientNameStr} at ${PHARMACY.collectionPlace}.`;
      const newToast = { id: Date.now().toString() + Math.random(), message: msg, type: 'success' as const };
      nextState.toasts = [...nextState.toasts, newToast];
      return nextState;
    }
    case 'HANDOVER_TO_PATIENT': {
      const nextState = mapOrder(state, action.orderId, o => mapRx(o, action.rxId, r => ({
        ...r,
        status: 'collected',
      })));
      const order = state.orders.find(o => o.id === action.orderId);
      const patientObj = order?.patientId ? state.crm.find(p => p.id === order.patientId) : null;
      const patientNameStr = patientObj?.name ?? 'Patient';
      
      const msg = `Handover Completed: Meds collected by ${patientNameStr}. Prescription cleared from active queue.`;
      const newToast = { id: Date.now().toString() + Math.random(), message: msg, type: 'success' as const };
      nextState.toasts = [...nextState.toasts, newToast];
      return nextState;
    }

    case 'ADD_TOAST': {
      const id = Date.now().toString() + Math.random();
      const newToast = { id, message: action.message, type: action.toastType || 'info' };
      return { ...state, toasts: [...state.toasts, newToast] };
    }

    case 'REMOVE_TOAST': {
      return { ...state, toasts: state.toasts.filter(t => t.id !== action.id) };
    }

    default:
      return state;
  }
}

/* ═══════════════════════════════════════════════════════════
   Context
   ═══════════════════════════════════════════════════════════ */

interface AppContextType {
  state: AppState;
  dispatch: React.Dispatch<Action>;
}

const AppContext = createContext<AppContextType | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const catalogueOrganisationStatus = state.organisations.find(organisation => organisation.id === state.currentOrganisationId)?.status;

  useEffect(() => {
    if (!usePrototypeState) return;
    if (state.staffSession) sessionStorage.setItem('hhh_staff_session', JSON.stringify(state.staffSession));
    else sessionStorage.removeItem('hhh_staff_session');
  }, [state.staffSession]);

  useEffect(() => {
    const useLocalSandbox = isLocalPortalPreview && isApiConfigured;
    const useAuthenticatedPortal = !isLocalPortalPreview
      && isApiConfigured
      && Boolean(state.staffSession)
      && Boolean(catalogueOrganisationStatus);
    if (!useLocalSandbox && !useAuthenticatedPortal) return;
    let cancelled = false;
    dispatch({ type: 'SET_CATALOGUE_LOADING' });
    const request = useLocalSandbox
      ? getDevCuraleafCatalogue()
      : catalogueOrganisationStatus === 'live'
        ? getCuraleafCatalogue(state.currentOrganisationId)
        : getCuraleafTrainingCatalogue(state.currentOrganisationId);
    request.then(catalogue => {
      if (!cancelled) dispatch({ type: 'SET_CATALOGUE', catalogue: mapCuraleafCatalogue(catalogue), updatedAt: catalogue.fetchedAt });
    }).catch(error => {
      if (!cancelled) dispatch({ type: 'SET_CATALOGUE_ERROR', message: error instanceof Error ? error.message : 'Curaleaf catalogue unavailable.' });
    });
    return () => { cancelled = true; };
  }, [catalogueOrganisationStatus, state.currentOrganisationId, state.staffSession]);

  useEffect(() => {
    if (isLocalPortalPreview || !isApiConfigured || !state.staffSession || state.workspaceMode !== 'live' || state.catalogueSource !== 'curaleaf') return;
    let cancelled = false;
    getCuraleafConnectionStatus().then(status => {
      if (cancelled) return;
      dispatch({
        type: 'UPDATE_PLATFORM_INTEGRATION',
        integrationId: 'curaleaf',
        status: status.connected ? 'connected' : status.configured ? 'attention' : 'pending',
        description: status.message || (status.connected ? 'Curaleaf connection verified for this pharmacy.' : 'Curaleaf connection requires attention.'),
      });
    }).catch(error => console.warn('Curaleaf status check unavailable:', error));
    return () => { cancelled = true; };
  }, [state.catalogueSource, state.staffSession, state.workspaceMode]);

  useEffect(() => {
    if (isLocalPortalPreview || !isApiConfigured || !state.staffSession || !state.currentOrganisationId) return;
    let cancelled = false;
    const organisationId = state.currentOrganisationId;
    getPortalPatients(organisationId).then(records => {
      if (cancelled) return;
      dispatch({
        type: 'SYNC_CRM_PATIENTS',
        organisationId,
        patients: records.map(record => ({
          id: record.id,
          organisationId: record.organisationId,
          name: `${record.firstName} ${record.surname}`.trim(),
          email: record.email,
          mobile: record.mobile,
          dob: record.dob,
          address: [record.address, record.postcode].filter(Boolean).join(', '),
          conditions: record.conditions ?? (record.primaryCondition ? [record.primaryCondition] : []),
          primaryCondition: record.primaryCondition ?? record.conditions?.[0] ?? null,
          referralSource: record.referralSource ?? null,
          marketingConsent: record.marketingConsent ?? null,
          status: record.status === 'active' ? 'HHH approved' : record.status === 'referred' ? 'Referred' : 'Suspended',
        })),
      });
    }).catch(error => console.warn('Patient directory sync unavailable:', error));
    return () => { cancelled = true; };
  }, [state.currentOrganisationId, state.staffSession, state.workspaceMode]);

  useEffect(() => {
    if (isLocalPortalPreview || !isApiConfigured || !state.staffSession || !state.currentOrganisationId || state.workspaceMode !== 'live') return;
    let cancelled = false;
    let inFlight = false;
    const organisationId = state.currentOrganisationId;
    const syncOrders = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      try {
        const records = await getPortalOrders(organisationId);
        if (cancelled) return;
        const orders = records
          .slice()
          .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
          .map(mapPortalOrder);
        dispatch({ type: 'SYNC_PORTAL_ORDERS', organisationId, orders });
      } catch (error) {
        if (!cancelled) console.warn('Order history sync unavailable:', error);
      } finally {
        inFlight = false;
      }
    };
    const syncVisibleOrders = () => {
      if (document.visibilityState === 'visible') void syncOrders();
    };
    void syncOrders();
    const interval = window.setInterval(() => void syncOrders(), PORTAL_ORDER_SYNC_INTERVAL_MS);
    window.addEventListener('focus', syncVisibleOrders);
    document.addEventListener('visibilitychange', syncVisibleOrders);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener('focus', syncVisibleOrders);
      document.removeEventListener('visibilitychange', syncVisibleOrders);
    };
  }, [state.currentOrganisationId, state.staffSession, state.workspaceMode]);

  // Cross-domain intake sync. In production, the access token comes from staff authentication.
  useEffect(() => {
    if (isLocalPortalPreview || !isApiConfigured || !state.staffSession || (state.portalMode !== 'admin' && state.workspaceMode !== 'live')) return;
    let cancelled = false;
    const sync = async () => {
      const organisations = state.portalMode === 'admin'
        ? state.organisations
        : state.organisations.filter(org => org.id === state.currentOrganisationId);
      try {
        const groups = await Promise.all(organisations.map(async organisation => ({
          organisation,
          records: await getPortalEligibilitySubmissions(organisation.id),
        })));
        if (cancelled) return;
        groups.forEach(({ organisation, records }) => records.forEach(record => dispatch({
          type: 'ADD_SUBMISSION',
          submission: {
            id: record.id,
            name: `${record.firstName} ${record.surname}`,
            dob: record.dob,
            mobile: record.mobile,
            email: record.email,
            postcode: record.postcode,
            conditions: record.conditions,
            primaryCondition: record.primaryCondition,
            tried2: record.tried2,
            psychExclusion: record.psychExclusion,
            consentReferral: record.consentReferral,
            consentShare: record.consentShare,
            marketing: record.marketing,
            source: record.source,
            status: record.status,
            calls: [],
            reviewedAt: record.reviewedAt,
            reviewedBy: record.reviewedBy,
            decisionNote: record.decisionNote,
            recordsCheck: record.recordsCheck,
            referral: record.referral,
            emailDelivery: record.emailDelivery,
            patientId: record.patientId,
            submittedAt: new Date(record.submittedAt),
            organisationId: record.organisationId,
            pharmacyName: record.pharmacyName,
            referralToken: organisation.referralToken,
          },
        })));
      } catch (error) {
        console.warn('Eligibility API sync unavailable:', error);
      }
    };
    void sync();
    const interval = window.setInterval(() => void sync(), 15000);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [state.currentOrganisationId, state.organisations, state.portalMode, state.staffSession, state.workspaceMode]);

  return (
    <AppContext.Provider value={{ state, dispatch }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
