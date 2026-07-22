import type { SetupTaskId } from '../shared/contracts';

export interface SetupTaskDefinition {
  id: SetupTaskId;
  title: string;
  description: string;
  evidenceLabel: string;
  placeholder: string;
}

export const SETUP_TASKS: SetupTaskDefinition[] = [
  {
    id: 'pharmacy_profile',
    title: 'Confirm pharmacy profile',
    description: 'Check the registered premises, GPhC number, superintendent and collection address.',
    evidenceLabel: 'Confirmation note',
    placeholder: 'e.g. Premises and superintendent details checked',
  },
  {
    id: 'curaleaf_account',
    title: 'Await Curaleaf activation',
    description: 'HHH submits the Curaleaf onboarding form. When Curaleaf returns the portal email and customer ID, an HHH administrator connects them securely.',
    evidenceLabel: 'Activation state',
    placeholder: '',
  },
  {
    id: 'payment_route',
    title: 'Choose a payment route',
    description: 'Worldpay is optional, but every pharmacy must choose how patient payment will be confirmed.',
    evidenceLabel: 'Payment routes',
    placeholder: '',
  },
  {
    id: 'pricing',
    title: 'Confirm charges',
    description: 'Review medicine prices and the optional dispensing charge used for pharmacy collection orders.',
    evidenceLabel: 'Pricing confirmation',
    placeholder: 'e.g. Formulary prices and dispensing charge approved',
  },
  {
    id: 'notifications',
    title: 'Confirm patient communications',
    description: 'Set the sender contact and approve the wording used when medication is ready for collection.',
    evidenceLabel: 'Sender name or contact',
    placeholder: 'e.g. HHH Leeds Patient Services',
  },
  {
    id: 'operational_readiness',
    title: 'Complete the operational walkthrough',
    description: 'Confirm staff have rehearsed referral, prescription, payment, supplier order, goods-in and collection without real patient data.',
    evidenceLabel: 'Readiness note',
    placeholder: 'e.g. Sandbox walkthrough completed by pharmacy manager',
  },
];
