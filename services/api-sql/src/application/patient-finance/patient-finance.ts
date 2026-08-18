import { createHash } from 'node:crypto';
import { HttpError } from '../../domain/common/errors.js';
import type { PatientFinanceRepositoryPort } from '../../repositories/ports/patient-finance.port.js';
import type { PatientRepositoryPort } from '../../repositories/ports/patient.port.js';

export const REFERRAL_FEE_PENCE = 5_000;
export const ANNUAL_PATIENT_FEE_PENCE = 4_000;

export type PatientFinanceDeps = {
  patientRepo: PatientRepositoryPort;
  patientFinanceRepo: PatientFinanceRepositoryPort;
};

function stableId(...parts: string[]) {
  return createHash('sha256').update(parts.join(':')).digest('hex');
}

function referralFeeIdempotencyKey(patientId: string) {
  return stableId(patientId, 'NEW_REFERRAL');
}

function annualFeeIdempotencyKey(patientId: string, dueDate: string) {
  return stableId(patientId, 'ANNUAL_PATIENT', dueDate);
}

export function dateOnlyInLondon(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

/** Anniversary date in a given calendar year, clamping day for shorter months (e.g. 29 Feb → 28 Feb). */
export function anniversaryDate(originalDate: string, year: number): string | null {
  const [, monthValue, dayValue] = /^(\d{4})-(\d{2})-(\d{2})/.exec(originalDate) ?? [];
  if (!monthValue || !dayValue) return null;
  const month = Number(monthValue);
  const day = Number(dayValue);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${monthValue}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;
}

/**
 * SQL Patient has no referralCompletedAt; activatedAt is the anniversary anchor
 * (set when a referred patient is first activated or on first collected dispense).
 */
export function evaluateAnnualFeeAccrual(input: {
  activatedAt: string | null;
  statusChangedAt: string | null;
  todayLondon: string;
}): { dueDate: string } | null {
  if (!input.activatedAt) return null;
  const year = Number(input.todayLondon.slice(0, 4));
  const anniversary = anniversaryDate(input.activatedAt, year);
  const activationYear = Number(input.activatedAt.slice(0, 4));
  if (!anniversary || year <= activationYear || anniversary !== input.todayLondon) {
    return null;
  }
  const statusChangedDate = input.statusChangedAt?.slice(0, 10) ?? null;
  if (statusChangedDate && statusChangedDate > anniversary) {
    return null;
  }
  return { dueDate: anniversary };
}

export function addMonthsClamped(value: Date, months: number): Date {
  const year = value.getUTCFullYear();
  const month = value.getUTCMonth() + months;
  const day = value.getUTCDate();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(day, lastDay), 12, 0, 0, 0));
}

/** Mirrors legacy nextApptEst: +1 month after first dispense, +3 months after subsequent ones. */
export function estimateNextAppointmentFromDispenses(
  dispenses: Array<{ dispensedAt?: string }>,
): Date | null {
  const latest = dispenses[0]?.dispensedAt;
  if (!latest) return null;
  const collectionDate = new Date(latest);
  if (!Number.isFinite(collectionDate.getTime())) return null;
  return addMonthsClamped(collectionDate, dispenses.length === 1 ? 1 : 3);
}

const RETENTION_GRACE_MS = 28 * 24 * 60 * 60 * 1_000;

export function assertPatientEligibleForOrder(patient: { status: 'REFERRED' | 'ACTIVE' | 'INACTIVE' } | null) {
  if (!patient) {
    throw new HttpError(404, 'Patient not found.', 'NOT_FOUND');
  }
  if (patient.status === 'INACTIVE') {
    throw new HttpError(409, 'This patient is not eligible for new orders.', 'PATIENT_NOT_ELIGIBLE');
  }
}

export async function activatePatientForOrder(
  deps: PatientFinanceDeps,
  input: { organisationId: string; patientId: string; orderId: string; activatedAt?: string },
) {
  const patient = await deps.patientRepo.findPatientById(input.organisationId, input.patientId);
  if (!patient || patient.status !== 'REFERRED') {
    return { patientId: input.patientId, activated: false };
  }
  const activatedAt = input.activatedAt ?? new Date().toISOString();
  await deps.patientRepo.updatePatientStatus({
    id: input.patientId,
    organisationId: input.organisationId,
    status: 'ACTIVE',
    activatedAt: patient.activatedAt ?? activatedAt,
    statusChangedAt: activatedAt,
  });
  return { patientId: input.patientId, activated: true };
}

export async function recordCollectedDispense(
  deps: PatientFinanceDeps,
  input: {
    organisationId: string;
    patientId: string;
    orderId: string;
    actorUid: string;
    dispenseKey: string;
    collectedAt?: string;
  },
) {
  const patient = await deps.patientRepo.findPatientById(input.organisationId, input.patientId);
  if (!patient) {
    throw new HttpError(404, 'Patient not found.', 'NOT_FOUND');
  }

  const collectedAt = input.collectedAt ?? new Date().toISOString();
  const existingDispense = await deps.patientFinanceRepo.findDispenseEvent(input.orderId, input.dispenseKey);
  if (existingDispense) {
    return { patientId: input.patientId, feeCreated: false, idempotent: true };
  }

  await deps.patientFinanceRepo.insertDispenseEvent({
    organisationId: input.organisationId,
    patientId: input.patientId,
    orderId: input.orderId,
    dispenseKey: input.dispenseKey,
    recordedByUid: input.actorUid,
    dispensedAt: collectedAt,
  });

  if (patient.status === 'REFERRED') {
    await deps.patientRepo.updatePatientStatus({
      id: input.patientId,
      organisationId: input.organisationId,
      status: 'ACTIVE',
      activatedAt: patient.activatedAt ?? collectedAt,
      statusChangedAt: collectedAt,
    });
  }

  let feeCreated = false;
  const hasReferralFee = await deps.patientFinanceRepo.hasNewReferralFee(input.patientId);
  if (!hasReferralFee) {
    await deps.patientFinanceRepo.insertReferralFeeEvent({
      organisationId: input.organisationId,
      patientId: input.patientId,
      orderId: input.orderId,
      kind: 'NEW_REFERRAL',
      amountPence: REFERRAL_FEE_PENCE,
      dueDate: dateOnlyInLondon(new Date(collectedAt)),
      status: 'accrued',
      idempotencyKey: referralFeeIdempotencyKey(input.patientId),
    });
    feeCreated = true;
  }

  return { patientId: input.patientId, feeCreated, idempotent: false };
}

export async function promotePatientAfterCuraleafPlacement(
  deps: PatientFinanceDeps,
  order: { id: string; organisationId: string; patientId: string | null | undefined },
  curaleafResult: { purchaseOrder?: { id?: string | null } | null; skipped?: boolean } | null | undefined,
) {
  if (!order.patientId) return { activated: false };
  if (!curaleafResult?.purchaseOrder?.id) return { activated: false };
  return activatePatientForOrder(deps, {
    organisationId: order.organisationId,
    patientId: order.patientId,
    orderId: order.id,
  });
}
