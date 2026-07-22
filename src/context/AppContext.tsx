import { createContext, useContext, useReducer, useEffect, type ReactNode } from 'react';
import { getCuraleafConnectionStatus, getFormularyPrices, getPortalEligibilitySubmissions, isApiConfigured } from '../shared/api';
import { isLocalPortalPreview, localPortalPreview } from '../dev/localPortalPreview';

/* ═══════════════════════════════════════════════════════════
   Types
   ═══════════════════════════════════════════════════════════ */

export interface CatalogueItem {
  id: string;
  name: string;
  cost: number;      // WX
  retail: number;     // PX
  stock: 'in' | 'low' | 'out';
  type: 'oil' | 'flos' | 'capsule' | 'lozenge' | 'vape';
}

export interface CRMPatient {
  id: string;
  organisationId: string;
  name: string;
  email: string;
  mobile: string;
  dob?: string;
  address?: string;
  status: 'HHH approved' | 'Suspended';
  interactions?: { ts: Date | string; type: string; detail: string }[];
}

export interface LineItem {
  productId: string;
  name: string;
  qty: number;
  cost: number;
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
  prescriber: string;
  copyFileName: string | null;
  items: LineItem[];
  placed: boolean;
  poRef: string | null;
  status: RxStatus;
  invoiceRef: string | null;
  trackingNumber: string | null;
  carrier: string | null;
  receivedItems?: GoodsReceiptLine[];
  goodsInAt?: Date | string | null;
  goodsInBy?: string | null;
  goodsInNote?: string | null;
  readyAt?: Date | string | null;
}

export type PaymentStatus = 'none' | 'sent' | 'paid';
export type PaymentRoute = 'worldpay' | 'pharmacy' | null;
export type ManualTender = 'epos-card' | 'cash' | 'bank-transfer' | 'other';

export interface PatientOrder {
  id: number;
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
}

export type SubmissionStatus = 'New' | 'Under HHH review' | 'Approved' | 'Declined';

