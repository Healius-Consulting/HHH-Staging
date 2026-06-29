import { createContext, useContext, useReducer, useEffect, useRef, type ReactNode } from 'react';

/* ═══════════════════════════════════════════════════════════
   Types
   ═══════════════════════════════════════════════════════════ */

export interface CatalogueItem {
  id: string;
  name: string;
  cost: number;      // wholesale
  retail: number;     // patient price
  stock: 'in' | 'low' | 'out';
  type: 'oil' | 'flos' | 'capsule' | 'lozenge' | 'vape';
}

export interface CRMPatient {
  id: string;
  name: string;
  email: string;
  mobile: string;
  address: string;
  status: 'Referred';
}

export interface LineItem {
  productId: string;
  name: string;
  qty: number;
  cost: number;
  retail: number;
  fee: number;       // dispensing fee
}

export type RxStatus = 'draft' | 'awaiting-approval' | 'approved' | 'dispatched' | 'ready';

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
}

export type PaymentStatus = 'none' | 'sent' | 'paid';

export interface PatientOrder {
  id: number;
  patientId: string | null;
  date: Date;
  feeExtra: number;
  payment: {
    status: PaymentStatus;
    amount: number;
    ref: string | null;
    sentAt: Date | null;
  };
  prescriptions: Prescription[];
}

export type SubmissionStatus = 'New' | 'Records uploaded' | 'Referred to clinic' | 'Completed';

export interface EligibilitySubmission {
  id: number;
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
  clinicRef: string | null;
  emailedAt: Date | null;
  submittedAt: Date;
}

export type Screen = 'home' | 'referrals' | 'formulary' | 'create' | 'review' | 'orders' | 'patients';

export interface Toast {
  id: string;
  message: string;
  type: 'success' | 'info' | 'warning' | 'error';
}

export interface AppState {
  screen: Screen;
  catalogue: CatalogueItem[];
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
    clinic: number;
    invoice: number;
  };
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

const SEED_CRM: CRMPatient[] = [
  { id: 'P-1001', name: 'James Doe',        email: 'j.doe@email.com',      mobile: '07700 900111', address: '12 High St, Leeds LS1 4AB',     status: 'Referred' },
  { id: 'P-1002', name: 'Aisha Smith',      email: 'a.smith@email.com',    mobile: '07700 900222', address: '4 Oak Rd, Leeds LS2 8PQ',       status: 'Referred' },
  { id: 'P-1003', name: 'Mohammed Khan',    email: 'm.khan@email.com',     mobile: '07700 900333', address: '9 Park Ave, Leeds LS6 1RT',     status: 'Referred' },
  { id: 'P-1004', name: 'Sophie Bennett',   email: 's.bennett@email.com',  mobile: '07700 900444', address: '27 Cardigan Rd, Leeds LS6 3AA', status: 'Referred' },
  { id: 'P-1005', name: "Daniel O'Connor",  email: 'd.oconnor@email.com',  mobile: '07700 900555', address: '8 Burley St, Leeds LS3 1JX',    status: 'Referred' },
  { id: 'P-1006', name: 'Priya Patel',      email: 'p.patel@email.com',    mobile: '07700 900666', address: '15 Roundhay Rd, Leeds LS8 5AQ', status: 'Referred' },
  { id: 'P-1007', name: 'Liam Murphy',      email: 'l.murphy@email.com',   mobile: '07700 900777', address: '3 Kirkstall Ln, Leeds LS5 3BW', status: 'Referred' },
  { id: 'P-1008', name: 'Grace Thompson',   email: 'g.thompson@email.com', mobile: '07700 900888', address: '41 Otley Rd, Leeds LS16 5JT',   status: 'Referred' },
];

/* ═══════════════════════════════════════════════════════════
   Helpers
   ═══════════════════════════════════════════════════════════ */

export const money = (n: number) => '£' + n.toFixed(2);
export const marginPct = (cost: number, retail: number) => retail > 0 ? Math.round((1 - cost / retail) * 100) : 0;

export const lineRevenue = (item: LineItem) => item.retail * item.qty + (item.fee || 0);
export const lineCost = (item: LineItem) => item.cost * item.qty;
export const lineMargin = (item: LineItem) => {
  const rev = lineRevenue(item);
  return rev > 0 ? Math.round((rev - lineCost(item)) / rev * 100) : 0;
};

export const rxRevenue = (rx: Prescription) => rx.items.reduce((t, i) => t + lineRevenue(i), 0);
export const rxCost = (rx: Prescription) => rx.items.reduce((t, i) => t + lineCost(i), 0);
export const orderRevenue = (o: PatientOrder) => o.prescriptions.reduce((t, r) => t + rxRevenue(r), 0) + (o.feeExtra || 0);
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
  ready: 'Ready for collection',
};

