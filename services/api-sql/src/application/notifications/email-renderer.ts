import type { EmailTemplateCode } from './message-kinds.js';
import { brandedEmail, escapeHtml, safeHttpUrl } from './email-layout.js';

type RenderedEmail = {
  subject: string;
  text: string;
  html: string;
};

function money(amountPence: unknown, currency = 'GBP') {
  const amount = Number(amountPence ?? 0) / 100;
  if (!Number.isFinite(amount)) return '';
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(amount);
}

function value(payload: unknown, key: string) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return '';
  const found = (payload as Record<string, unknown>)[key];
  return found == null ? '' : String(found);
}

function paymentReceiptUrl(receiptHash: string) {
  return `https://holistichealthhub.cc/receipt/${encodeURIComponent(receiptHash)}`;
}

function render(input: {
  subject: string;
  preheader: string;
  title: string;
  text: string;
  paragraphs: string[];
  cta?: { label: string; href: string };
  details?: Array<{ label: string; value: string }>;
  footerNote?: string;
}): RenderedEmail {
  return {
    subject: input.subject,
    text: input.text,
    html: brandedEmail({
      preheader: input.preheader,
      title: input.title,
      paragraphs: input.paragraphs,
      cta: input.cta,
      details: input.details,
      footerNote: input.footerNote,
    }),
  };
}

