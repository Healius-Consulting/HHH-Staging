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

export function addWorkingDays(dateKey, numberOfDays) {
  const cursor = new Date(`${dateKey}T12:00:00Z`);
  let remaining = numberOfDays;
  while (remaining > 0) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const weekday = cursor.getUTCDay();
    if (weekday !== 0 && weekday !== 6) remaining -= 1;
  }
  return cursor.toISOString().slice(0, 10);
}

function nextWorkingDay(dateKey) {
  return addWorkingDays(dateKey, 1);
}

/**
 * Staff-facing delivery guidance based on the time a Curaleaf order is (or will
 * be) placed. All calendar decisions are made in Europe/London.
 */
export function curaleafDeliveryGuidance(value) {
  const placement = dateTimeParts(value);
  if (!placement) return null;

  const isWeekend = placement.weekday === 'Sat' || placement.weekday === 'Sun';
  const isFriday = placement.weekday === 'Fri';
  const beforeCutoff = !isWeekend && !isFriday && placement.minutes < CUTOFF_MINUTES;
  // DT-1: Mon–Thu before 14:30 → 1–2 working days
  // DT-2: Mon–Thu at/after 14:30 → 2–4 working days (next day processing)
  // DT-4: Fri (any time), Sat, Sun → 2–4 working days (Monday batch)
  const scenario = isFriday || isWeekend ? 'DT-4' : beforeCutoff ? 'DT-1' : 'DT-2';
  const effectiveProcessingDate = beforeCutoff
    ? placement.dateKey
    : nextWorkingDay(placement.dateKey);
  const windowStart = addWorkingDays(effectiveProcessingDate, 1);
  // DT-1 (Mon–Thu before cutoff): 1–2 working days; all others: up to 4 working days
  const windowEnd = scenario === 'DT-1'
    ? addWorkingDays(effectiveProcessingDate, 2)
    : addWorkingDays(effectiveProcessingDate, 4);

  return {
    scenario,
    placedDate: placement.dateKey,
    placedWeekday: placement.weekday,
    beforeCutoff,
    countdownMinutes: beforeCutoff ? CUTOFF_MINUTES - placement.minutes : 0,
    effectiveProcessingDate,
    nextDay: windowStart,
    windowStart,
    windowEnd,
    serviceLevel: 'next-to-fourth-working-day',
  };
}

/** Neutral operational guidance, calculated in Europe/London local time. */
export function curaleafDeliveryExpectation(approvedAt) {
  const guidance = curaleafDeliveryGuidance(approvedAt);
  if (!guidance) return null;

  return {
    approvedDate: guidance.placedDate,
    approvedWeekday: guidance.placedWeekday,
    beforeCutoff: guidance.beforeCutoff,
    windowStart: guidance.windowStart,
    windowEnd: guidance.windowEnd,
    serviceLevel: 'next-to-fourth-working-day',
  };
}

export function curaleafDeliveryWindowState(expectation, now = new Date()) {
  const today = dateTimeParts(now)?.dateKey;
  if (!today) return 'upcoming';
  if (today > expectation.windowEnd) return 'overdue';
  if (today >= expectation.windowStart) return 'due';
  return 'upcoming';
}
