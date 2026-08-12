const DAY_MS = 24 * 60 * 60 * 1000;
const PRESCRIPTION_WINDOW_DAYS = 28;
const LONDON_DATE = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

type PrescriptionDateWindowStatus = 'current' | 'future' | 'expired' | 'invalid';

function dateOrdinal(value?: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? '');
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return Math.floor(date.getTime() / DAY_MS);
}

function londonTodayOrdinal(now: Date | string) {
  const date = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(date.getTime())) return null;
  const parts = Object.fromEntries(LONDON_DATE.formatToParts(date).map(part => [part.type, part.value]));
  return dateOrdinal(`${parts.year}-${parts.month}-${parts.day}`);
}

function ordinalDate(ordinal: number) {
  return new Date(ordinal * DAY_MS).toISOString().slice(0, 10);
}

export function prescriptionIssueDateBounds(now: Date | string = new Date()) {
  const today = londonTodayOrdinal(now);
  if (today === null) return null;
  return { min: ordinalDate(today - PRESCRIPTION_WINDOW_DAYS), max: ordinalDate(today) };
}

export function calculatePrescriptionExpiryDate(issueDate: string) {
  const issued = dateOrdinal(issueDate);
  return issued === null ? null : ordinalDate(issued + PRESCRIPTION_WINDOW_DAYS);
}

export function prescriptionDateWindowStatus(issueDate?: string, suppliedExpiryDate?: string, now: Date | string = new Date()): PrescriptionDateWindowStatus {
  const issued = dateOrdinal(issueDate);
  const today = londonTodayOrdinal(now);
  if (issued === null || today === null) return 'invalid';
  if (issued > today) return 'future';
  if (issued < today - PRESCRIPTION_WINDOW_DAYS) return 'expired';

  const maximumExpiry = issued + PRESCRIPTION_WINDOW_DAYS;
  const expires = suppliedExpiryDate ? dateOrdinal(suppliedExpiryDate) : maximumExpiry;
  if (expires === null || expires < issued || expires > maximumExpiry) return 'invalid';
  if (expires < today) return 'expired';
  return 'current';
}

export function prescriptionDateIsCurrent(issueDate?: string, suppliedExpiryDate?: string, now: Date | string = new Date()) {
  return prescriptionDateWindowStatus(issueDate, suppliedExpiryDate, now) === 'current';
}
