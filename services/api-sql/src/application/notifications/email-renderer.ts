import type { EmailTemplateCode } from './message-kinds.js';

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

export function renderEmailTemplate(kind: EmailTemplateCode, payload: unknown): RenderedEmail {
  const firstName = value(payload, 'firstName') || value(payload, 'patientFirstName') || 'there';
  const pharmacyName = value(payload, 'pharmacyName') || 'the pharmacy';
  const orderNumber = value(payload, 'orderNumber');
  const amount = money(value(payload, 'amountPence') || 0, value(payload, 'currency') || 'GBP');
  const paymentUrl = value(payload, 'paymentUrl');
  const receiptHash = value(payload, 'receiptHash');
  const actionLink = value(payload, 'actionLink');
  const caseReference = value(payload, 'caseReference');
  const summary = value(payload, 'summary');

  switch (kind) {
    case 'patient_payment_request':
      return {
        subject: 'Payment needed for your HHH order',
        text: `Hi ${firstName},\n\nPlease complete your payment${amount ? ` of ${amount}` : ''} using this secure link:\n${paymentUrl}\n`,
        html: `<p>Hi ${firstName},</p><p>Please complete your payment${amount ? ` of <strong>${amount}</strong>` : ''} using this secure link:</p><p><a href="${paymentUrl}">Pay now</a></p>`,
      };
    case 'patient_payment_confirmation':
      return {
        subject: 'Payment received',
        text: `Hi ${firstName},\n\nWe have received your payment${amount ? ` of ${amount}` : ''}${orderNumber ? ` for order ${orderNumber}` : ''}.\n${receiptHash ? `Receipt: ${paymentReceiptUrl(receiptHash)}\n` : ''}`,
        html: `<p>Hi ${firstName},</p><p>We have received your payment${amount ? ` of <strong>${amount}</strong>` : ''}${orderNumber ? ` for order <strong>${orderNumber}</strong>` : ''}.</p>${receiptHash ? `<p><a href="${paymentReceiptUrl(receiptHash)}">View receipt</a></p>` : ''}`,
      };
    case 'patient_ready_for_collection':
      return {
        subject: 'Your order is ready to collect',
        text: `Hi ${firstName},\n\nYour order${orderNumber ? ` ${orderNumber}` : ''} is ready to collect from ${pharmacyName}.`,
        html: `<p>Hi ${firstName},</p><p>Your order${orderNumber ? ` <strong>${orderNumber}</strong>` : ''} is ready to collect from <strong>${pharmacyName}</strong>.</p>`,
      };
    case 'admin_new_enquiry_received':
      return {
        subject: 'New enquiry received',
        text: `A new enquiry has been received${caseReference ? ` (${caseReference})` : ''}.`,
        html: `<p>A new enquiry has been received${caseReference ? ` (<strong>${caseReference}</strong>)` : ''}.</p>`,
      };
    case 'pharmacy_staff_invite':
      return {
        subject: 'You have been invited to the HHH pharmacy portal',
        text: `You have been invited to access the HHH pharmacy portal for ${pharmacyName}.\n\nSet your password:\n${actionLink}\n`,
        html: `<p>You have been invited to access the HHH pharmacy portal for <strong>${pharmacyName}</strong>.</p><p><a href="${actionLink}">Set your password</a></p>`,
      };
    case 'pharmacy_password_reset':
      return {
        subject: 'Reset your HHH pharmacy portal password',
        text: `Use this link to reset your HHH pharmacy portal password:\n${actionLink}\n`,
        html: `<p>Use this link to reset your HHH pharmacy portal password:</p><p><a href="${actionLink}">Reset password</a></p>`,
      };
    case 'pharmacy_new_patient_referred':
      return {
        subject: 'New patient referred to your pharmacy',
        text: `A new patient has been referred to ${pharmacyName}${caseReference ? ` (${caseReference})` : ''}.`,
        html: `<p>A new patient has been referred to <strong>${pharmacyName}</strong>${caseReference ? ` (<strong>${caseReference}</strong>)` : ''}.</p>`,
      };
    case 'pharmacy_payment_received':
      return {
        subject: 'Payment received',
        text: `Payment received${amount ? `: ${amount}` : ''}${orderNumber ? ` for order ${orderNumber}` : ''}.`,
        html: `<p>Payment received${amount ? `: <strong>${amount}</strong>` : ''}${orderNumber ? ` for order <strong>${orderNumber}</strong>` : ''}.</p>`,
      };
    case 'pharmacy_order_accepted':
      return {
        subject: 'Order accepted',
        text: `An order has been accepted${orderNumber ? `: ${orderNumber}` : ''}.`,
        html: `<p>An order has been accepted${orderNumber ? `: <strong>${orderNumber}</strong>` : ''}.</p>`,
      };
    case 'pharmacy_order_cancelled':
      return {
        subject: 'Order cancelled',
        text: `An order has been cancelled${orderNumber ? `: ${orderNumber}` : ''}.${summary ? `\n\n${summary}` : ''}`,
        html: `<p>An order has been cancelled${orderNumber ? `: <strong>${orderNumber}</strong>` : ''}.</p>${summary ? `<p>${summary}</p>` : ''}`,
      };
    case 'pharmacy_delivery_issue':
      return {
        subject: 'Delivery issue requires attention',
        text: `A delivery issue requires attention${orderNumber ? ` for order ${orderNumber}` : ''}.${summary ? `\n\n${summary}` : ''}`,
        html: `<p>A delivery issue requires attention${orderNumber ? ` for order <strong>${orderNumber}</strong>` : ''}.</p>${summary ? `<p>${summary}</p>` : ''}`,
      };
    case 'pharmacy_order_dispatched':
      return {
        subject: 'Order dispatched update',
        text: `${summary || 'An order has been dispatched.'}${orderNumber ? `\nOrder: ${orderNumber}` : ''}`,
        html: `<p>${summary || 'An order has been dispatched.'}</p>${orderNumber ? `<p>Order: <strong>${orderNumber}</strong></p>` : ''}`,
      };
    case 'pharmacy_prescription_close_to_expiry':
      return {
        subject: 'Prescription close to expiry',
        text: `A prescription is close to expiry${orderNumber ? ` for order ${orderNumber}` : ''}.${summary ? `\n\n${summary}` : ''}`,
        html: `<p>A prescription is close to expiry${orderNumber ? ` for order <strong>${orderNumber}</strong>` : ''}.</p>${summary ? `<p>${summary}</p>` : ''}`,
      };
    case 'pharmacy_collection_completed':
      return {
        subject: 'Collection completed update',
        text: `${summary || 'Collection has been completed.'}${orderNumber ? `\nOrder: ${orderNumber}` : ''}`,
        html: `<p>${summary || 'Collection has been completed.'}</p>${orderNumber ? `<p>Order: <strong>${orderNumber}</strong></p>` : ''}`,
      };
  }
}
