import { describe, expect, it, vi } from 'vitest';
import { addMinutes, fromLocal } from '@/lib/time';
import type { RailStation, RailTimetable, StationStop } from '@/ports/rail';
import { findConnection, findConnectionTo, isRegional, normalizeStationName } from './connection';

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
const HBF: RailStation = {
  eva: '8000261',
  name: 'München Hauptbahnhof',
  location: { lat: 48.14, lng: 11.558 },
};
const MARIENPLATZ: RailStation = {
  eva: '8004135',
  name: 'Marienplatz',
  location: { lat: 48.137, lng: 11.575 },
};
const TARGET = { lat: 48.139, lng: 11.56 }; // close to Hbf

const at = (time: string) => fromLocal('2026-10-10', time);

function stop(
  run: string,
  index: number,
  category: string,
  times: { arr?: string; dep?: string; delay?: number; path?: string[] },
): StationStop {
  const event = (time: string) => ({
    planned: at(time),
    actual: addMinutes(at(time), times.delay ?? 0),
    platform: '1',
    plannedPlatform: '1',
    cancelled: false,
    path: times.path ?? [],
  });
  return {
    id: `${run}-${index}`,
    category,
    number: run,
    line: `${category} ${run}`,
    arrival: times.arr ? event(times.arr) : null,
    departure: times.dep ? event(times.dep) : null,
  };
}

const ROUTE = ['Großkarolinenfeld', 'München Ost', 'München Hbf'];

function timetable(byStation: Record<string, StationStop[]>): RailTimetable {
  return {
    stops: vi.fn(async (eva: string) => byStation[eva] ?? []),
    stationNumber: async () => null,
    refresh: async (_eva, s) => s,
  };
}

const stations = {
  near: async (point: { lat: number }) => (point.lat < 48 ? [ROSENHEIM] : [HBF, MARIENPLATZ, OST]),
};

describe('normalizeStationName', () => {
  it('matches spelling variants of the same station', () => {
    expect(normalizeStationName('München Hauptbahnhof')).toBe(normalizeStationName('München Hbf'));
    expect(normalizeStationName('Rosenheim (Bahnhof)')).toBe(normalizeStationName('Rosenheim'));
  });
});

describe('findConnection', () => {
  const input = {
    from: { lat: 47.86, lng: 12.12 },
    to: TARGET,
    departAfter: at('17:00'),
    regionalOnly: true,
  };

  it('picks the earliest direct train to a station near the target', async () => {
    const tt = timetable({
      '8000320': [
        stop('-1-2610101650', 4, 'RB', { dep: '17:12', path: ROUTE }),
        stop('-2-2610101740', 4, 'RB', { dep: '17:42', path: ROUTE }),
      ],
      '8000261': [
        stop('-1-2610101650', 9, 'RB', { arr: '18:05' }),
        stop('-2-2610101740', 9, 'RB', { arr: '18:35' }),
      ],
    });
    const connection = await findConnection(input, stations, tt);
    expect(connection).toMatchObject({
      from: ROSENHEIM,
      to: { eva: HBF.eva, name: 'München Hbf' },
    });
    expect(connection!.departure.planned).toEqual(at('17:12'));
    expect(connection!.arrival.planned).toEqual(at('18:05'));
    // Marienplatz is not on the route, so its timetable is never fetched.
    expect(tt.stops).not.toHaveBeenCalledWith('8004135', expect.anything(), expect.anything());
  });

  it('skips long-distance trains with the Deutschlandticket, allows them otherwise', async () => {
    const tt = timetable({
      '8000320': [stop('-9-2610101700', 2, 'ICE', { dep: '17:05', path: ROUTE })],
      '8000261': [stop('-9-2610101700', 3, 'ICE', { arr: '17:40' })],
    });
    expect(await findConnection(input, stations, tt)).toBeNull();
    const ice = await findConnection({ ...input, regionalOnly: false }, stations, tt);
    expect(ice).toMatchObject({ category: 'ICE', regional: false });
  });

  it('ignores trains that already left, are cancelled or go the other way', async () => {
    const cancelled = stop('-3-2610101650', 4, 'RB', { dep: '17:20', path: ROUTE });
    cancelled.departure!.cancelled = true;
    const tt = timetable({
      '8000320': [stop('-1-2610101650', 4, 'RB', { dep: '16:55', path: ROUTE }), cancelled],
      '8000261': [
        stop('-1-2610101650', 9, 'RB', { arr: '17:48' }),
        stop('-3-2610101650', 9, 'RB', { arr: '18:10' }),
        // Same run, but arriving before departing: the opposite direction.
        stop('-4-2610101650', 1, 'RB', { arr: '16:30' }),
      ],
    });
    expect(await findConnection(input, stations, tt)).toBeNull();
  });

  it('uses realtime arrival when choosing between trains', async () => {
    const tt = timetable({
      '8000320': [
        stop('-1-2610101650', 4, 'RB', { dep: '17:12', path: ROUTE }),
        stop('-2-2610101650', 4, 'RE', { dep: '17:20', path: ROUTE }),
      ],
      '8000261': [
        stop('-1-2610101650', 9, 'RB', { arr: '18:05', delay: 30 }),
        stop('-2-2610101650', 9, 'RE', { arr: '18:00' }),
      ],
    });
    const connection = await findConnection(input, stations, tt);
    expect(connection!.category).toBe('RE');
  });

  it('returns null without a nearby station', async () => {
    const none = { near: async () => [] };
    expect(await findConnection(input, none, timetable({}))).toBeNull();
  });

  it('classifies categories', () => {
    expect(isRegional('RB')).toBe(true);
    expect(isRegional('BRB')).toBe(true);
    expect(isRegional('ICE')).toBe(false);
  });
});

describe('findConnectionTo', () => {
  // Arrivals at Rosenheim list the stations the train came through.
  const FROM_MUNICH = ['München Hbf Gl.5-10', 'München Ost', 'Grafing Bahnhof'];
  const nearMarienplatz = {
    near: async () => [MARIENPLATZ, { ...HBF, eva: '8098262', name: 'München Hbf' }, OST],
  };

  it('finds the city station with a direct train home, not just the closest halt', async () => {
    const tt: RailTimetable = {
      stops: vi.fn(async (eva: string) =>
        eva === ROSENHEIM.eva
          ? [stop('-5-2610092300', 9, 'RE', { arr: '23:37', path: FROM_MUNICH })]
          : eva === '8098262'
            ? [stop('-5-2610092300', 1, 'RE', { dep: '22:51' })]
            : [],
      ),
      stationNumber: async (name) => (name === 'München Hbf Gl.5-10' ? '8098262' : null),
      refresh: async (_e, s) => s,
    };
    const connection = await findConnectionTo(
      {
        from: { lat: 48.137, lng: 11.575 },
        toStation: ROSENHEIM,
        departAfter: at('22:15'),
        regionalOnly: true,
      },
      nearMarienplatz,
      tt,
    );
    expect(connection).toMatchObject({
      from: { eva: '8098262', name: 'München Hbf Gl.5-10' },
      to: ROSENHEIM,
      line: 'RE -5-2610092300',
    });
    expect(tt.stops).not.toHaveBeenCalledWith(
      MARIENPLATZ.eva,
      expect.anything(),
      expect.anything(),
    );
  });
});
