import { createHash } from 'node:crypto';
import { normaliseConditionId, type ConditionId } from './conditions.js';
import type { DocumentData, DocumentReference } from 'firebase-admin/firestore';
import { firestore } from './firebase.js';
import { HttpError, nowIso } from './http.js';
import { invalidateCollectionCache } from './repository.js';

export const REFERRAL_FEE_PENCE = 5_000;
export const ANNUAL_PATIENT_FEE_PENCE = 4_000;

function stableId(...parts: string[]) {
  return createHash('sha256').update(parts.join(':')).digest('hex');
}

function normaliseEmail(value: unknown) {
  return String(value ?? '').trim().toLowerCase();
}

function patientIdentityId(organisationId: string, email: unknown, dob: unknown) {
  return stableId(organisationId, normaliseEmail(email), String(dob ?? ''));
}

function feeEventId(patientId: string, kind: 'new_referral' | 'annual_patient', dueDate: string) {
  return kind === 'new_referral' ? stableId(patientId, kind) : stableId(patientId, kind, dueDate);
}

function isAlreadyExists(error: unknown) {
  const code = (error as { code?: number | string } | null)?.code;
  return code === 6 || code === 'already-exists';
}

function dateOnlyInLondon(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function anniversaryDate(originalDate: string, year: number) {
  const [, monthValue, dayValue] = /^(\d{4})-(\d{2})-(\d{2})/.exec(originalDate) ?? [];
  if (!monthValue || !dayValue) return null;
  const month = Number(monthValue);
  const day = Number(dayValue);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${monthValue}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;
}

async function existingPatientId(submission: DocumentData) {
  if (typeof submission.patientId === 'string') return submission.patientId;
  const organisationId = String(submission.organisationId);
  const email = normaliseEmail(submission.email);
  const dob = String(submission.dob ?? '');
  const snapshot = await firestore.collection('patients').where('organisationId', '==', organisationId).limit(500).get();
  return snapshot.docs.find(document => {
    const patient = document.data();
    return normaliseEmail(patient.email) === email && String(patient.dob ?? '') === dob;
  })?.id;
}

export async function completeReferral(submissionId: string, actorUid: string, notes: string | null) {
  const submissionRef = firestore.collection('eligibilitySubmissions').doc(submissionId);
  const initial = await submissionRef.get();
  if (!initial.exists) throw new HttpError(404, 'Eligibility submission not found.', 'NOT_FOUND');
  const submission = initial.data()!;
  const existingId = await existingPatientId(submission);
  const organisationId = String(submission.organisationId);
  const identityId = patientIdentityId(organisationId, submission.email, submission.dob);
  const identityRef = firestore.collection('patientIdentities').doc(identityId);
  const defaultPatientRef = firestore.collection('patients').doc(stableId('referral-patient', identityId));
  const completedAt = nowIso();

  const result = await firestore.runTransaction(async transaction => {
    const [freshSubmission, identitySnapshot] = await Promise.all([
      transaction.get(submissionRef),
      transaction.get(identityRef),
    ]);
    if (!freshSubmission.exists) throw new HttpError(404, 'Eligibility submission not found.', 'NOT_FOUND');
    const current = freshSubmission.data()!;
    if (current.recordsCheck?.status !== 'completed') {
      throw new HttpError(409, 'Complete the call and records check before recording the referral.', 'RECORDS_CHECK_REQUIRED');
    }
    if (current.referral?.status === 'declined' || current.status === 'declined') {
      throw new HttpError(409, 'A declined referral cannot be completed.', 'REFERRAL_DECLINED');
    }

    const patientId = typeof current.patientId === 'string'
      ? current.patientId
      : typeof identitySnapshot.data()?.patientId === 'string'
        ? identitySnapshot.data()!.patientId as string
        : existingId ?? defaultPatientRef.id;
    const patientRef = firestore.collection('patients').doc(patientId);
    const patientSnapshot = await transaction.get(patientRef);
    const effectiveCompletedAt = typeof current.referral?.completedAt === 'string'
      ? current.referral.completedAt as string
      : completedAt;
    const conditions = Array.isArray(current.conditions)
      ? [...new Set(current.conditions.map(normaliseConditionId).filter((value): value is ConditionId => Boolean(value)))].slice(0, 3)
      : [];
    const legacyCondition = normaliseConditionId(current.condition);
    if (conditions.length === 0 && legacyCondition) conditions.push(legacyCondition);
    const requestedPrimary = normaliseConditionId(current.primaryCondition);
    const primaryCondition = requestedPrimary && conditions.includes(requestedPrimary) ? requestedPrimary : conditions[0] ?? null;

    transaction.set(patientRef, {
      id: patientId,
      schemaVersion: 2,
      organisationId,
      firstName: current.firstName,
      surname: current.surname,
      dob: current.dob,
      email: normaliseEmail(current.email),
      mobile: current.mobile,
      postcode: current.postcode,
      address: patientSnapshot.data()?.address ?? '',
      status: patientSnapshot.data()?.status === 'active' ? 'active' : 'referred',
      statusChangedAt: patientSnapshot.data()?.statusChangedAt ?? effectiveCompletedAt,
      conditions,
      primaryCondition,
      referralSource: typeof current.source === 'string' ? current.source : null,
      marketingConsent: typeof current.marketingConsent === 'boolean' ? current.marketingConsent : null,
      sourceReferralId: submissionId,
      referralCompletedAt: patientSnapshot.data()?.referralCompletedAt ?? effectiveCompletedAt,
      createdAt: patientSnapshot.data()?.createdAt ?? effectiveCompletedAt,
      updatedAt: completedAt,
    }, { merge: true });
    transaction.set(identityRef, {
      id: identityId,
      schemaVersion: 1,
      organisationId,
      patientId,
      normalisedEmail: normaliseEmail(current.email),
      dob: current.dob,
      createdAt: identitySnapshot.data()?.createdAt ?? completedAt,
      updatedAt: completedAt,
    }, { merge: true });
    transaction.set(submissionRef, {
      status: 'approved',
      patientId,
      referral: {
        status: 'completed',
        notes,
        completedAt: effectiveCompletedAt,
        completedBy: actorUid,
      },
      reviewedAt: effectiveCompletedAt,
      reviewedBy: actorUid,
      updatedAt: completedAt,
    }, { merge: true });
    return { patientId, referralCompletedAt: effectiveCompletedAt, feeEventId: null };
  });

  invalidateCollectionCache('eligibilitySubmissions', submissionId);
  invalidateCollectionCache('patients', result.patientId);
  return result;
}

function addMonthsClamped(value: Date, months: number) {
  const year = value.getUTCFullYear();
  const month = value.getUTCMonth() + months;
  const day = value.getUTCDate();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(day, lastDay), 12, 0, 0, 0));
}

