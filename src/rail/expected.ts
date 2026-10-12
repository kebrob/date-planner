import { fromLocal, localParts, toLocalDate, toLocalTime } from '@/lib/time';
import type { RailTimetable, StationEvent, StationStop } from '@/ports/rail';

// Measured: planned timetables reach ~18 h ahead (and ~6 h back); searches look 2–4 h further.
export const REAL_TIMES_HORIZON_HOURS = 16;
const SERVED_BACK_HOURS = 6;

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/** Same wall-clock time `days` calendar days later (DST-safe). */
export function shiftDays(date: Date, days: number): Date {
  const [y, m, d] = toLocalDate(date).split('-').map(Number);
  const target = new Date(Date.UTC(y!, m! - 1, d! + days));
  return fromLocal(target.toISOString().slice(0, 10), toLocalTime(date));
}

type DayType = 'weekday' | 'saturday' | 'sunday';

const dayType = (date: Date): DayType => {
  const { weekday } = localParts(date);
  return weekday === 0 ? 'sunday' : weekday === 6 ? 'saturday' : 'weekday';
};

/**
 * Days to go back from `target` to a day the API serves (today or tomorrow, at the same time):
 * the same kind of day if possible, since regional trains mostly run the same pattern on such days.
 */
export function referenceOffset(target: Date, now: Date): number {
  const daysUntil = (day: Date) =>
    Math.round(
      (fromLocal(toLocalDate(target), '12:00').getTime() -
        fromLocal(toLocalDate(day), '12:00').getTime()) /
        DAY_MS,
    );
  const ahead = (offset: number) => shiftDays(target, -offset).getTime() - now.getTime();
  const candidates = [now, new Date(now.getTime() + DAY_MS)]
    .map((day) => ({ offset: daysUntil(day), sameType: dayType(day) === dayType(target) }))
    .filter(
      ({ offset }) =>
        ahead(offset) >= -SERVED_BACK_HOURS * HOUR_MS &&
        ahead(offset) <= REAL_TIMES_HORIZON_HOURS * HOUR_MS,
    )
    .sort((a, b) => Math.abs(ahead(a.offset)) - Math.abs(ahead(b.offset)));
  const best = candidates.find((c) => c.sameType) ?? candidates[0];
  // Nothing served (e.g. early morning trains seen from midday): tomorrow, likely partly served.
  return best?.offset ?? daysUntil(new Date(now.getTime() + DAY_MS));
}

function shiftEvent(event: StationEvent | null, days: number): StationEvent | null {
  return event
    ? {
        ...event,
        planned: shiftDays(event.planned, days),
        actual: shiftDays(event.planned, days),
        platform: event.plannedPlatform,
        cancelled: false,
      }
    : null;
}

/**
 * Timetable that answers for a far-ahead day with the trains of a reference day, moved to the
 * requested day. Realtime changes of the reference day are dropped.
 */
export class ExpectedTimetable implements RailTimetable {
  constructor(
    private readonly inner: RailTimetable,
    private readonly offsetDays: number,
  ) {}

  async stops(eva: string, from: Date, hours: number): Promise<StationStop[]> {
    const stops = await this.inner.stops(eva, shiftDays(from, -this.offsetDays), hours);
    return stops.map((s) => ({
      ...s,
      arrival: shiftEvent(s.arrival, this.offsetDays),
      departure: shiftEvent(s.departure, this.offsetDays),
    }));
  }

  stationNumber(name: string): Promise<string | null> {
    return this.inner.stationNumber(name);
  }

  async refresh(_eva: string, stop: StationStop): Promise<StationStop> {
    return stop;
  }
}
