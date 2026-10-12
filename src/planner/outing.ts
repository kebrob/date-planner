import { addMinutes, fromLocal, localParts, toLocalDate, toLocalTime } from '@/lib/time';

const DAY_START_HOUR = 10;
const DAY_END_HOUR = 22;
const EVENING_START_HOUR = 18;
const EVENING_HOURS = 5;
// Starting later than this is a "tonight" plan; after the last start it is tomorrow's.
const LAST_DAY_START_HOUR = 16;
const LAST_TONIGHT_START_HOUR = 21;
// Evenings end by 2 am at the latest.
const LATEST_END_HOUR = 26;

const pad = (n: number) => String(n).padStart(2, '0');

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10);
}

/** Window on Europe/Berlin wall-clock time, so server render and browser agree. */
export function timeWindow(date: string, startHour: number, durationHours: number) {
  const day = startHour >= 24 ? addDays(date, 1) : date;
  const startTime = `${pad(startHour % 24)}:00`;
  const end = addMinutes(fromLocal(day, startTime), durationHours * 60);
  return { date: day, startTime, endDate: toLocalDate(end), endTime: toLocalTime(end) };
}

type Outing = ReturnType<typeof timeWindow> & { when: 'today' | 'tonight' | 'tomorrow' };

/** The next sensible time for a spontaneous date, depending on how much of the day is left. */
export function nextOuting(now = new Date()): Outing {
  const today = toLocalDate(now);
  const start = localParts(now).hour + 1;
  if (start <= LAST_DAY_START_HOUR) {
    const from = Math.max(start, DAY_START_HOUR);
    return { when: 'today', ...timeWindow(today, from, DAY_END_HOUR - from) };
  }
  if (start <= LAST_TONIGHT_START_HOUR) {
    return {
      when: 'tonight',
      ...timeWindow(today, start, Math.min(EVENING_HOURS, LATEST_END_HOUR - start)),
    };
  }
  return {
    when: 'tomorrow',
    ...timeWindow(addDays(today, 1), EVENING_START_HOUR, EVENING_HOURS),
  };
}
