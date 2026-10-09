import { describe, expect, it } from 'vitest';
import type { TripInput, TripPlan } from '@/ai/trip';
import { fromLocal } from '@/lib/time';
import type { RailStation, RailTimetable, StationStop } from '@/ports/rail';
import { attachTripTrains } from './trains';

const ROSENHEIM: RailStation = {
  eva: '8000320',
  name: 'Rosenheim',
  location: { lat: 47.85, lng: 12.119 },
};
const SALZBURG: RailStation = {
  eva: '8100002',
  name: 'Salzburg Hbf',
  location: { lat: 47.813, lng: 13.046 },
};

function stop(
  id: string,
  time: string,
  date: string,
  kind: 'arr' | 'dep',
  path: string[] = [],
): StationStop {
  const event = {
    planned: fromLocal(date, time),
    actual: fromLocal(date, time),
    platform: '1',
    plannedPlatform: '1',
    cancelled: false,
    path,
  };
  return {
    id,
    category: 'RE',
    number: '5',
    line: 'RE 5',
    arrival: kind === 'arr' ? event : null,
    departure: kind === 'dep' ? event : null,
  };
}

const timetable: RailTimetable = {
  stops: async (eva, from) => {
    const day = from.toISOString().slice(0, 10);
    if (day === '2026-10-16') {
      return eva === ROSENHEIM.eva
        ? [stop('-1-x-1', '08:35', '2026-10-16', 'dep', ['Prien', 'Salzburg Hbf'])]
        : [stop('-1-x-5', '09:30', '2026-10-16', 'arr')];
    }
    return eva === ROSENHEIM.eva
      ? [stop('-2-x-6', '15:25', '2026-10-18', 'arr', ['Salzburg Hbf', 'Prien'])]
      : [stop('-2-x-1', '14:30', '2026-10-18', 'dep', ['Prien', 'Rosenheim'])];
  },
  stationNumber: async () => null,
  refresh: async (_e, s) => s,
};

const stations = {
  near: async (point: { lng: number }) => (point.lng > 12.5 ? [SALZBURG] : [ROSENHEIM]),
};
const geocoder = {
  find: async () => ({ name: 'Salzburg', location: { lat: 47.8, lng: 13.04 } }),
};

const plan = {
  travel: [
    { from: 'Rosenheim', to: 'Salzburg', mode: 'train', notes: '', link: null },
    { from: 'Salzburg', to: 'Rosenheim', mode: 'train', notes: '', link: null },
  ],
} as unknown as TripPlan;

const input = {
  startDate: '2026-10-16',
  endDate: '2026-10-18',
  transport: 'deutschlandticket',
} as TripInput;

describe('attachTripTrains', () => {
  it('adds the morning train out and the afternoon train back', async () => {
    const result = await attachTripTrains(
      plan,
      input,
      { lat: 47.86, lng: 12.12 },
      {
        stations,
        timetable,
        geocoder,
      },
    );
    expect(result.travel[0]!.train).toMatchObject({
      from: { name: 'Rosenheim' },
      plannedDeparture: fromLocal('2026-10-16', '08:35').toISOString(),
    });
    expect(result.travel[1]!.train).toMatchObject({
      to: { name: 'Rosenheim' },
      plannedDeparture: fromLocal('2026-10-18', '14:30').toISOString(),
    });
  });

  it('adds trains without a transport preference, long-distance included', async () => {
    const result = await attachTripTrains(
      plan,
      { ...input, transport: null },
      { lat: 47.86, lng: 12.12 },
      { stations, timetable, geocoder },
    );
    expect(result.travel[0]!.train).toBeDefined();
  });

  it('leaves car trips untouched', async () => {
    const result = await attachTripTrains(
      plan,
      { ...input, transport: 'car' },
      { lat: 47.86, lng: 12.12 },
      { stations, timetable, geocoder },
    );
    expect(result.travel.every((t) => !t.train)).toBe(true);
  });
});