export interface EligibilitySubmission {
  id: number | string;
  name: string;
  dob: string;
  mobile: string;
  email: string;
  postcode: string;
  condition: string;
  tried2: boolean;
  psychExclusion: boolean;
  consentReferral: boolean;
  consentShare: boolean;
  marketing: boolean;
  source: string;
  status: SubmissionStatus;
  recordsUploaded: boolean;
  calls: { ts: Date }[];
  reviewedAt: Date | string | null;
  reviewedBy: string | null;
  decisionNote: string | null;
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
  gphcNumber: string;
  superintendent: string;
  address: string;
  websiteDomains: string[];
  status: 'live' | 'onboarding' | 'paused';
  staffCount: number;
  platformFeeMonthly: number | null;
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

export type Screen = 'home' | 'referrals' | 'formulary' | 'create' | 'review' | 'orders' | 'patients' | 'resources' | 'settings';

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
  catalogue: CatalogueItem[];
  formularyPrices: Record<string, Record<string, number>>;
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

export const CATALOGUE: CatalogueItem[] = [
  { id: 'P001', name: 'Adven 20/1 THC Oil 30ml',         cost: 42,   retail: 79,   stock: 'in',  type: 'oil' },
  { id: 'P002', name: 'Curaleaf CBD 50 Oil 50ml',         cost: 30,   retail: 59,   stock: 'in',  type: 'oil' },
  { id: 'P003', name: 'Khiron 20/1 Oil 30ml',             cost: 40,   retail: 75,   stock: 'in',  type: 'oil' },
  { id: 'P004', name: 'Noidecs T10:C10 Flos 10g',         cost: 38.5, retail: 48,   stock: 'low', type: 'flos' },
  { id: 'P005', name: 'Adven Cura-22 Flos 10g',           cost: 44,   retail: 82,   stock: 'out', type: 'flos' },
  { id: 'P006', name: 'Adven THC 10mg Capsules ×30',      cost: 36,   retail: 69,   stock: 'in',  type: 'capsule' },
  { id: 'P007', name: 'Noidecs CBD Lozenge 25mg ×30',     cost: 28,   retail: 55,   stock: 'low', type: 'lozenge' },
  { id: 'P008', name: 'Curaleaf 510 Vape Cartridge 0.5g', cost: 34,   retail: 64,   stock: 'in',  type: 'vape' },
];

export const ORGANISATIONS: PharmacyTenant[] = [
  {
    id: '11111111-1111-4111-8111-111111111111', slug: 'hhh-leeds', referralToken: 'hhh-leeds-7x4p9k',
    name: 'Holistic Health Hub Pharmacy — Leeds', tradingName: 'HHH Leeds', logoText: 'HH',
    gphcNumber: '9012345', superintendent: 'Shaylen Patel',
    address: 'Leeds, West Yorkshire, United Kingdom', websiteDomains: ['hhh.health'],
    status: 'onboarding', staffCount: 4,
    platformFeeMonthly: null,
    brand: { primary: '#0f766e', portalName: 'HHH Leeds Patient Services' },
    modules: { intake: true, rx: true, payments: true, supplierOrders: true, patients: true, resources: true },
    worldpay: { enabled: true, status: 'connected', environment: 'sandbox', merchantId: 'WP-DEMO-LEEDS', merchantName: 'HHH Leeds', lastSyncedAt: new Date(Date.now() - 18 * 60 * 1000) },
  },
  {
    id: '22222222-2222-4222-8222-222222222222', slug: 'east-midlands-lincoln', referralToken: 'emp-lincoln-3m8q2v',
    name: 'East Midlands Pharmacy Lincoln', tradingName: 'EMP Lincoln', logoText: 'EM',
    gphcNumber: '9019876', superintendent: 'A. Pharmacist',
    address: 'Lincoln, Lincolnshire, United Kingdom', websiteDomains: ['eastmidlandspharmacy.co.uk'],
    status: 'onboarding', staffCount: 2,
    platformFeeMonthly: null,
    brand: { primary: '#315b7d', portalName: 'EMP Lincoln Patient Services' },
    modules: { intake: true, rx: true, payments: true, supplierOrders: false, patients: true, resources: true },
    worldpay: { enabled: false, status: 'not-connected', environment: 'sandbox', merchantId: null, merchantName: null, lastSyncedAt: null },
  },
];

const SEED_CRM: CRMPatient[] = [
  { id: 'P-1001', organisationId: ORGANISATIONS[0].id, name: 'James Doe',        email: 'j.doe@email.com',      mobile: '07700 900111', dob: '1988-06-14', address: '12 High St, Leeds LS1 4AB',     status: 'HHH approved' },
  { id: 'P-1002', organisationId: ORGANISATIONS[0].id, name: 'Aisha Smith',      email: 'a.smith@email.com',    mobile: '07700 900222', dob: '1992-09-03', address: '4 Oak Rd, Leeds LS2 8PQ',       status: 'HHH approved',
    interactions: [
      { ts: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000), type: 'Invoice Dispatched', detail: 'Sent Worldpay invoice link for £48.00.' },
      { ts: new Date(Date.now() - 12 * 24 * 60 * 60 * 1000), type: 'Prescription Ready', detail: 'Meds received from wholesaler. Sent counter collection alert SMS.' }
    ]
  },
  { id: 'P-1003', organisationId: ORGANISATIONS[0].id, name: 'Mohammed Khan',    email: 'm.khan@email.com',     mobile: '07700 900333', dob: '1979-12-21', address: '9 Park Ave, Leeds LS6 1RT',     status: 'HHH approved' },
  { id: 'P-1004', organisationId: ORGANISATIONS[0].id, name: 'Sophie Bennett',   email: 's.bennett@email.com',  mobile: '07700 900444', dob: '1987-04-11', address: '27 Cardigan Rd, Leeds LS6 3AA', status: 'HHH approved',
    interactions: [
      { ts: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000), type: 'Meds Collected', detail: 'Dispensed 10g Noidecs CD to patient at counter.' }
    ]
  },
  { id: 'P-1005', organisationId: ORGANISATIONS[0].id, name: "Daniel O'Connor",  email: 'd.oconnor@email.com',  mobile: '07700 900555', dob: '1991-01-30', address: '8 Burley St, Leeds LS3 1JX',    status: 'HHH approved' },
  { id: 'P-1006', organisationId: ORGANISATIONS[0].id, name: 'Priya Patel',      email: 'p.patel@email.com',    mobile: '07700 900666', dob: '1984-08-16', address: '15 Roundhay Rd, Leeds LS8 5AQ', status: 'HHH approved' },
  { id: 'P-1007', organisationId: ORGANISATIONS[0].id, name: 'Liam Murphy',      email: 'l.murphy@email.com',   mobile: '07700 900777', dob: '1975-05-24', address: '3 Kirkstall Ln, Leeds LS5 3BW', status: 'HHH approved' },
  { id: 'P-1008', organisationId: ORGANISATIONS[0].id, name: 'Grace Thompson',   email: 'g.thompson@email.com', mobile: '07700 900888', dob: '1996-10-08', address: '41 Otley Rd, Leeds LS16 5JT',   status: 'HHH approved' },
  { id: 'P-1009', organisationId: ORGANISATIONS[1].id, name: 'Daniel Price',     email: 'd.price@email.com',    mobile: '07700 900503', dob: '1977-07-23', address: 'LS2 7DR',                       status: 'HHH approved' },
];

