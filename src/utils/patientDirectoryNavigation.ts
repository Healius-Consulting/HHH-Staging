import { isSupportedPatientCrmFilter, patientCrmRecordKey, type PatientCrmKind, type PatientDirectoryFilter } from './patientCrm.ts';

export type { PatientDirectoryFilter };
export type PatientDirectorySort = 'name' | 'status' | 'id';

export interface PatientDirectoryContext {
  search: string;
  filter: PatientDirectoryFilter;
  sort: PatientDirectorySort;
  scrollTop: number;
  pageScrollY: number;
  focusPatientId: string | null;
}

export function patientIdFromSearch(search: string) {
  return new URLSearchParams(search).get('patient');
}

export function enquiryIdFromSearch(search: string) {
  return new URLSearchParams(search).get('enquiry');
}

export function patientCrmSelectionFromSearch(search: string): { kind: PatientCrmKind; id: string } | null {
  const patientId = patientIdFromSearch(search);
  if (patientId) return { kind: 'patient', id: patientId };
  const enquiryId = enquiryIdFromSearch(search);
  if (enquiryId) return { kind: 'enquiry', id: enquiryId };
  return null;
}

export function patientProfileUrl(href: string, patientId: string | null) {
  return patientCrmUrl(href, patientId ? { kind: 'patient', id: patientId } : null);
}

export function patientCrmUrl(href: string, selection: { kind: PatientCrmKind; id: string } | null) {
  const url = new URL(href);
  url.searchParams.delete('patient');
  url.searchParams.delete('enquiry');
  if (selection?.kind === 'patient') url.searchParams.set('patient', selection.id);
  if (selection?.kind === 'enquiry') url.searchParams.set('enquiry', selection.id);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function selectedCrmKeyFromSearch(search: string) {
  const selection = patientCrmSelectionFromSearch(search);
  return selection ? patientCrmRecordKey(selection.kind, selection.id) : null;
}

export function directoryContextFromHistory(value: unknown): PatientDirectoryContext | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = (value as { patientDirectoryContext?: unknown }).patientDirectoryContext;
  if (!candidate || typeof candidate !== 'object') return null;
  const context = candidate as Partial<PatientDirectoryContext>;
  if (typeof context.search !== 'string') return null;
  if (!isSupportedPatientCrmFilter(String(context.filter))) return null;
  if (!['name', 'status', 'id'].includes(String(context.sort))) return null;
  if (typeof context.scrollTop !== 'number' || !Number.isFinite(context.scrollTop) || context.scrollTop < 0) return null;
  if (typeof context.pageScrollY !== 'number' || !Number.isFinite(context.pageScrollY) || context.pageScrollY < 0) return null;
  if (context.focusPatientId !== null && typeof context.focusPatientId !== 'string') return null;
  return context as PatientDirectoryContext;
}
