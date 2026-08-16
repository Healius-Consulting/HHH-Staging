import type { SetupTaskId } from '../shared/contracts';

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
    owner: 'pharmacy',
    title: 'Confirm pharmacy profile',
    description: 'Check the registered premises, GPhC number, superintendent and collection address.',
    evidenceLabel: 'Confirmation note',
    placeholder: 'e.g. Premises and superintendent details checked',
  },
  {
    id: 'curaleaf_account',
    owner: 'hhh_admin',
    title: 'Await Curaleaf activation',
    description: 'HHH submits the Curaleaf onboarding form. When Curaleaf returns the portal email and customer ID, an HHH administrator connects them securely.',
    evidenceLabel: 'Activation state',
    placeholder: '',
  },
  {
    id: 'payment_route',
    owner: 'pharmacy',
    title: 'Choose a payment route',
    description: 'Worldpay is optional, but every pharmacy must choose how patient payment will be confirmed.',
    evidenceLabel: 'Payment routes',
    placeholder: '',
  },
  {
    id: 'pricing',
    owner: 'pharmacy',
    title: 'Confirm charges',
    description: 'Acknowledge Curaleaf-supplied patient prices and agree the optional dispensing-charge policy for pharmacy collection orders.',
    evidenceLabel: 'Charge policy confirmation',
    placeholder: 'e.g. Curaleaf pricing acknowledged; dispensing-charge policy approved',
  },
  {
    id: 'notifications',
    owner: 'pharmacy',
    title: 'Confirm patient communications',
    description: 'Set the sender contact and approve the wording used when medication is ready for collection.',
    evidenceLabel: 'Sender name or contact',
    placeholder: 'e.g. HHH Leeds Patient Services',
  },
  {
    id: 'operational_readiness',
    owner: 'pharmacy',
    title: 'Complete the operational walkthrough',
    description: 'Confirm staff have rehearsed referral, prescription, payment, supplier order, goods-in and collection without real patient data.',
    evidenceLabel: 'Readiness note',
    placeholder: 'e.g. Sandbox walkthrough completed by pharmacy manager',
  },
];