/* ═══════════════════════════════════════════════════════════
   Helpers
   ═══════════════════════════════════════════════════════════ */

export const money = (n: number) => '£' + n.toFixed(2);
export const marginPct = (cost: number, retail: number) => retail > 0 ? Math.round((1 - cost / retail) * 100) : 0;

export const lineRevenue = (item: LineItem) => item.retail * item.qty;
export const lineCost = (item: LineItem) => item.cost * item.qty;
export const lineMargin = (item: LineItem) => {
  const rev = lineRevenue(item);
  return rev > 0 ? Math.round((rev - lineCost(item)) / rev * 100) : 0;
};

export const rxRevenue = (rx: Prescription) => rx.items.reduce((t, i) => t + lineRevenue(i), 0);
export const rxCost = (rx: Prescription) => rx.items.reduce((t, i) => t + lineCost(i), 0);
export const orderRevenue = (o: PatientOrder) => o.prescriptions.reduce((t, r) => t + rxRevenue(r), 0) + (o.dispensingFee || 0);
export const orderCost = (o: PatientOrder) => o.prescriptions.reduce((t, r) => t + rxCost(r), 0);

export const TYPE_LABELS: Record<string, string> = {
  flos: 'Flower (Flos)', oil: 'Oil', capsule: 'Capsule', lozenge: 'Lozenge', vape: 'Vape',
};

export const STOCK_LABELS: Record<string, string> = {
  in: 'In stock', low: 'Low stock / On order', out: 'Out of stock',
};

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
  | { type: 'SET_FORMULARY_PRICES'; organisationId: string; prices: Record<string, number> }
  | { type: 'SET_FORMULARY_PRICE'; organisationId: string; productId: string; retail: number | null }
  | { type: 'LOG_INTERACTION'; patientId: string; interactionType: string; detail: string }
  // Referrals
  | { type: 'ADD_SUBMISSION'; submission: EligibilitySubmission }
  | { type: 'UPLOAD_RECORDS'; subId: EligibilitySubmission['id'] }
  | { type: 'LOG_CALL'; subId: EligibilitySubmission['id'] }
  | { type: 'APPROVE_ONBOARDING'; subId: EligibilitySubmission['id']; note?: string }
  | { type: 'DECLINE_ONBOARDING'; subId: EligibilitySubmission['id']; note?: string }
  // Orders
  | { type: 'NEW_ORDER'; patientId?: string }
  | { type: 'SET_ACTIVE_ORDER'; orderId: number }
  | { type: 'SET_ORDER_PATIENT'; orderId: number; patientId: string }
  | { type: 'SET_ORDER_DISPENSING_FEE'; orderId: number; amount: number }
  | { type: 'ADD_RX'; orderId: number }
  | { type: 'SET_RX_PRESCRIBER'; orderId: number; rxId: number; prescriber: string }
  | { type: 'SET_RX_COPY'; orderId: number; rxId: number; fileName: string }
  | { type: 'ADD_ITEM_TO_RX'; orderId: number; rxId: number; item: LineItem }
  | { type: 'REMOVE_ITEM_FROM_RX'; orderId: number; rxId: number; productId: string }
  | { type: 'UPDATE_ITEM_QTY'; orderId: number; rxId: number; productId: string; qty: number }
  | { type: 'SET_ITEM_RETAIL'; orderId: number; rxId: number; productId: string; retail: number }
  | { type: 'REMOVE_RX'; orderId: number; rxId: number }
  | { type: 'CLEAR_ORDER'; orderId: number }
  // Payment
  | { type: 'SEND_PAYMENT_LINK'; orderId: number }
  | { type: 'START_MANUAL_PAYMENT'; orderId: number }
  | { type: 'CONFIRM_PAYMENT'; orderId: number }
  | { type: 'RECORD_MANUAL_PAYMENT'; orderId: number; tender: ManualTender; reference?: string; notes?: string }
  // Submission to Curaleaf (adapter pending live Rocky credentials)
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
    id, prescriber: '', copyFileName: null, items: [], placed: false,
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

