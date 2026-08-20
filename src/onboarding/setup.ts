import type { PharmacyOperationalStatus, SetupTaskId } from '../shared/contracts';

export interface SetupTaskDefinition {
  id: SetupTaskId;
  owner: 'pharmacy' | 'hhh_admin';
  title: string;
  description: string;
  evidenceLabel: string;
  placeholder: string;
}

export const SETUP_TASKS: SetupTaskDefinition[] = [
  {
    id: 'pharmacy_profile',
    owner: 'hhh_admin',
    title: 'Confirm premises',
    description: 'Check the GPhC number, superintendent and registered address on the live HHH profile during the sandbox call.',
    evidenceLabel: 'Premises confirmation',
    placeholder: '',
  },
  {
    id: 'curaleaf_account',
    owner: 'hhh_admin',
    title: 'Curaleaf connection',
    description: 'HHH stores the customer ID and API key. The pharmacy never types these.',
    evidenceLabel: 'Connection state',
    placeholder: '',
  },
  {
    id: 'payment_route',
    owner: 'hhh_admin',
    title: 'Payment route',
    description: 'Pharmacy-managed is the default. Explain Worldpay on the sandbox call. The pharmacy connects the merchant in Settings when ready.',
    evidenceLabel: 'Payment route',
    placeholder: '',
  },
  {
    id: 'pricing',
    owner: 'hhh_admin',
    title: 'Charges policy',
    description: 'Explain that Curaleaf sets patient prices. Note whether this pharmacy will add a dispensing fee.',
    evidenceLabel: 'Charge policy',
    placeholder: '',
  },
  {
    id: 'notifications',
    owner: 'hhh_admin',
    title: 'Eligibility pack',
    description: 'Show the intake link, QR and content pack. The pharmacy publishes a link-out, not an iframe.',
    evidenceLabel: 'Published confirmation',
    placeholder: '',
  },
  {
    id: 'operational_readiness',
    owner: 'hhh_admin',
    title: 'Sandbox call',
    description: 'Walk through referral, prescription rails, payment-before-PO, goods-in and collection on placeholder data.',
    evidenceLabel: 'Sandbox call record',
    placeholder: '',
  },
];

export const WALKTHROUGH_STEPS = [
  {
    id: 'training-patient',
    title: 'Open the training patient',
    detail: 'Use the sandbox patient in Patients. Do not open a live enquiry.',
  },
  {
    id: 'create-order',
    title: 'Create an order and attach a prescription',
    detail: 'Use a clinic barcode or a manual signed copy.',
  },
  {
    id: 'pack-payment',
    title: 'Add a pack and confirm pharmacy-managed payment',
    detail: 'Optional dispensing fee is allowed. Nothing is sent to Curaleaf until payment is PAID.',
  },
  {
    id: 'waiter-rail',
    title: 'See the Curaleaf waiter versus purchase-order rail',
    detail: 'Training catalogue only. Do not send a live purchase order.',
  },
  {
    id: 'goods-in',
    title: 'Record goods-in',
    detail: 'Pharmacy authority. Curaleaf has no delivered status.',
  },
  {
    id: 'collection',
    title: 'Mark ready for collection, then collected',
    detail: 'Ready-for-collection is goods-in, not courier tracking.',
  },
] as const;

export const DISPENSING_FEE_OPTIONS = [
  { id: 'none', label: 'No dispensing fee', evidence: 'none' },
  { id: '5', label: '£5', evidence: '5' },
  { id: '10', label: '£10', evidence: '10' },
  { id: '15', label: '£15', evidence: '15' },
] as const;

export interface OperationalStatusRow {
  id: keyof Pick<PharmacyOperationalStatus, 'intake' | 'workspace' | 'staff' | 'curaleaf' | 'payment' | 'walkthrough' | 'charges'>;
  title: string;
  detail: string;
  value: string;
  passed: boolean;
}

