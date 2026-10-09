// Budgets reset at local midnight / month start in the users' time zone, not UTC.
const TIME_ZONE = 'Europe/Berlin';

const dayFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function dayKey(date: Date): string {
  return dayFormat.format(date);
}

export function monthKey(date: Date): string {
  return dayKey(date).slice(0, 7);
}
