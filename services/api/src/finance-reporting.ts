import type { DocumentData } from 'firebase-admin/firestore';
import { firestore } from './firebase.js';

export type FinanceDateRange = {
  from?: string;
  to?: string;
};

function inRange(value: unknown, range: FinanceDateRange) {
  const date = String(value ?? '').slice(0, 10);
  if (!date) return false;
  return (!range.from || date >= range.from) && (!range.to || date <= range.to);
}

function moneyPence(value: unknown) {
  const price = String(value ?? '').trim();
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(price);
  if (!match) return null;
  const pence = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return Number.isSafeInteger(pence) ? pence : null;
}

function wholesaleByPack(order: DocumentData) {
  const pricingQuote = order.pricingQuote && typeof order.pricingQuote === 'object'
    ? order.pricingQuote as Record<string, unknown>
    : null;
  const curaleaf = order.curaleaf && typeof order.curaleaf === 'object'
    ? order.curaleaf as Record<string, unknown>
    : null;
  const submissionQuote = curaleaf?.quote && typeof curaleaf.quote === 'object'
    ? curaleaf.quote as Record<string, unknown>
    : null;
  const quote = pricingQuote ?? submissionQuote;
  const items = Array.isArray(quote?.items) ? quote.items : [];
  const prices = new Map<string, number>();
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    const packId = typeof item.packId === 'string' ? item.packId : typeof item.productId === 'string' ? item.productId : null;
    const price = moneyPence(item.wholesalePackPrice);
    if (packId && price !== null) prices.set(packId, price);
  }
  return {
    prices,
    shippingPence: moneyPence(quote?.shippingPrice) ?? 0,
  };
}

function pharmacyFinanceRow(order: DocumentData) {
  const lineItems = Array.isArray(order.lineItems) ? order.lineItems as Array<Record<string, unknown>> : [];
  const quote = wholesaleByPack(order);
  let productRevenuePence = 0;
  let wholesaleProductPence = 0;
  let wholesaleComplete = lineItems.length > 0;
  const lines = lineItems.map(item => {
    const quantity = Number(item.quantity);
    const unitPricePence = Number(item.unitPricePence);
    const packId = String(item.packId ?? item.productId ?? '');
    const wholesaleUnitPence = quote.prices.get(packId) ?? null;
    const safeQuantity = Number.isSafeInteger(quantity) && quantity > 0 ? quantity : 0;
    const safeUnitPricePence = Number.isSafeInteger(unitPricePence) && unitPricePence >= 0 ? unitPricePence : 0;
    productRevenuePence += safeUnitPricePence * safeQuantity;
    if (wholesaleUnitPence === null) wholesaleComplete = false;
    else wholesaleProductPence += wholesaleUnitPence * safeQuantity;
    return {
      packId,
      name: String(item.name ?? ''),
      quantity: safeQuantity,
      unitPricePence: safeUnitPricePence,
      wholesaleUnitPence,
      productMarginPence: wholesaleUnitPence === null ? null : (safeUnitPricePence - wholesaleUnitPence) * safeQuantity,
    };
  });
  const dispensingFeePence = Number.isSafeInteger(order.dispensingFeePence) ? Number(order.dispensingFeePence) : 0;
  const patientRevenuePence = productRevenuePence + dispensingFeePence;
  const recognised = order.paymentStatus === 'paid';
  return {
    orderId: String(order.id),
    patientId: String(order.patientId ?? ''),
    createdAt: String(order.createdAt ?? ''),
    paymentStatus: String(order.paymentStatus ?? 'pending'),
    fulfilmentStatus: String(order.fulfilmentStatus ?? ''),
    recognised,
    productRevenuePence,
    dispensingFeePence,
    patientRevenuePence,
    wholesaleProductPence: wholesaleComplete ? wholesaleProductPence : null,
    shippingPence: wholesaleComplete ? quote.shippingPence : null,
    wholesalePence: wholesaleComplete ? wholesaleProductPence + quote.shippingPence : null,
    productMarginPence: wholesaleComplete ? productRevenuePence - wholesaleProductPence : null,
    totalContributionPence: wholesaleComplete ? patientRevenuePence - wholesaleProductPence - quote.shippingPence : null,
    wholesaleComplete,
    lines,
  };
}