export const PHARMACY = { name: 'Holistic Health Hub Pharmacy — Leeds', formUrl: 'hhh.health/eligibility/leeds-ls1' };

/* ═══════════════════════════════════════════════════════════
   Actions
   ═══════════════════════════════════════════════════════════ */

export type Action =
  | { type: 'SET_SCREEN'; screen: Screen }
  // Referrals
  | { type: 'UPLOAD_RECORDS'; subId: number }
  | { type: 'LOG_CALL'; subId: number }
  | { type: 'REFER_TO_CLINIC'; subId: number }
  | { type: 'EMAIL_REFERRAL'; subId: number }
  // Orders
  | { type: 'NEW_ORDER'; patientId?: string }
  | { type: 'SET_ACTIVE_ORDER'; orderId: number }
  | { type: 'SET_ORDER_PATIENT'; orderId: number; patientId: string }
  | { type: 'ADD_RX'; orderId: number }
  | { type: 'SET_RX_PRESCRIBER'; orderId: number; rxId: number; prescriber: string }
  | { type: 'SET_RX_COPY'; orderId: number; rxId: number; fileName: string }
  | { type: 'ADD_ITEM_TO_RX'; orderId: number; rxId: number; item: LineItem }
  | { type: 'REMOVE_ITEM_FROM_RX'; orderId: number; rxId: number; productId: string }
  | { type: 'UPDATE_ITEM_QTY'; orderId: number; rxId: number; productId: string; qty: number }
  | { type: 'SET_ITEM_FEE'; orderId: number; rxId: number; productId: string; fee: number }
  | { type: 'REMOVE_RX'; orderId: number; rxId: number }
  | { type: 'CLEAR_ORDER'; orderId: number }
  // Payment
  | { type: 'SEND_PAYMENT_LINK'; orderId: number }
  | { type: 'CONFIRM_PAYMENT'; orderId: number }
  // Submission to Curaleaf (simulated)
  | { type: 'PLACE_ORDER'; orderId: number }
  | { type: 'ADVANCE_RX_STATUS'; orderId: number; rxId: number }
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

function blankOrder(id: number, patientId: string | null): PatientOrder {
  return {
    id, patientId, date: new Date(), feeExtra: 0,
    payment: { status: 'none', amount: 0, ref: null, sentAt: null },
    prescriptions: [blankRx(1)],
  };
}

function buildSeedSubmissions(): EligibilitySubmission[] {
  const base = { tried2: true, psychExclusion: false, consentReferral: true, consentShare: true };
  const s1: EligibilitySubmission = {
    id: 1, name: 'Tom Hughes', dob: '1989-04-12', mobile: '07700 900501', email: 't.hughes@email.com',
    postcode: 'LS1 6PJ', condition: 'Chronic Pain', ...base, marketing: false, source: 'Google',
    status: 'New', recordsUploaded: false, calls: [], clinicRef: null, emailedAt: null, submittedAt: new Date(),
  };
  const s2: EligibilitySubmission = {
    id: 2, name: 'Rebecca Allen', dob: '1994-11-02', mobile: '07700 900502', email: 'r.allen@email.com',
    postcode: 'LS2 8PQ', condition: 'Anxiety', ...base, marketing: true, source: 'Word of mouth',
    status: 'New', recordsUploaded: false, calls: [], clinicRef: null, emailedAt: null, submittedAt: new Date(),
  };
  const s3: EligibilitySubmission = {
    id: 3, name: 'Daniel Price', dob: '1977-07-23', mobile: '07700 900503', email: 'd.price@email.com',
    postcode: 'LS2 7DR', condition: 'Chronic Pain', ...base, marketing: false, source: 'Poster / Leaflet',
    status: 'Records uploaded', recordsUploaded: true, calls: [], clinicRef: null, emailedAt: null, submittedAt: new Date(),
  };
  const s4: EligibilitySubmission = {
    id: 4, name: 'Sara Knight', dob: '1985-02-15', mobile: '07700 900504', email: 's.knight@email.com',
    postcode: 'LS1 5DA', condition: 'Insomnia', ...base, marketing: false, source: 'Text',
    status: 'Referred to clinic', recordsUploaded: true, calls: [], clinicRef: 'CLN-5200', emailedAt: null, submittedAt: new Date(),
  };
  return [s1, s2, s3, s4];
}