function buildSeedSubmissions(): EligibilitySubmission[] {
  const base = { tried2: true, psychExclusion: false, consentReferral: true, consentShare: true, organisationId: '11111111-1111-4111-8111-111111111111', pharmacyName: 'Holistic Health Hub Pharmacy — Leeds', referralToken: 'hhh-leeds-7x4p9k' };
  const s1: EligibilitySubmission = {
    id: 1, name: 'Tom Hughes', dob: '1989-04-12', mobile: '07700 900501', email: 't.hughes@email.com',
    postcode: 'LS1 6PJ', condition: 'Chronic Pain', ...base, marketing: false, source: 'Google',
    status: 'New', recordsUploaded: false, calls: [], reviewedAt: null, reviewedBy: null, decisionNote: null, submittedAt: new Date(),
  };
  const s2: EligibilitySubmission = {
    id: 2, name: 'Rebecca Allen', dob: '1994-11-02', mobile: '07700 900502', email: 'r.allen@email.com',
    postcode: 'LS2 8PQ', condition: 'Anxiety', ...base, marketing: true, source: 'Word of mouth',
    status: 'Under HHH review', recordsUploaded: false, calls: [{ ts: new Date(Date.now() - 24 * 60 * 60 * 1000) }], reviewedAt: null, reviewedBy: null, decisionNote: null, submittedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), // 3 days ago
  };
  const s3: EligibilitySubmission = {
    id: 3, name: 'Daniel Price', dob: '1977-07-23', mobile: '07700 900503', email: 'd.price@email.com',
    postcode: 'LS2 7DR', condition: 'Chronic Pain', ...base, marketing: false, source: 'Poster / Leaflet',
    status: 'Approved', recordsUploaded: true, calls: [{ ts: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) }], reviewedAt: new Date(Date.now() - 24 * 60 * 60 * 1000), reviewedBy: 'Shaylen Patel', decisionNote: 'Approved for programme onboarding after telephone review.', submittedAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000),
  };
  const s4: EligibilitySubmission = {
    id: 4, name: 'Sara Knight', dob: '1985-02-15', mobile: '07700 900504', email: 's.knight@email.com',
    postcode: 'LS1 5DA', condition: 'Insomnia', ...base, marketing: false, source: 'Text',
    status: 'Declined', recordsUploaded: true, calls: [{ ts: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) }], reviewedAt: new Date(Date.now() - 24 * 60 * 60 * 1000), reviewedBy: 'Shaylen Patel', decisionNote: 'Not onboarded following HHH review.', submittedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
  };
  s3.organisationId = '22222222-2222-4222-8222-222222222222';
  s3.pharmacyName = 'East Midlands Pharmacy Lincoln';
  s3.referralToken = 'emp-lincoln-3m8q2v';
  return [s1, s2, s3, s4];
}

