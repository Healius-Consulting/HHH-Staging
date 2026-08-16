export type PatientDirectoryFilter = 'all' | 'active' | 'on-order';
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

export function patientProfileUrl(href: string, patientId: string | null) {
  const url = new URL(href);
  if (patientId) url.searchParams.set('patient', patientId);
  else url.searchParams.delete('patient');
  return `${url.pathname}${url.search}${url.hash}`;
}

export function directoryContextFromHistory(value: unknown): PatientDirectoryContext | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = (value as { patientDirectoryContext?: unknown }).patientDirectoryContext;
  if (!candidate || typeof candidate !== 'object') return null;
  const context = candidate as Partial<PatientDirectoryContext>;
  if (typeof context.search !== 'string') return null;
  if (!['all', 'active', 'on-order'].includes(String(context.filter))) return null;
  if (!['name', 'status', 'id'].includes(String(context.sort))) return null;
  if (typeof context.scrollTop !== 'number' || !Number.isFinite(context.scrollTop) || context.scrollTop < 0) return null;
  if (typeof context.pageScrollY !== 'number' || !Number.isFinite(context.pageScrollY) || context.pageScrollY < 0) return null;
  if (context.focusPatientId !== null && typeof context.focusPatientId !== 'string') return null;
  return context as PatientDirectoryContext;
}