export function emptyOperationalStatus(): PharmacyOperationalStatus {
  return {
    intake: { live: true, label: 'Live' },
    workspace: { mode: 'training', label: 'Training' },
    staff: { activeCount: 0, invitedCount: 0, passed: false, label: 'No active staff' },
    curaleaf: { connected: false, label: 'Waiting' },
    payment: { route: 'manual', worldpayConnected: false, passed: false, label: 'Pharmacy-managed' },
    walkthrough: { completed: false, label: 'Not started', evidence: null },
    charges: { saved: false, label: 'Missing', evidence: null },
    premises: { confirmed: false },
    websitePack: { published: false },
    goLiveReady: false,
    missingGates: ['premises', 'staff', 'curaleaf', 'payment', 'charges', 'walkthrough'],
  };
}

export function deriveOperationalStatus(input: {
  workspaceMode: 'training' | 'live' | 'paused';
  paused?: boolean;
  staffCount: number;
  defaultPaymentRoute: 'manual' | 'worldpay';
  worldpayConnected: boolean;
  curaleafConnected: boolean;
  tasks: Array<{ id: SetupTaskId; completed: boolean; evidence: string | null }>;
}): PharmacyOperationalStatus {
  const byId = new Map(input.tasks.map(task => [task.id, task]));
  const premises = byId.get('pharmacy_profile')?.completed === true;
  const walkthrough = byId.get('operational_readiness')?.completed === true;
  const charges = byId.get('pricing')?.completed === true;
  const websitePack = byId.get('notifications')?.completed === true;
  const route = input.defaultPaymentRoute === 'worldpay' ? 'worldpay' as const : 'manual' as const;
  const paymentPassed = route === 'manual' || input.worldpayConnected;
  const workspaceMode = input.paused ? 'paused' : input.workspaceMode;
  const intakeLive = !input.paused;
  const missingGates: string[] = [];
  if (!premises) missingGates.push('premises');
  if (input.staffCount < 1) missingGates.push('staff');
  if (!input.curaleafConnected) missingGates.push('curaleaf');
  if (!paymentPassed) missingGates.push('payment');
  if (!charges) missingGates.push('charges');
  if (!walkthrough) missingGates.push('walkthrough');
  if (workspaceMode === 'paused') missingGates.push('paused');

  return {
    intake: { live: intakeLive, label: intakeLive ? 'Live' : 'Off' },
    workspace: {
      mode: workspaceMode,
      label: workspaceMode === 'live' ? 'Live' : workspaceMode === 'paused' ? 'Paused' : 'Training',
    },
    staff: {
      activeCount: input.staffCount,
      invitedCount: 0,
      passed: input.staffCount >= 2,
      label: input.staffCount === 0 ? 'No active staff' : `${input.staffCount} active`,
    },
    curaleaf: { connected: input.curaleafConnected, label: input.curaleafConnected ? 'Connected' : 'Waiting' },
    payment: {
      route,
      worldpayConnected: input.worldpayConnected,
      passed: paymentPassed,
      label: route === 'worldpay'
        ? (input.worldpayConnected ? 'Worldpay connected' : 'Worldpay not connected')
        : 'Pharmacy-managed',
    },
    walkthrough: {
      completed: walkthrough,
      label: walkthrough ? 'Complete' : 'Not started',
      evidence: byId.get('operational_readiness')?.evidence ?? null,
    },
    charges: {
      saved: charges,
      label: charges ? 'Saved' : 'Missing',
      evidence: byId.get('pricing')?.evidence ?? null,
    },
    premises: { confirmed: premises },
    websitePack: { published: websitePack },
    goLiveReady: missingGates.length === 0,
    missingGates,
  };
}

export function operationalStatusRows(status: PharmacyOperationalStatus): OperationalStatusRow[] {
  return [
    { id: 'intake', title: 'Intake link', detail: 'Eligibility token for HHH review. This checklist does not turn intake off.', value: status.intake.label, passed: status.intake.live },
    { id: 'workspace', title: 'Workspace', detail: 'Pharmacy CRM stays in training until HHH flips LIVE.', value: status.workspace.label, passed: status.workspace.mode === 'live' },
    { id: 'staff', title: 'Staff', detail: 'Owner plus additional active accounts.', value: status.staff.label, passed: status.staff.passed },
    { id: 'curaleaf', title: 'Curaleaf', detail: 'HHH stores the customer ID and API key server-side.', value: status.curaleaf.label, passed: status.curaleaf.connected },
    { id: 'payment', title: 'Payment', detail: 'Pharmacy-managed is the default until a merchant is connected.', value: status.payment.label, passed: status.payment.passed },
    { id: 'walkthrough', title: 'Sandbox call', detail: 'HHH walks the pharmacy through the platform on placeholder data.', value: status.walkthrough.label, passed: status.walkthrough.completed },
    { id: 'charges', title: 'Charges policy', detail: 'Curaleaf patient prices plus optional dispensing fee.', value: status.charges.label, passed: status.charges.saved },
  ];
}