function buildSeedOrders(): { orders: PatientOrder[]; nextRx: number } {
  const rx1: Prescription = {
    id: 1, prescriber: 'Dr. A. Lee', copyFileName: 'prescription_jdoe_1.pdf',
    items: [
      { productId: 'P001', name: 'Adven 20/1 THC Oil 30ml', qty: 2, cost: 42, retail: 79 },
      { productId: 'P002', name: 'Curaleaf CBD 50 Oil 50ml', qty: 1, cost: 30, retail: 59 },
    ],
    placed: false, poRef: null, status: 'draft', invoiceRef: null, trackingNumber: null, carrier: null,
  };
  const rx2: Prescription = {
    id: 2, prescriber: 'Dr. A. Lee', copyFileName: 'prescription_jdoe_2.pdf',
    items: [
      { productId: 'P003', name: 'Khiron 20/1 Oil 30ml', qty: 1, cost: 40, retail: 75 },
    ],
    placed: false, poRef: null, status: 'draft', invoiceRef: null, trackingNumber: null, carrier: null,
  };
  const o1: PatientOrder = {
    id: 1, organisationId: ORGANISATIONS[0].id, patientId: 'P-1001', date: new Date(), dispensingFee: 0,
    payment: { status: 'none', route: null, amount: 0, ref: null, sentAt: null, paidAt: null, manualTender: null, manualReference: null, manualNotes: null, manualRecordedBy: null },
    prescriptions: [rx1, rx2],
  };

  const rx3: Prescription = {
    id: 3, prescriber: 'Dr. R. Okafor', copyFileName: 'prescription_asmith.pdf',
    items: [
      { productId: 'P004', name: 'Noidecs T10:C10 Flos 10g', qty: 1, cost: 38.5, retail: 48 },
    ],
    placed: true, poRef: 'PO-9002', status: 'ready', invoiceRef: 'INV-4071', trackingNumber: null, carrier: null,
    receivedItems: [{ productId: 'P004', quantityReceived: 1 }], goodsInAt: new Date(Date.now() - 12 * 24 * 60 * 60 * 1000), goodsInBy: 'S. Patel',
    readyAt: new Date(Date.now() - 12 * 24 * 60 * 60 * 1000), // 12 days ago
  };
  const o2: PatientOrder = {
    id: 2, organisationId: ORGANISATIONS[0].id, patientId: 'P-1002', date: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000), dispensingFee: 0,
    payment: { status: 'paid', route: 'worldpay', amount: 48, ref: 'WP-8812', sentAt: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000), paidAt: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000), manualTender: null, manualReference: null, manualNotes: null, manualRecordedBy: null },
    prescriptions: [rx3],
  };

  const rx4: Prescription = {
    id: 4, prescriber: 'Dr. S. Patel', copyFileName: 'prescription_jdoe_overdue.pdf',
    items: [
      { productId: 'P001', name: 'Adven 20/1 THC Oil 30ml', qty: 1, cost: 42, retail: 79 },
    ],
    placed: true, poRef: 'PO-9003', status: 'approved', invoiceRef: 'INV-4073', trackingNumber: null, carrier: null,
  };
  const o3: PatientOrder = {
    id: 3, organisationId: ORGANISATIONS[0].id, patientId: 'P-1003', date: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000), dispensingFee: 0,
    payment: {
      status: 'sent',
      route: 'worldpay',
      amount: 79,
      ref: 'WP-8815',
      sentAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), // 5 days ago
      paidAt: null, manualTender: null, manualReference: null, manualNotes: null, manualRecordedBy: null,
    },
    prescriptions: [rx4],
  };

  const rx5: Prescription = {
    id: 5, prescriber: 'Dr. R. Okafor', copyFileName: 'prescription_sbennett.pdf',
    items: [
      { productId: 'P006', name: 'Adven THC 10mg Capsules ×30', qty: 1, cost: 36, retail: 69 },
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

  return { orders: [o1, o2, o3, o4], nextRx: 6 };
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
  catalogue: usePrototypeState ? CATALOGUE : [],
  formularyPrices: {},
  crm: usePrototypeState ? [...SEED_CRM] : [],
  submissions: usePrototypeState ? buildSeedSubmissions() : [],
  orders: usePrototypeState ? seed.orders : [],
  activeOrderId: usePrototypeState ? 1 : null,
  toasts: [],
  nextIds: { patient: 2000, rx: seed.nextRx, order: 5, submission: 5, invoice: 4072 },
  portalMode: initialPortalMode,
  workspaceMode: 'training',
  organisations: usePrototypeState ? ORGANISATIONS : [],
  currentOrganisationId: usePrototypeState ? initialOrganisation.id : '',
  staffSession: storedStaffSession,
  platformIntegrations: [
    { id: 'eligibility-api', name: 'HHH Eligibility API', description: 'Token routing and patient intake', status: 'connected' },
    { id: 'curaleaf', name: 'Curaleaf Rocky', description: 'Product, prescription and supplier ordering', status: 'pending' },
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
      return { ...state, screen: action.screen };
    case 'SET_FORMULARY_PRICES': {
      const prices = Object.fromEntries(Object.entries(action.prices).map(([productId, retail]) => [productId, Math.max(0, retail)]));
      return {
        ...state,
        formularyPrices: { ...state.formularyPrices, [action.organisationId]: prices },
        orders: state.orders.map(order => order.organisationId !== action.organisationId || order.payment.status !== 'none' ? order : ({
          ...order,
          prescriptions: order.prescriptions.map(rx => ({
            ...rx,
            items: rx.items.map(item => prices[item.productId] === undefined ? item : { ...item, retail: prices[item.productId] }),
          })),
        })),
      };
    }
    case 'SET_FORMULARY_PRICE': {
      if (!state.catalogue.some(item => item.id === action.productId)) return state;
      const current = state.formularyPrices[action.organisationId] ?? {};
      const next = { ...current };
      if (action.retail === null) delete next[action.productId];
      else next[action.productId] = Math.max(0, action.retail);
      const effectiveRetail = next[action.productId] ?? state.catalogue.find(item => item.id === action.productId)?.retail;
      return {
        ...state,
        formularyPrices: { ...state.formularyPrices, [action.organisationId]: next },
        orders: state.orders.map(order => order.organisationId !== action.organisationId || order.payment.status !== 'none' ? order : ({
          ...order,
          prescriptions: order.prescriptions.map(rx => ({
            ...rx,
            items: rx.items.map(item => item.productId === action.productId && effectiveRetail !== undefined ? { ...item, retail: effectiveRetail } : item),
          })),
        })),
      };
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
      return { ...state, portalMode: action.mode };
    case 'SET_WORKSPACE_MODE': {
      if (action.mode === 'training') {
        const organisationId = action.organisationId ?? state.currentOrganisationId;
        if (state.workspaceMode === 'training' && state.orders.length > 0 && state.orders.every(order => order.organisationId === organisationId)) return state;
        const training = buildTenantTrainingData(organisationId);
        return {
          ...state,
          workspaceMode: 'training',
          screen: 'home',
          catalogue: CATALOGUE,
          formularyPrices: {},
          crm: training.crm,
          submissions: training.submissions,
          orders: training.orders,
          activeOrderId: 1,
          nextIds: { patient: 2000, rx: training.nextRx, order: 5, submission: 5, invoice: 4072 },
        };
      }
      if (state.workspaceMode === action.mode) return state;
      return {
        ...state,
        workspaceMode: 'live',
        screen: 'home',
        catalogue: [],
        formularyPrices: {},
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
        catalogue: usePrototypeState ? CATALOGUE : [],
        formularyPrices: {},
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
      if (state.submissions.some(s => s.organisationId === action.submission.organisationId && s.email.toLowerCase() === action.submission.email.toLowerCase())) {
        return state;
      }
      return {
        ...state,
        submissions: [action.submission, ...state.submissions],
      };
    }
    case 'UPLOAD_RECORDS': {
      return {
        ...state,
        submissions: state.submissions.map(s =>
          s.id === action.subId ? { ...s, recordsUploaded: true } : s
        ),
      };
    }
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
        crm: existing ? state.crm.map(patient => patient.id === existing.id ? { ...patient, dob: sub.dob, status: 'HHH approved' as const } : patient) : [...state.crm, {
          id: patientId,
          organisationId: sub.organisationId,
          name: sub.name,
          email: sub.email,
          mobile: sub.mobile,
          dob: sub.dob,
          address: sub.postcode,
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
      if (action.patientId && !state.crm.some(patient => patient.id === action.patientId && patient.organisationId === state.currentOrganisationId && patient.status === 'HHH approved')) return state;
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
    case 'SET_ACTIVE_ORDER':
      return { ...state, activeOrderId: action.orderId };
    case 'SET_ORDER_PATIENT': {
      const order = state.orders.find(item => item.id === action.orderId);
      const patient = state.crm.find(item => item.id === action.patientId && item.organisationId === order?.organisationId && item.status === 'HHH approved');
      return patient ? mapOrder(state, action.orderId, o => ({ ...o, patientId: patient.id })) : state;
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
    case 'SET_RX_PRESCRIBER':
      return mapOrder(state, action.orderId, o => mapRx(o, action.rxId, r => ({ ...r, prescriber: action.prescriber })));
    case 'SET_RX_COPY':
      return mapOrder(state, action.orderId, o => mapRx(o, action.rxId, r => ({ ...r, copyFileName: action.fileName })));
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
    case 'SET_ITEM_RETAIL':
      return mapOrder(state, action.orderId, o => mapRx(o, action.rxId, r => ({
        ...r, items: r.items.map(i => i.productId === action.productId ? { ...i, retail: Math.max(0, action.retail) } : i),
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
      const patientApproved = state.crm.some(patient => patient.id === order?.patientId && patient.organisationId === order?.organisationId && patient.status === 'HHH approved');
      const prescriptionReady = order?.prescriptions.every(rx => Boolean(rx.copyFileName && rx.prescriber.trim() && rx.items.length));
      if (!order || !patientApproved || !prescriptionReady) return state;
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
      const patientApproved = state.crm.some(patient => patient.id === order?.patientId && patient.organisationId === order?.organisationId && patient.status === 'HHH approved');
      const prescriptionReady = order?.prescriptions.every(rx => Boolean(rx.copyFileName && rx.prescriber.trim() && rx.items.length));
      if (!order || !patientApproved || !prescriptionReady) return state;
      const amount = orderRevenue(order);
      const nextState = mapOrder(state, action.orderId, o => ({
        ...o,
        payment: { ...o.payment, status: 'sent', route: 'pharmacy', amount, ref: null, sentAt: new Date(), paidAt: null, manualTender: null, manualReference: null, manualNotes: null, manualRecordedBy: null },
      }));
      const nextDraft = nextState.orders.find(o => o.payment.status === 'none' && o.id !== action.orderId);
      nextState.activeOrderId = nextDraft ? nextDraft.id : null;
      return nextState;
    }
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
      const patientApproved = state.crm.some(patient => patient.id === order?.patientId && patient.organisationId === order?.organisationId && patient.status === 'HHH approved');
      const prescriptionReady = order?.prescriptions.every(rx => Boolean(rx.copyFileName && rx.prescriber.trim() && rx.items.length));
      if (!order || order.payment.status !== 'paid' || !patientApproved || !prescriptionReady) return state;
      return {
        ...mapOrder(state, action.orderId, o => ({
          ...o,
          prescriptions: o.prescriptions.map(r => {
            return {
              ...r,
              placed: true,
              // Supplier references are populated only from the Rocky response or
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

      const msg = `Dispensing checks completed for Rx #${action.rxId}. Collection notification queued for ${patientNameStr} at ${PHARMACY.collectionPlace}.`;
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

  useEffect(() => {
    if (!usePrototypeState) return;
    if (state.staffSession) sessionStorage.setItem('hhh_staff_session', JSON.stringify(state.staffSession));
    else sessionStorage.removeItem('hhh_staff_session');
  }, [state.staffSession]);

  useEffect(() => {
    if (isLocalPortalPreview || !isApiConfigured || !state.staffSession || state.workspaceMode !== 'live') return;
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
  }, [state.staffSession, state.workspaceMode]);

  useEffect(() => {
    if (isLocalPortalPreview || !isApiConfigured || !state.staffSession || state.workspaceMode !== 'live' || !state.currentOrganisationId) return;
    let cancelled = false;
    getFormularyPrices(state.currentOrganisationId).then(records => {
      if (cancelled) return;
      const prices = Object.fromEntries(records
        .filter(record => record.patientPricePence !== null)
        .map(record => [record.productId, record.patientPricePence! / 100]));
      dispatch({ type: 'SET_FORMULARY_PRICES', organisationId: state.currentOrganisationId, prices });
    }).catch(error => console.warn('Formulary pricing sync unavailable:', error));
    return () => { cancelled = true; };
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
            condition: record.condition,
            tried2: record.tried2,
            psychExclusion: record.psychExclusion,
            consentReferral: record.consentReferral,
            consentShare: record.consentShare,
            marketing: record.marketing,
            source: record.source,
            status: record.status,
            recordsUploaded: false,
            calls: [],
            reviewedAt: record.reviewedAt,
            reviewedBy: record.reviewedBy,
            decisionNote: record.decisionNote,
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
