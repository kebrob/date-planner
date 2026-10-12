import { describe, expect, it, vi } from 'vitest';
import { addMinutes, fromLocal } from '@/lib/time';
import type { RailStation, RailTimetable, StationStop } from '@/ports/rail';
import {
  findConnection,
  findConnectionTo,
  findTransferConnection,
  isRegional,
  normalizeStationName,
} from './connection';
import { ExpectedTimetable, referenceOffset, shiftDays } from './expected';

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
  named: async () => null,
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
    const none = { near: async () => [], named: async () => null };
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
    named: async () => null,
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

describe('findTransferConnection', () => {
  const HOLZKIRCHEN: RailStation = {
    eva: '8000183',
    name: 'Holzkirchen',
    location: { lat: 47.885, lng: 11.7 },
  };
  const hubs = {
    near: async () => [],
    named: async (name: string) => (name === 'München Ost' ? OST : null),
  };
  const input = {
    origin: ROSENHEIM,
    destination: HOLZKIRCHEN,
    departAfter: at('17:00'),
    regionalOnly: true,
  };

  function network(secondDepartures: StationStop[]) {
    return timetable({
      [ROSENHEIM.eva]: [stop('-1-x', 1, 'RB', { dep: '17:12', path: ROUTE })],
      [OST.eva]: [stop('-1-x', 5, 'RB', { arr: '17:55' }), ...secondDepartures],
      [HOLZKIRCHEN.eva]: [
        stop('-7-x', 9, 'S', { arr: '18:30', path: ['München Ost', 'Deisenhofen'] }),
        stop('-8-x', 9, 'S', { arr: '18:50', path: ['München Ost', 'Deisenhofen'] }),
      ],
    });
  }

  it('changes at a station both trains pass through', async () => {
    const trains = await findTransferConnection(
      input,
      hubs,
      network([stop('-7-x', 2, 'S', { dep: '18:05' })]),
    );
    expect(trains).toHaveLength(2);
    expect(trains![0]).toMatchObject({ from: ROSENHEIM, to: { name: 'München Ost' } });
    expect(trains![1]).toMatchObject({ from: { name: 'München Ost' }, to: HOLZKIRCHEN });
    expect(trains![1].arrival.planned).toEqual(at('18:30'));
  });

  it('leaves enough time to change trains', async () => {
    const trains = await findTransferConnection(
      input,
      hubs,
      network([stop('-7-x', 2, 'S', { dep: '17:58' }), stop('-8-x', 2, 'S', { dep: '18:25' })]),
    );
    // The 17:58 is only 3 minutes after arriving; the next one is taken.
    expect(trains![1].departure.planned).toEqual(at('18:25'));
  });

  it('returns null when the trains share no station', async () => {
    const tt = timetable({
      [ROSENHEIM.eva]: [stop('-1-x', 1, 'RB', { dep: '17:12', path: ['Kufstein'] })],
      [HOLZKIRCHEN.eva]: [stop('-7-x', 9, 'S', { arr: '18:30', path: ['Deisenhofen'] })],
    });
    expect(await findTransferConnection(input, hubs, tt)).toBeNull();
  });
});

describe('expected trains', () => {
  // Monday noon.
  const now = fromLocal('2026-10-12', '12:00');

  it('takes the timetable of the same kind of day', () => {
    // Wednesday next week: a weekday, so today's (Monday) evening trains.
    expect(referenceOffset(fromLocal('2026-10-21', '18:00'), now)).toBe(9);
    // Next Saturday: no Saturday available, so today evening (still ahead) is used.
    expect(referenceOffset(fromLocal('2026-10-17', '18:00'), now)).toBe(5);
    // This morning's trains are still served a few hours back.
    expect(referenceOffset(fromLocal('2026-10-21', '08:00'), now)).toBe(9);
    // Early morning is neither still served today nor yet tomorrow; tomorrow is closest.
    expect(referenceOffset(fromLocal('2026-10-21', '05:00'), now)).toBe(8);
  });

  it('moves the trains of the reference day to the requested day, without realtime data', async () => {
    const reference = stop('-1-x', 1, 'RB', { dep: '18:12', delay: 7 });
    const inner: RailTimetable = {
      stops: vi.fn(async () => [
        {
          ...reference,
          departure: {
            ...reference.departure!,
            planned: fromLocal('2026-10-12', '18:12'),
            actual: fromLocal('2026-10-12', '18:19'),
          },
        },
      ]),
      stationNumber: async () => null,
      refresh: async (_e, s) => s,
    };
    const [moved] = await new ExpectedTimetable(inner, 9).stops(
      '1',
      fromLocal('2026-10-21', '18:00'),
      2,
    );
    expect(inner.stops).toHaveBeenCalledWith('1', fromLocal('2026-10-12', '18:00'), 2);
    expect(moved!.departure!.planned).toEqual(fromLocal('2026-10-21', '18:12'));
    expect(moved!.departure!.actual).toEqual(fromLocal('2026-10-21', '18:12'));
  });

  it('keeps the wall-clock time across a daylight saving change', () => {
    expect(shiftDays(fromLocal('2026-10-24', '18:00'), 2)).toEqual(
      fromLocal('2026-10-26', '18:00'),
    );
  });
});
