import { localParts, toLocalDate } from '@/lib/time';
import { addDays, nextOuting, timeWindow } from '@/planner/outing';

export type TimePreset = ReturnType<typeof timeWindow> & { label: string };

const OUTING_LABEL = { today: 'Today', tonight: 'Tonight', tomorrow: 'Tomorrow evening' };

/** The preset used by "Surprise us" and as the wizard default. */
export function outingPreset(now = new Date()): TimePreset {
  const { when, ...window } = nextOuting(now);
  return { label: OUTING_LABEL[when], ...window };
}

export function presets(now = new Date()): TimePreset[] {
  const today = toLocalDate(now);
  const { hour, weekday } = localParts(now);
  const daysToSaturday = (6 - weekday + 7) % 7 || 7;
  const outing = outingPreset(now);
  const tomorrowEvening = { label: 'Tomorrow evening', ...timeWindow(addDays(today, 1), 18, 5) };
  return [
    { label: 'Right now', ...timeWindow(today, hour + 1, 4) },
    ...(outing.label === 'Tomorrow evening' ? [] : [outing]),
    tomorrowEvening,
    { label: 'Saturday', ...timeWindow(addDays(today, daysToSaturday), 10, 12) },
  ];
}
