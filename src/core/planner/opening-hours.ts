import { localParts } from '@/lib/time';
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
  const to = from + length;
  // Shift periods by one week as well, to cover intervals and periods wrapping past Saturday midnight.
  return hours.periods.some((p) =>
    [-WEEK, 0, WEEK].some((shift) => p.start + shift <= from && to <= p.end + shift),
  );
}