export const ADMIN_SANDBOX_TASK_IDS: SetupTaskId[] = ['pharmacy_profile', 'pricing', 'notifications', 'operational_readiness'];

export function adminSandboxEvidence(
  taskId: SetupTaskId,
  organisation: { gphcNumber: string; superintendent: string; address: string; defaultPaymentRoute: 'manual' | 'worldpay' },
): string {
  if (taskId === 'pharmacy_profile') return `Confirmed GPhC ${organisation.gphcNumber}; SP ${organisation.superintendent}; ${organisation.address}`;
  if (taskId === 'payment_route') return organisation.defaultPaymentRoute === 'worldpay' ? 'worldpay-enabled' : 'pharmacy-managed';
  if (taskId === 'pricing') return 'Acknowledged Curaleaf patient prices; dispensing fee none';
  if (taskId === 'notifications') return 'Content pack published';
  if (taskId === 'operational_readiness') return 'HHH sandbox call completed. Platform walkthrough and Worldpay explained.';
  return 'Recorded by HHH';
}

export function remainingPharmacyTaskIds(operational: PharmacyOperationalStatus, tasks: Array<{ id: SetupTaskId; completed: boolean }>): SetupTaskId[] {
  return ADMIN_SANDBOX_TASK_IDS.filter(id => {
    if (id === 'pharmacy_profile') return !operational.premises.confirmed;
    if (id === 'pricing') return !operational.charges.saved;
    if (id === 'notifications') return !operational.websitePack.published;
    if (id === 'operational_readiness') return !operational.walkthrough.completed;
    return !tasks.find(task => task.id === id)?.completed;
  });
}

export function activationProgressLabel(input: {
  liveWorkspace: boolean;
  operational: PharmacyOperationalStatus;
  tasks: Array<{ id: SetupTaskId; completed: boolean }>;
}): string {
  if (input.liveWorkspace) {
    const remaining = remainingPharmacyTaskIds(input.operational, input.tasks).length;
    if (remaining === 0) return 'Records complete';
    return remaining === 1 ? '1 remaining' : `${remaining} remaining`;
  }
  const pharmacyTasks = SETUP_TASKS.filter(task => task.owner === 'pharmacy');
  const done = pharmacyTasks.filter(task => input.tasks.find(item => item.id === task.id)?.completed).length;
  return `${done} of ${pharmacyTasks.length} actions`;
}

export function previewOperationalStatus(completeCount: number): PharmacyOperationalStatus {
  const operational = emptyOperationalStatus();
  operational.intake = { live: true, label: 'Live' };
  operational.workspace = completeCount >= 6 ? { mode: 'live', label: 'Live' } : { mode: 'training', label: 'Training' };
  operational.staff = completeCount >= 1
    ? { activeCount: 2, invitedCount: 0, passed: true, label: '2 active' }
    : operational.staff;
  operational.premises = { confirmed: completeCount >= 1 };
  operational.curaleaf = completeCount >= 2
    ? { connected: true, label: 'Connected' }
    : operational.curaleaf;
  operational.payment = completeCount >= 3
    ? { route: 'manual', worldpayConnected: false, passed: true, label: 'Pharmacy-managed' }
    : operational.payment;
  operational.charges = completeCount >= 4
    ? { saved: true, label: 'Saved', evidence: 'Acknowledged; dispensing fee none' }
    : operational.charges;
  operational.websitePack = { published: completeCount >= 5 };
  operational.walkthrough = completeCount >= 6
    ? { completed: true, label: 'Complete', evidence: 'Walkthrough completed. Staff: Preview RP' }
    : operational.walkthrough;
  operational.goLiveReady = completeCount >= 6;
  operational.missingGates = operational.goLiveReady ? [] : emptyOperationalStatus().missingGates.slice(completeCount);
  return operational;
}
