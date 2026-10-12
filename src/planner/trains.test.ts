import { describe, expect, it } from 'vitest';
import type { Activity, Plan, PlanItem, Travel } from '@/core/planner/types';
import { addMinutes, fromLocal } from '@/lib/time';
import type { RailStation, RailTimetable, StationStop } from '@/ports/rail';
import { attachTrains, type TrainContext } from './trains';

const at = (time: string) => fromLocal('2026-10-10', time);

const ROSENHEIM: RailStation = {
  eva: '8000320',
  name: 'Rosenheim',
  location: { lat: 47.85, lng: 12.12 },
};
const OST: RailStation = {
  eva: '8000262',
  name: 'München Ost',
  location: { lat: 48.127, lng: 11.605 },
};
const VENUE = { lat: 48.128, lng: 11.6 };

const stations = {
  near: async (point: { lat: number }) => (point.lat < 48 ? [ROSENHEIM] : [OST]),
  named: async () => null,
};

function event(time: string, delay = 0, path: string[] = []) {
  return {
    planned: at(time),
    actual: addMinutes(at(time), delay),
    platform: '2',
    plannedPlatform: '2',
    cancelled: false,
    path,
  };
}

function stop(
  id: string,
  category: string,
  ev: { arr?: ReturnType<typeof event>; dep?: ReturnType<typeof event> },
): StationStop {
  return {
    id,
    category,
    number: '1',
    line: `${category} 1`,
    arrival: ev.arr ?? null,
    departure: ev.dep ?? null,
  };
}

function timetable(byStation: Record<string, StationStop[]>): RailTimetable {
  return {
    stops: async (eva) => byStation[eva] ?? [],
    stationNumber: async () => null,
    refresh: async (_e, s) => s,
  };
}

const TRAIN: Travel = { minutes: 83, distanceKm: 57, mode: 'train', costEur: 0 };
const dinner = { id: 'dinner', atHome: false } as Activity;

function plan(): Plan {
  const item: PlanItem = {
    slot: 'meal',
    activity: dinner,
    place: { provider: 'google', id: 'p', name: 'Venue', location: VENUE, openingHours: null },
    travelBefore: { ...TRAIN },
    start: at('18:25'),
    end: at('19:55'),
    costEur: 40,
    openingHoursUnknown: false,
    alternatives: [],
  };
  return {
    format: 'single',
    startsInArea: false,
    items: [item],
    travelHome: { ...TRAIN },
    totalCostEur: 40,
    overBudgetEur: 0,
    weather: { reliability: 'good', dry: true, minTempC: 10, maxTempC: 15 },
    warnings: [],
    placeLookups: 1,
    freePlaceLookups: 0,
  };
}

const ctx: TrainContext = {
  start: at('17:00'),
  end: at('22:00'),
  transport: 'deutschlandticket',
  home: { lat: 47.86, lng: 12.121 },
  homeGrid: { lat: 47.86, lng: 12.12 },
  routine: { transport: 'deutschlandticket', firstLegMinutes: 15, bufferMinutes: 5 },
};

const OUT = ['Großkarolinenfeld', 'München Ost'];
const BACK = ['Grafing', 'Rosenheim'];