export async function pharmacyPrescriptionFinance(organisationId: string, range: FinanceDateRange) {
  const snapshot = await firestore.collection('orders').where('organisationId', '==', organisationId).limit(2_000).get();
  const baseRows = snapshot.docs
    .map(document => pharmacyFinanceRow(document.data()))
    .filter(row => inRange(row.createdAt, range))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const patientIds = [...new Set(baseRows.map(row => row.patientId).filter(Boolean))];
  const patients = await Promise.all(patientIds.map(id => firestore.collection('patients').doc(id).get()));
  const patientDetails = new Map(patients.filter(patient => patient.exists).map(patient => [
    patient.id,
    {
      patientName: `${String(patient.data()?.firstName ?? '')} ${String(patient.data()?.surname ?? '')}`.trim() || patient.id,
      patientEmail: String(patient.data()?.email ?? ''),
    },
  ]));
  const rows = baseRows.map(row => ({
    ...row,
    patientName: patientDetails.get(row.patientId)?.patientName ?? row.patientId,
    patientEmail: patientDetails.get(row.patientId)?.patientEmail ?? '',
  }));
  const recognised = rows.filter(row => row.recognised);
  const complete = recognised.filter(row => row.wholesaleComplete);
  return {
    organisationId,
    currency: 'GBP',
    range: { from: range.from ?? null, to: range.to ?? null },
    totals: {
      prescriptionCount: rows.length,
      paidPrescriptionCount: recognised.length,
      pendingPrescriptionCount: rows.length - recognised.length,
      patientRevenuePence: recognised.reduce((sum, row) => sum + row.patientRevenuePence, 0),
      productRevenuePence: recognised.reduce((sum, row) => sum + row.productRevenuePence, 0),
      dispensingFeesPence: recognised.reduce((sum, row) => sum + row.dispensingFeePence, 0),
      wholesaleKnownForCount: complete.length,
      wholesalePendingForCount: recognised.length - complete.length,
      wholesaleProductPence: complete.reduce((sum, row) => sum + (row.wholesaleProductPence ?? 0), 0),
      shippingPence: complete.reduce((sum, row) => sum + (row.shippingPence ?? 0), 0),
      wholesalePence: complete.reduce((sum, row) => sum + (row.wholesalePence ?? 0), 0),
      productMarginPence: complete.reduce((sum, row) => sum + (row.productMarginPence ?? 0), 0),
      totalContributionPence: complete.reduce((sum, row) => sum + (row.totalContributionPence ?? 0), 0),
    },
    rows,
  };
}

export async function adminReferralFinance(range: FinanceDateRange, organisationId?: string) {
  const snapshot = await firestore.collection('referralFeeEvents').limit(5_000).get();
  const events = snapshot.docs
    .map(document => document.data())
    .filter(event => (!organisationId || event.organisationId === organisationId) && inRange(event.occurredAt ?? event.dueDate, range))
    .sort((left, right) => String(right.occurredAt ?? right.dueDate).localeCompare(String(left.occurredAt ?? left.dueDate)));
  const organisationIds = [...new Set(events.map(event => String(event.organisationId)))];
  const organisations = await Promise.all(organisationIds.map(id => firestore.collection('organisations').doc(id).get()));
  const names = new Map(organisations.filter(snapshot => snapshot.exists).map(snapshot => [
    snapshot.id,
    String(snapshot.data()?.tradingName ?? snapshot.data()?.name ?? snapshot.id),
  ]));
  const patientIds = [...new Set(events.map(event => String(event.patientId)))];
  const patients = await Promise.all(patientIds.map(id => firestore.collection('patients').doc(id).get()));
  const patientDetails = new Map(patients.filter(snapshot => snapshot.exists).map(snapshot => {
    const patient = snapshot.data()!;
    return [snapshot.id, {
      patientName: `${String(patient.firstName ?? '')} ${String(patient.surname ?? '')}`.trim() || snapshot.id,
      patientEmail: String(patient.email ?? ''),
    }];
  }));
  const rows = events.map(event => ({
    id: String(event.id),
    organisationId: String(event.organisationId),
    pharmacyName: names.get(String(event.organisationId)) ?? String(event.organisationId),
    patientId: String(event.patientId),
    patientName: patientDetails.get(String(event.patientId))?.patientName ?? String(event.patientId),
    patientEmail: patientDetails.get(String(event.patientId))?.patientEmail ?? '',
    referralSubmissionId: event.referralSubmissionId ?? null,
    kind: event.kind,
    amountPence: Number(event.amountPence),
    currency: 'GBP',
    dueDate: event.dueDate,
    occurredAt: event.occurredAt,
  }));
  const byPharmacy = [...new Set(rows.map(row => row.organisationId))].map(id => {
    const pharmacyRows = rows.filter(row => row.organisationId === id);
    return {
      organisationId: id,
      pharmacyName: pharmacyRows[0]?.pharmacyName ?? id,
      newReferralCount: pharmacyRows.filter(row => row.kind === 'new_referral').length,
      annualPatientCount: pharmacyRows.filter(row => row.kind === 'annual_patient').length,
      amountPence: pharmacyRows.reduce((sum, row) => sum + row.amountPence, 0),
    };
  }).sort((left, right) => right.amountPence - left.amountPence);
  return {
    currency: 'GBP',
    range: { from: range.from ?? null, to: range.to ?? null },
    organisationId: organisationId ?? null,
    totals: {
      eventCount: rows.length,
      newReferralCount: rows.filter(row => row.kind === 'new_referral').length,
      annualPatientCount: rows.filter(row => row.kind === 'annual_patient').length,
      amountPence: rows.reduce((sum, row) => sum + row.amountPence, 0),
    },
    byPharmacy,
    rows,
  };
}