function buildSeedOrders(): { orders: PatientOrder[]; nextRx: number } {
  const rx1: Prescription = {
    id: 1, prescriber: 'Dr. A. Lee', copyFileName: 'prescription_jdoe_1.pdf',
    items: [
      { productId: 'P001', name: 'Adven 20/1 THC Oil 30ml', qty: 2, cost: 42, retail: 79, fee: 0 },
      { productId: 'P002', name: 'Curaleaf CBD 50 Oil 50ml', qty: 1, cost: 30, retail: 59, fee: 0 },
    ],
    placed: false, poRef: null, status: 'draft', invoiceRef: null, trackingNumber: null, carrier: null,
  };
  const rx2: Prescription = {
    id: 2, prescriber: 'Dr. A. Lee', copyFileName: 'prescription_jdoe_2.pdf',
    items: [
      { productId: 'P003', name: 'Khiron 20/1 Oil 30ml', qty: 1, cost: 40, retail: 75, fee: 0 },
    ],
    placed: false, poRef: null, status: 'draft', invoiceRef: null, trackingNumber: null, carrier: null,
  };
  const o1: PatientOrder = {
    id: 1, patientId: 'P-1001', date: new Date(), feeExtra: 0,
    payment: { status: 'none', amount: 0, ref: null, sentAt: null },
    prescriptions: [rx1, rx2],
  };

  const rx3: Prescription = {
    id: 3, prescriber: 'Dr. R. Okafor', copyFileName: 'prescription_asmith.pdf',
    items: [
      { productId: 'P004', name: 'Noidecs T10:C10 Flos 10g', qty: 1, cost: 38.5, retail: 48, fee: 0 },
    ],
    placed: false, poRef: null, status: 'draft', invoiceRef: null, trackingNumber: null, carrier: null,
  };
  const o2: PatientOrder = {
    id: 2, patientId: 'P-1002', date: new Date(new Date().getFullYear(), new Date().getMonth(), 1, 9, 0), feeExtra: 0,
    payment: { status: 'none', amount: 0, ref: null, sentAt: null },
    prescriptions: [rx3],
  };

  return { orders: [o1, o2], nextRx: 4 };
}

const seed = buildSeedOrders();