export async function recordCollectedDispense(orderId: string, actorUid: string, dispenseKey = orderId, collectedAt = nowIso()) {
  const orderRef = firestore.collection('orders').doc(orderId);
  const result = await firestore.runTransaction(async transaction => {
    const orderSnapshot = await transaction.get(orderRef);
    if (!orderSnapshot.exists) throw new HttpError(404, 'Order not found.', 'NOT_FOUND');
    const order = orderSnapshot.data()!;
    const patientId = String(order.patientId ?? '');
    if (!patientId) throw new HttpError(409, 'The order has no patient.', 'PATIENT_REQUIRED');
    const patientRef = firestore.collection('patients').doc(patientId);
    const feeRef = firestore.collection('referralFeeEvents').doc(feeEventId(patientId, 'new_referral', collectedAt.slice(0, 10)));
    const dispenseRef = firestore.collection('dispenseEvents').doc(stableId(orderId, dispenseKey));
    const historicalFeeQuery = firestore.collection('referralFeeEvents').where('patientId', '==', patientId).where('kind', '==', 'new_referral').limit(1);
    const [patientSnapshot, historicalFeeSnapshot, dispenseSnapshot] = await Promise.all([
      transaction.get(patientRef),
      transaction.get(historicalFeeQuery),
      transaction.get(dispenseRef),
    ]);
    if (!patientSnapshot.exists) throw new HttpError(404, 'Patient not found.', 'NOT_FOUND');
    if (dispenseSnapshot.exists) return { patientId, firstOrder: false, feeCreated: false, idempotent: true };
    const patient = patientSnapshot.data()!;
    const firstOrder = !patient.firstDispensedOrderId || patient.firstDispensedOrderId === orderId;
    const collectionDate = new Date(collectedAt);
    const nextApptEst = addMonthsClamped(collectionDate, firstOrder ? 1 : 3).toISOString();
    transaction.create(dispenseRef, { id: dispenseRef.id, schemaVersion: 1, organisationId: order.organisationId, patientId, orderId, dispenseKey, collectedAt, actorUid, firstOrder, createdAt: collectedAt });
    transaction.set(patientRef, { status: 'active', retentionStatus: 'active', lastDispensedAt: collectedAt, nextApptEst, firstDispensedOrderId: patient.firstDispensedOrderId ?? orderId, updatedAt: collectedAt }, { merge: true });
    if (historicalFeeSnapshot.empty) transaction.create(feeRef, { id: feeRef.id, schemaVersion: 2, organisationId: order.organisationId, patientId, referralSubmissionId: patient.sourceReferralId ?? null, kind: 'new_referral', trigger: 'first_collected_dispense', orderId, amountPence: REFERRAL_FEE_PENCE, currency: 'GBP', dueDate: collectedAt.slice(0, 10), occurredAt: collectedAt, createdAt: collectedAt, createdBy: actorUid });
    return { patientId, firstOrder, feeCreated: historicalFeeSnapshot.empty, idempotent: false, nextApptEst };
  });
  invalidateCollectionCache('patients', result.patientId);
  if (result.feeCreated) invalidateCollectionCache('referralFeeEvents');
  return result;
}