export function renderEmailTemplate(kind: EmailTemplateCode, payload: unknown): RenderedEmail {
  const firstName = escapeHtml(value(payload, 'firstName') || value(payload, 'patientFirstName') || 'there');
  const pharmacyName = escapeHtml(value(payload, 'pharmacyName') || 'the pharmacy');
  const orderNumber = escapeHtml(value(payload, 'orderNumber'));
  const amount = money(value(payload, 'amountPence') || 0, value(payload, 'currency') || 'GBP');
  const paymentUrl = safeHttpUrl(value(payload, 'paymentUrl'));
  const receiptHash = value(payload, 'receiptHash');
  const actionLink = safeHttpUrl(value(payload, 'actionLink'));
  const caseReference = escapeHtml(value(payload, 'caseReference'));
  const summary = escapeHtml(value(payload, 'summary'));
  const pharmacyDetails = [
    { label: 'Pharmacy', value: value(payload, 'pharmacyName') },
    { label: 'Phone', value: value(payload, 'pharmacyPhone') },
    { label: 'Email', value: value(payload, 'pharmacyEmail') },
    { label: 'Address', value: value(payload, 'pharmacyAddress') },
  ];

  switch (kind) {
    case 'patient_payment_request':
      return render({
        subject: 'Payment needed for your order',
        preheader: 'Complete payment securely so your pharmacy can continue the order.',
        title: 'Payment awaiting',
        text: `Hi ${value(payload, 'firstName') || 'there'},\n\nPlease complete your payment${amount ? ` of ${amount}` : ''} using this secure link:\n${paymentUrl}\n`,
        paragraphs: [
          `Hi ${firstName},`,
          `Please complete your payment${amount ? ` of <strong>${escapeHtml(amount)}</strong>` : ''}${orderNumber ? ` for order <strong>${orderNumber}</strong>` : ''} so the pharmacy can continue processing it.`,
        ],
        cta: paymentUrl ? { label: 'Pay now', href: paymentUrl } : undefined,
        details: pharmacyDetails,
        footerNote: 'This is a secure payment link. If you were not expecting this email, you can ignore it.',
      });
    case 'patient_payment_confirmation':
      return render({
        subject: 'Payment received',
        preheader: 'Your payment has been confirmed.',
        title: 'Payment confirmed',
        text: `Hi ${value(payload, 'firstName') || 'there'},\n\nWe have received your payment${amount ? ` of ${amount}` : ''}${orderNumber ? ` for order ${value(payload, 'orderNumber')}` : ''}.\n${receiptHash ? `Receipt: ${paymentReceiptUrl(receiptHash)}\n` : ''}`,
        paragraphs: [
          `Hi ${firstName},`,
          `We have received your payment${amount ? ` of <strong>${escapeHtml(amount)}</strong>` : ''}${orderNumber ? ` for order <strong>${orderNumber}</strong>` : ''}. The pharmacy will continue processing it.`,
        ],
        cta: receiptHash ? { label: 'View receipt', href: paymentReceiptUrl(receiptHash) } : undefined,
        details: pharmacyDetails,
      });
    case 'patient_refunded':
      return render({
        subject: 'Your payment has been refunded',
        preheader: 'A refund has been completed for your order.',
        title: 'Payment refunded',
        text: `Hi ${value(payload, 'firstName') || 'there'},\n\nA refund${amount ? ` of ${amount}` : ''} has been completed${orderNumber ? ` for order ${value(payload, 'orderNumber')}` : ''}. It can take a few working days to appear on the original payment method.\n`,
        paragraphs: [
          `Hi ${firstName},`,
          `A refund${amount ? ` of <strong>${escapeHtml(amount)}</strong>` : ''} has been completed${orderNumber ? ` for order <strong>${orderNumber}</strong>` : ''}. It can take a few working days to appear on the original payment method.`,
        ],
        details: pharmacyDetails,
      });
    case 'patient_ready_for_collection':
      return render({
        subject: 'Your prescription is ready to collect',
        preheader: 'Your order is ready at the pharmacy.',
        title: 'Prescription ready',
        text: `Hi ${value(payload, 'firstName') || 'there'},\n\nYour order${orderNumber ? ` ${value(payload, 'orderNumber')}` : ''} is ready to collect from ${value(payload, 'pharmacyName') || 'the pharmacy'}.\n`,
        paragraphs: [
          `Hi ${firstName},`,
          `Your prescription${orderNumber ? ` for order <strong>${orderNumber}</strong>` : ''} is ready to collect from <strong>${pharmacyName}</strong>. Please bring photo ID.`,
        ],
        details: pharmacyDetails,
      });
    case 'admin_new_enquiry_received':
      return render({
        subject: 'New enquiry received',
        preheader: 'A new eligibility enquiry is waiting.',
        title: 'New enquiry received',
        text: `A new enquiry has been received${value(payload, 'caseReference') ? ` (${value(payload, 'caseReference')})` : ''}.`,
        paragraphs: [`A new enquiry has been received${caseReference ? ` (<strong>${caseReference}</strong>)` : ''}.`],
      });
    case 'pharmacy_staff_invite':
      return render({
        subject: 'Set up your Holistic Health Hub account',
        preheader: 'You have been invited to the staff portal.',
        title: 'Sign up',
        text: `You have been invited to access the Holistic Health Hub portal for ${value(payload, 'pharmacyName') || 'your pharmacy'}.\n\nSet your password:\n${actionLink}\n`,
        paragraphs: [
          `You have been invited to the Holistic Health Hub staff portal${value(payload, 'pharmacyName') ? ` for <strong>${pharmacyName}</strong>` : ''}.`,
          'Use the button below to set your password, then sign in and set up two-factor authentication.',
        ],
        cta: actionLink ? { label: 'Set your password', href: actionLink } : undefined,
        footerNote: 'If you were not expecting this invitation, you can ignore this email.',
      });
    case 'pharmacy_password_reset':
      return render({
        subject: 'Reset your Holistic Health Hub password',
        preheader: 'Use this link to choose a new password.',
        title: 'Reset password',
        text: `Use this link to reset your Holistic Health Hub password:\n${actionLink}\n`,
        paragraphs: ['Use the button below to choose a new password for the Holistic Health Hub staff portal.'],
        cta: actionLink ? { label: 'Reset password', href: actionLink } : undefined,
        footerNote: 'If you did not request this, you can ignore this email. The link expires after a short time.',
      });
    case 'pharmacy_2fa_enabled':
      return render({
        subject: 'Authenticator app added to your account',
        preheader: 'Two-factor authentication is now switched on.',
        title: '2FA set up',
        text: 'An authenticator app has been added to your Holistic Health Hub staff account. Sign-in now needs your password and a six-digit code.\n',
        paragraphs: [
          'An authenticator app has been added to your Holistic Health Hub staff account.',
          'Sign-in now needs your password and a six-digit code from that app.',
        ],
        footerNote: 'If you did not do this, contact an HHH administrator immediately.',
      });
    case 'pharmacy_2fa_disabled':
      return render({
        subject: 'Authenticator app removed from your account',
        preheader: 'Two-factor authentication has been turned off.',
        title: '2FA turned off',
        text: 'The authenticator app on your Holistic Health Hub staff account has been removed. You will be asked to set it up again the next time you sign in.\n',
        paragraphs: [
          'The authenticator app on your Holistic Health Hub staff account has been removed.',
          'You will be asked to set it up again the next time you sign in.',
        ],
        footerNote: 'If you did not expect this, contact an HHH administrator immediately.',
      });
    case 'pharmacy_new_patient_referred':
      return render({
        subject: 'New patient referred to your pharmacy',
        preheader: 'A new referral is waiting in the portal.',
        title: 'New patient referred',
        text: `A new patient has been referred to ${value(payload, 'pharmacyName') || 'your pharmacy'}${value(payload, 'caseReference') ? ` (${value(payload, 'caseReference')})` : ''}.`,
        paragraphs: [`A new patient has been referred to <strong>${pharmacyName}</strong>${caseReference ? ` (<strong>${caseReference}</strong>)` : ''}.`],
      });
    case 'pharmacy_payment_received':
      return render({
        subject: 'Payment received',
        preheader: 'A patient payment has been recorded.',
        title: 'Payment received',
        text: `Payment received${amount ? `: ${amount}` : ''}${orderNumber ? ` for order ${value(payload, 'orderNumber')}` : ''}.`,
        paragraphs: [`Payment received${amount ? `: <strong>${escapeHtml(amount)}</strong>` : ''}${orderNumber ? ` for order <strong>${orderNumber}</strong>` : ''}.`],
      });
    case 'pharmacy_order_accepted':
      return render({
        subject: 'Order accepted',
        preheader: 'An order is now with Curaleaf.',
        title: 'Order accepted',
        text: `An order has been accepted${orderNumber ? `: ${value(payload, 'orderNumber')}` : ''}.`,
        paragraphs: [`An order has been accepted${orderNumber ? `: <strong>${orderNumber}</strong>` : ''}.`],
      });
    case 'pharmacy_order_cancelled':
      return render({
        subject: 'Order cancelled',
        preheader: 'An order needs refund or replacement action.',
        title: 'Order cancelled',
        text: `An order has been cancelled${orderNumber ? `: ${value(payload, 'orderNumber')}` : ''}.${value(payload, 'summary') ? `\n\n${value(payload, 'summary')}` : ''}`,
        paragraphs: [
          `An order has been cancelled${orderNumber ? `: <strong>${orderNumber}</strong>` : ''}.`,
          ...(summary ? [summary] : []),
        ],
      });
    case 'pharmacy_delivery_issue':
      return render({
        subject: 'Delivery issue requires attention',
        preheader: 'A fulfilment delay needs pharmacy awareness.',
        title: 'Delivery issue',
        text: `A delivery issue requires attention${orderNumber ? ` for order ${value(payload, 'orderNumber')}` : ''}.${value(payload, 'summary') ? `\n\n${value(payload, 'summary')}` : ''}`,
        paragraphs: [
          `A delivery issue requires attention${orderNumber ? ` for order <strong>${orderNumber}</strong>` : ''}.`,
          ...(summary ? [summary] : []),
        ],
      });
    case 'pharmacy_order_dispatched':
      return render({
        subject: 'Order dispatched update',
        preheader: 'A supplier consignment is on the way.',
        title: 'Order dispatched',
        text: `${value(payload, 'summary') || 'An order has been dispatched.'}${orderNumber ? `\nOrder: ${value(payload, 'orderNumber')}` : ''}`,
        paragraphs: [
          summary || 'An order has been dispatched.',
          ...(orderNumber ? [`Order: <strong>${orderNumber}</strong>`] : []),
        ],
      });
    case 'pharmacy_prescription_close_to_expiry':
      return render({
        subject: 'Prescription close to expiry',
        preheader: 'A prescription is approaching its 28-day limit.',
        title: 'Prescription close to expiry',
        text: `A prescription is close to expiry${orderNumber ? ` for order ${value(payload, 'orderNumber')}` : ''}.${value(payload, 'summary') ? `\n\n${value(payload, 'summary')}` : ''}`,
        paragraphs: [
          `A prescription is close to expiry${orderNumber ? ` for order <strong>${orderNumber}</strong>` : ''}.`,
          ...(summary ? [summary] : []),
        ],
      });
    case 'pharmacy_collection_completed':
      return render({
        subject: 'Collection completed update',
        preheader: 'A collection has been recorded.',
        title: 'Collection completed',
        text: `${value(payload, 'summary') || 'Collection has been completed.'}${orderNumber ? `\nOrder: ${value(payload, 'orderNumber')}` : ''}`,
        paragraphs: [
          summary || 'Collection has been completed.',
          ...(orderNumber ? [`Order: <strong>${orderNumber}</strong>`] : []),
        ],
      });
  }
}