const initialState: AppState = {
  screen: 'home',
  catalogue: CATALOGUE,
  crm: [...SEED_CRM],
  submissions: buildSeedSubmissions(),
  orders: seed.orders,
  activeOrderId: 1,
  toasts: [],
  nextIds: { patient: 2000, rx: seed.nextRx, order: 3, submission: 5, clinic: 5201, invoice: 4072 },
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

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'SET_SCREEN':
      return { ...state, screen: action.screen };

    // ---- Referrals ----
    case 'UPLOAD_RECORDS': {
      return {
        ...state,
        submissions: state.submissions.map(s =>
          s.id === action.subId ? { ...s, recordsUploaded: true, status: s.status === 'New' ? 'Records uploaded' as const : s.status } : s
        ),
      };
    }
    case 'LOG_CALL': {
      return {
        ...state,
        submissions: state.submissions.map(s =>
          s.id === action.subId ? { ...s, calls: [...s.calls, { ts: new Date() }] } : s
        ),
      };
    }
    case 'REFER_TO_CLINIC': {
      const clinicRef = 'CLN-' + state.nextIds.clinic;
      return {
        ...state,
        nextIds: { ...state.nextIds, clinic: state.nextIds.clinic + 1 },
        submissions: state.submissions.map(s =>
          s.id === action.subId && s.recordsUploaded ? { ...s, clinicRef, status: 'Referred to clinic' as const } : s
        ),
      };
    }
    case 'EMAIL_REFERRAL': {
      const sub = state.submissions.find(s => s.id === action.subId);
      if (!sub || !sub.clinicRef) return state;
      let crm = [...state.crm];
      let nextPatId = state.nextIds.patient;
      if (!crm.find(c => c.email === sub.email)) {
        crm.push({ id: 'P-' + nextPatId, name: sub.name, email: sub.email, mobile: sub.mobile, address: sub.postcode, status: 'Referred' });
        nextPatId++;
      }
      return {
        ...state,
        crm,
        nextIds: { ...state.nextIds, patient: nextPatId },
        submissions: state.submissions.map(s =>
          s.id === action.subId ? { ...s, emailedAt: new Date(), status: 'Completed' as const } : s
        ),
      };
    }

    // ---- Orders ----
    case 'NEW_ORDER': {
      const id = state.nextIds.order;
      const rxId = state.nextIds.rx;
      const newOrder = blankOrder(id, action.patientId || null);
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
    case 'SET_ORDER_PATIENT':
      return mapOrder(state, action.orderId, o => ({ ...o, patientId: action.patientId }));
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
    case 'SET_ITEM_FEE':
      return mapOrder(state, action.orderId, o => mapRx(o, action.rxId, r => ({
        ...r, items: r.items.map(i => i.productId === action.productId ? { ...i, fee: action.fee } : i),
      })));
    case 'REMOVE_RX':
      return mapOrder(state, action.orderId, o => ({
        ...o, prescriptions: o.prescriptions.filter(r => r.id !== action.rxId),
      }));
    case 'CLEAR_ORDER':
      return { ...state, orders: state.orders.filter(o => o.id !== action.orderId), activeOrderId: state.orders.length > 1 ? state.orders.find(o => o.id !== action.orderId)?.id ?? null : null };

    // ---- Payment ----
    case 'SEND_PAYMENT_LINK': {
      const order = findOrder(state, action.orderId);
      if (!order) return state;
      const amount = orderRevenue(order);
      return mapOrder(state, action.orderId, o => ({
        ...o,
        payment: { ...o.payment, status: 'sent', amount, ref: 'WP-' + Date.now().toString(36).toUpperCase(), sentAt: new Date() },
      }));
    }
    case 'CONFIRM_PAYMENT':
      return mapOrder(state, action.orderId, o => ({
        ...o,
        payment: { ...o.payment, status: 'paid' },
      }));

    // ---- Curaleaf submission simulation ----
    case 'PLACE_ORDER': {
      const invBase = state.nextIds.invoice;
      let invCounter = 0;
      return {
        ...mapOrder(state, action.orderId, o => ({
          ...o,
          prescriptions: o.prescriptions.map(r => {
            const inv = invBase + invCounter++;
            return {
              ...r,
              placed: true,
              poRef: 'PO-' + (88010 + action.orderId) + '-' + r.id,
              status: 'awaiting-approval' as const,
              invoiceRef: 'INV-' + inv,
              trackingNumber: null,
              carrier: 'DPD',
            };
          }),
        })),
        nextIds: { ...state.nextIds, invoice: invBase + invCounter },
      };
    }
    case 'ADVANCE_RX_STATUS': {
      const statusOrder: RxStatus[] = ['draft', 'awaiting-approval', 'approved', 'dispatched', 'ready'];
      const order = state.orders.find(o => o.id === action.orderId);
      const rx = order?.prescriptions.find(r => r.id === action.rxId);
      if (!rx) return state;
      const idx = statusOrder.indexOf(rx.status);
      if (idx < statusOrder.length - 1) {
        const nextStatus = statusOrder[idx + 1];
        const nextState = mapOrder(state, action.orderId, o => mapRx(o, action.rxId, r => ({
          ...r,
          status: nextStatus,
          trackingNumber: nextStatus === 'dispatched' ? 'DPD' + Math.random().toString(36).substring(2, 10).toUpperCase() : r.trackingNumber,
        })));

        let msg = '';
        const poRefStr = rx.poRef || `PO-${88010 + action.orderId}-${rx.id}`;
        if (nextStatus === 'approved') {
          msg = `Curaleaf approved prescription ${poRefStr}`;
        } else if (nextStatus === 'dispatched') {
          msg = `Curaleaf order ${poRefStr} dispatched via DPD`;
        } else if (nextStatus === 'ready') {
          msg = `Curaleaf order ${poRefStr} is ready for collection`;
        }

        if (msg) {
          const newToast = { id: Date.now().toString() + Math.random(), message: msg, type: 'info' as const };
          nextState.toasts = [...nextState.toasts, newToast];
        }
        return nextState;
      }
      return state;
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
  const scheduledRef = useRef<Set<number>>(new Set());

  // Automated Payment Clearance & Curaleaf Placement Simulator
  useEffect(() => {
    state.orders.forEach(order => {
      if (order.payment.status === 'sent' && !scheduledRef.current.has(order.id)) {
        scheduledRef.current.add(order.id);

        setTimeout(() => {
          dispatch({ type: 'CONFIRM_PAYMENT', orderId: order.id });
          dispatch({ type: 'PLACE_ORDER', orderId: order.id });

          const patientObj = state.crm.find(p => p.id === order.patientId);
          const patientNameStr = patientObj?.name ?? 'Marcus Vance';

          dispatch({
            type: 'ADD_TOAST',
            message: `Worldpay Webhook: Payment cleared automatically for ${patientNameStr} (£${order.payment.amount.toFixed(2)}). Order submitted directly to Curaleaf.`,
            toastType: 'success'
          });
        }, 7000); // auto-clear after 7 seconds
      }
    });
  }, [state.orders, state.crm]);

  // Simulated status advancement timer (for demo)
  useEffect(() => {
    const interval = setInterval(() => {
      state.orders.forEach(order => {
        if (order.payment.status === 'paid') {
          order.prescriptions.forEach(rx => {
            if (rx.placed && rx.status !== 'ready') {
              dispatch({ type: 'ADVANCE_RX_STATUS', orderId: order.id, rxId: rx.id });
            }
          });
        }
      });
    }, 15000); // advance every 15s for demo
    return () => clearInterval(interval);
  }, [state.orders]);

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
