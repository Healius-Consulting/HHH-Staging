const LONDON_TIME_ZONE = 'Europe/London';
const CUTOFF_MINUTES = 14 * 60 + 30;

const londonDateTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: LONDON_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function dateTimeParts(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = Object.fromEntries(londonDateTime.formatToParts(date).map(part => [part.type, part.value]));
  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: parts.weekday,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

function addWorkingDays(dateKey, numberOfDays) {
  const cursor = new Date(`${dateKey}T12:00:00Z`);
  let remaining = numberOfDays;
  while (remaining > 0) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const weekday = cursor.getUTCDay();
    if (weekday !== 0 && weekday !== 6) remaining -= 1;
  }
  return cursor.toISOString().slice(0, 10);
}

/** Curaleaf's stated delivery aim, calculated in Europe/London local time. */
export function curaleafDeliveryExpectation(approvedAt) {
  const approval = dateTimeParts(approvedAt);
  if (!approval) return null;

  const isWorkingDay = approval.weekday !== 'Sat' && approval.weekday !== 'Sun';
  const beforeCutoff = isWorkingDay && approval.minutes < CUTOFF_MINUTES;
  const windowStart = addWorkingDays(approval.dateKey, beforeCutoff ? 1 : 2);
  const windowEnd = beforeCutoff ? windowStart : addWorkingDays(approval.dateKey, 4);

  return {
    approvedDate: approval.dateKey,
    approvedWeekday: approval.weekday,
    beforeCutoff,
    windowStart,
    windowEnd,
    serviceLevel: beforeCutoff ? 'next-working-day' : 'two-to-four-working-days',
  };
}

export function curaleafDeliveryWindowState(expectation, now = new Date()) {
  const today = dateTimeParts(now)?.dateKey;
  if (!today) return 'upcoming';
  if (today > expectation.windowEnd) return 'overdue';
  if (today >= expectation.windowStart) return 'due';
  return 'upcoming';
}