export async function updatePatientRetentionStates(asOf = new Date()) {
  const snapshot = await firestore.collection('patients').where('status', '==', 'active').limit(2_000).get();
  const summary = { checked: snapshot.size, atRisk: 0, inactive: 0 };
  for (const document of snapshot.docs) {
    const patient = document.data();
    const due = Date.parse(String(patient.nextApptEst ?? ''));
    if (!Number.isFinite(due) || asOf.getTime() <= due) continue;
    const inactive = asOf.getTime() >= due + 28 * 24 * 60 * 60 * 1_000;
    await document.ref.set({ status: inactive ? 'inactive' : 'active', retentionStatus: inactive ? 'inactive' : 'at_risk', retentionUpdatedAt: asOf.toISOString(), updatedAt: asOf.toISOString() }, { merge: true });
    if (inactive) summary.inactive += 1;
    else summary.atRisk += 1;
  }
  if (summary.atRisk || summary.inactive) invalidateCollectionCache('patients');
  return summary;
}

export async function activatePatientForOrder(orderId: string) {
  const orderRef = firestore.collection('orders').doc(orderId);
  const activatedAt = nowIso();
  const result = await firestore.runTransaction(async transaction => {
    const orderSnapshot = await transaction.get(orderRef);
    if (!orderSnapshot.exists) return null;
    const order = orderSnapshot.data()!;
    if (typeof order.patientId !== 'string') return null;
    const patientRef = firestore.collection('patients').doc(order.patientId);
    const patientSnapshot = await transaction.get(patientRef);
    if (!patientSnapshot.exists) return null;
    const patient = patientSnapshot.data()!;
    if (patient.status !== 'referred') return { patientId: patientRef.id, activated: false };
    transaction.set(patientRef, {
      status: 'active',
      activatedAt: patient.activatedAt ?? activatedAt,
      statusChangedAt: activatedAt,
      firstSubmittedOrderId: patient.firstSubmittedOrderId ?? orderId,
      updatedAt: activatedAt,
    }, { merge: true });
    return { patientId: patientRef.id, activated: true };
  });
  if (result) invalidateCollectionCache('patients', result.patientId);
  return result;
}

async function createAnnualFee(patientRef: DocumentReference, patient: DocumentData, dueDate: string) {
  const eventRef = firestore.collection('referralFeeEvents').doc(feeEventId(patientRef.id, 'annual_patient', dueDate));
  try {
    await eventRef.create({
      id: eventRef.id,
      schemaVersion: 1,
      organisationId: patient.organisationId,
      patientId: patientRef.id,
      referralSubmissionId: patient.sourceReferralId ?? null,
      kind: 'annual_patient',
      amountPence: ANNUAL_PATIENT_FEE_PENCE,
      currency: 'GBP',
      dueDate,
      occurredAt: nowIso(),
      createdAt: nowIso(),
      createdBy: 'system:annual-patient-fees',
    });
    return true;
  } catch (error) {
    if (isAlreadyExists(error)) return false;
    throw error;
  }
}

export async function accrueAnnualPatientFees(asOf = new Date()) {
  const today = dateOnlyInLondon(asOf);
  const year = Number(today.slice(0, 4));
  const snapshot = await firestore.collection('patients').where('status', '==', 'active').limit(2_000).get();
  let created = 0;
  let skipped = 0;
  for (const document of snapshot.docs) {
    const patient = document.data();
    const referralCompletedAt = typeof patient.referralCompletedAt === 'string' ? patient.referralCompletedAt : null;
    const anniversary = referralCompletedAt ? anniversaryDate(referralCompletedAt, year) : null;
    const referralYear = referralCompletedAt ? Number(referralCompletedAt.slice(0, 4)) : NaN;
    if (!anniversary || year <= referralYear || anniversary !== today) {
      skipped += 1;
      continue;
    }
    // A patient reactivated after this anniversary is not back-charged for it.
    if (typeof patient.statusChangedAt === 'string' && patient.statusChangedAt.slice(0, 10) > anniversary) {
      skipped += 1;
      continue;
    }
    if (await createAnnualFee(document.ref, patient, anniversary)) created += 1;
    else skipped += 1;
  }
  if (created) invalidateCollectionCache('referralFeeEvents');
  return { asOf: today, activePatientsChecked: snapshot.size, created, skipped };
}
