import { localParts, utcOffsetMinutes } from '@/lib/time';
import type { OpeningHours } from '@/ports/places';

const WEEK = 7 * 24 * 60;

function minuteOfWeek(date: Date): number {
  const p = localParts(date);
  return p.weekday * 24 * 60 + p.hour * 60 + p.minute;
}

/** True if the place is open for the whole interval (local time). Intervals longer than a week are rejected. */
export function isOpenDuring(hours: OpeningHours, start: Date, end: Date): boolean {
  if (hours.alwaysOpen) return true;
  const length = Math.round((end.getTime() - start.getTime()) / 60_000);
  if (length <= 0 || length > WEEK) return false;
  const from = minuteOfWeek(start);
  // Opening hours are wall-clock times; on the nights the clocks change, local time skips or
  // repeats an hour.
  const to = from + length + utcOffsetMinutes(end) - utcOffsetMinutes(start);
  // Shift periods by one week as well, to cover intervals and periods wrapping past Saturday midnight.
  return hours.periods.some((p) =>
    [-WEEK, 0, WEEK].some((shift) => p.start + shift <= from && to <= p.end + shift),
  );
}

const STEP_MINUTES = 15;

/** Earliest start in [from, to − duration] (15-min steps) at which the place is open throughout. */
export function firstOpenStart(
  hours: OpeningHours,
  from: Date,
  to: Date,
  durationMinutes: number,
): Date | null {
  const last = to.getTime() - durationMinutes * 60_000;
  for (let t = from.getTime(); t <= last; t += STEP_MINUTES * 60_000) {
    const start = new Date(t);
    if (isOpenDuring(hours, start, new Date(t + durationMinutes * 60_000))) return start;
  }
  return null;
}