describe('attachTrains', () => {
  it('uses real trains both ways and moves the item when the train arrives later', async () => {
    const p = plan();
    await attachTrains(p, ctx, {
      stations,
      timetable: timetable({
        '8000320': [
          stop('-1-x-1', 'RB', { dep: event('17:42', 0, OUT) }),
          stop('-2-x-9', 'RB', { arr: event('21:35', 0, ['München Ost', 'Grafing']) }),
        ],
        '8000262': [
          stop('-1-x-7', 'RB', { arr: event('18:30', 5) }),
          stop('-2-x-1', 'RB', { dep: event('20:40', 0, BACK) }),
        ],
      }),
    });

    const [item] = p.items;
    // Arrival 18:35 (+5) plus a short walk; the item started at 18:25 before.
    expect(item!.start.getTime()).toBeGreaterThan(at('18:35').getTime());
    expect(item!.travelBefore!.train).toMatchObject({
      line: 'RB 1',
      from: { name: 'Rosenheim' },
      to: { name: 'München Ost' },
      // Routine (car to the station) starts 20 min before departure.
      leaveAt: at('17:22').toISOString(),
    });
    expect(p.travelHome!.train).toMatchObject({ departure: at('20:40').toISOString() });
    expect(p.warnings).toContain('train_times_adjusted');
    expect(p.warnings).not.toContain('train_late_return');
  });

  it('falls back to a long-distance train with a ticket warning', async () => {
    const p = plan();
    await attachTrains(p, ctx, {
      stations,
      timetable: timetable({
        '8000320': [stop('-1-x-1', 'ICE', { dep: event('17:30', 0, OUT) })],
        '8000262': [stop('-1-x-5', 'ICE', { arr: event('18:00') })],
      }),
    });
    expect(p.items[0]!.travelBefore!.train).toMatchObject({ category: 'ICE', regional: false });
    expect(p.warnings).toContain('train_ticket_needed');
  });

  it('keeps the trains found so far when a later lookup fails', async () => {
    const p = plan();
    const working = timetable({
      '8000320': [stop('-1-x-1', 'RB', { dep: event('17:42', 0, OUT) })],
      '8000262': [stop('-1-x-7', 'RB', { arr: event('18:30', 5) })],
    });
    let calls = 0;
    await attachTrains(p, ctx, {
      stations: {
        ...stations,
        // The way home looks up the home station again; that call fails.
        near: async (point) => {
          if (++calls > 2) throw new Error('rate limited');
          return stations.near(point);
        },
      },
      timetable: working,
    });
    expect(p.items[0]!.travelBefore!.train).toMatchObject({ line: 'RB 1' });
    expect(p.travelHome).toEqual(TRAIN);
    expect(p.warnings).toEqual(
      expect.arrayContaining(['train_times_adjusted', 'trains_unavailable']),
    );
  });

  it('keeps the estimate when no train fits', async () => {
    const p = plan();
    await attachTrains(p, ctx, { stations, timetable: timetable({}) });
    expect(p.items[0]!.travelBefore).toEqual(TRAIN);
    expect(p.items[0]!.start).toEqual(at('18:25'));
  });

  it('falls back to a connection with one change', async () => {
    const GRAFING: RailStation = {
      eva: '8002377',
      name: 'Grafing Bahnhof',
      location: { lat: 48.046, lng: 11.97 },
    };
    const p = plan();
    await attachTrains(p, ctx, {
      stations: {
        ...stations,
        named: async (name) => (name === 'Grafing Bahnhof' ? GRAFING : null),
      },
      timetable: timetable({
        '8000320': [
          stop('-1-x-1', 'RB', { dep: event('17:42', 0, ['Grafing Bahnhof', 'Kirchseeon']) }),
        ],
        '8002377': [
          stop('-1-x-4', 'RB', { arr: event('18:00') }),
          stop('-2-x-3', 'S', { dep: event('18:08') }),
        ],
        '8000262': [stop('-2-x-9', 'S', { arr: event('18:30', 0, ['Grafing Bahnhof', 'Haar']) })],
      }),
    });
    const travel = p.items[0]!.travelBefore!;
    expect(travel.train).toMatchObject({
      from: { name: 'Rosenheim' },
      to: { name: 'Grafing Bahnhof' },
    });
    expect(travel.transfers).toEqual([
      expect.objectContaining({
        from: expect.objectContaining({ name: 'Grafing Bahnhof' }),
        to: expect.objectContaining({ name: 'München Ost' }),
      }),
    ]);
  });

  it('derives expected trains from a similar day when the date is too far ahead', async () => {
    // Monday 5 Oct for a Saturday date: the reference day's trains are moved to the date.
    const reference = (time: string) => {
      const e = event(time);
      const day = (d: Date) => new Date(d.getTime() - 5 * 86_400_000);
      return { ...e, planned: day(e.planned), actual: day(e.actual) };
    };
    const p = plan();
    await attachTrains(
      p,
      { ...ctx, now: fromLocal('2026-10-05', '12:00') },
      {
        stations,
        timetable: timetable({
          '8000320': [stop('-1-x-1', 'RB', { dep: { ...reference('17:42'), path: OUT } })],
          '8000262': [stop('-1-x-7', 'RB', { arr: reference('18:30') })],
        }),
      },
    );
    expect(p.items[0]!.travelBefore!.train).toMatchObject({
      expected: true,
      plannedDeparture: at('17:42').toISOString(),
    });
  });

  it('only fills open legs when refreshing a saved plan', async () => {
    const p = plan();
    const real = { line: 'RB 9' } as NonNullable<Travel['train']>;
    p.items[0]!.travelBefore = { ...TRAIN, train: real };
    await attachTrains(
      p,
      { ...ctx, refreshOnly: true },
      {
        stations,
        timetable: timetable({
          '8000320': [stop('-1-x-1', 'RB', { dep: event('17:42', 0, OUT) })],
          '8000262': [stop('-1-x-7', 'RB', { arr: event('18:30') })],
        }),
      },
    );
    expect(p.items[0]!.travelBefore!.train).toBe(real);
  });

  it('looks up the home station by the rounded location only', async () => {
    const asked: { lat: number; lng: number }[] = [];
    await attachTrains(plan(), ctx, {
      stations: { ...stations, near: async (point) => (asked.push(point), stations.near(point)) },
      timetable: timetable({}),
    });
    expect(asked).not.toContainEqual(ctx.home);
    expect(asked).toContainEqual(ctx.homeGrid);
  });
});
