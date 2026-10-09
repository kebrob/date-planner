import { distanceKm } from '@/core/planner/geo';
import type { TrainLeg } from '@/core/planner/types';
import type { LatLng } from '@/ports/places';
import type {
  RailStation,
  RailStationFinder,
  RailTimetable,
  StationEvent,
  StationStop,
} from '@/ports/rail';

// Categories not covered by the Deutschlandticket (long-distance and private long-distance trains).
const LONG_DISTANCE = new Set([
  'ICE',
  'IC',
  'EC',
  'ECE',
  'RJ',
  'RJX',
  'NJ',
  'EN',
  'D',
  'FLX',
  'TGV',
  'WB',
  'EST',
]);
const ORIGIN_RADIUS_KM = 2;
const DESTINATION_RADIUS_KM = 4;
// Fetching a timetable costs one call per hour slot; two destination stations are enough.
const MAX_PATH_STATIONS = 2;
const WALK_KMH = 4.5;
const DEPARTURE_WINDOW_HOURS = 2;
const ARRIVAL_WINDOW_HOURS = 4;

export type TrainConnection = {
  line: string;
  category: string;
  number: string;
  /** Covered by the Deutschlandticket. */
  regional: boolean;
  from: RailStation;
  to: RailStation;
  /** Departure stop at `from`, used for live updates. */
  departureStop: StationStop;
  departure: StationEvent;
  arrival: StationEvent;
};

export const isRegional = (category: string) => !LONG_DISTANCE.has(category.toUpperCase());

/** Station names differ between sources ("München Hauptbahnhof" vs "München Hbf"). */
export function normalizeStationName(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/\(.*?\)/g, '')
      // Platform suffixes like "München Hbf Gl.5-10".
      .replace(/\s+gl\.?\s*[\d-]+.*$/, '')
      .replace(/hauptbahnhof/g, 'hbf')
      .replace(/bahnhof/g, '')
      .replace(/[^a-zäöüß0-9]/g, '')
  );
}

/** A train run is the stop id without its stop index. */
const runOf = (stopId: string) => stopId.replace(/-\d+$/, '');

/**
 * Nearby stations (closest first) that appear on the given train paths, with the exact timetable
 * name and number – big stations have several numbers, e.g. "München Hbf Gl.5-10".
 */
async function stationsOnPath(
  paths: string[][],
  nearby: RailStation[],
  timetable: RailTimetable,
): Promise<RailStation[]> {
  const served = new Map<string, string>();
  for (const path of paths) {
    for (const name of path) served.set(normalizeStationName(name), name);
  }
  const result: RailStation[] = [];
  for (const station of nearby) {
    const exact = served.get(normalizeStationName(station.name));
    if (!exact || result.some((c) => c.name === exact)) continue;
    const eva = (await timetable.stationNumber(exact)) ?? station.eva;
    result.push({ eva, name: exact, location: station.location });
    if (result.length >= MAX_PATH_STATIONS) break;
  }
  return result;
}

const walkMinutes = (a: LatLng, b: LatLng) => (distanceKm(a, b) / WALK_KMH) * 60;

type Input = {
  from: LatLng;
  to: LatLng;
  departAfter: Date;
  regionalOnly: boolean;
  /** Known start station, e.g. the home station; otherwise the closest to `from`. */
  fromStation?: RailStation;
};

/**
 * Earliest direct train from near `from` to near `to` (the timetable API has no transfers).
 * Returns null when no station is close enough or no direct train runs in the window.
 */
export async function findConnection(
  input: Input,
  stations: RailStationFinder,
  timetable: RailTimetable,
): Promise<TrainConnection | null> {
  const origin = input.fromStation ?? (await stations.near(input.from, ORIGIN_RADIUS_KM))[0];
  if (!origin) return null;
  const destinations = (await stations.near(input.to, DESTINATION_RADIUS_KM)).filter(
    (s) => s.eva !== origin.eva,
  );
  if (destinations.length === 0) return null;

  const departures = (
    await timetable.stops(origin.eva, input.departAfter, DEPARTURE_WINDOW_HOURS)
  ).filter(
    (s) =>
      s.departure &&
      !s.departure.cancelled &&
      s.departure.actual >= input.departAfter &&
      (!input.regionalOnly || isRegional(s.category)),
  );
  const candidates = await stationsOnPath(
    departures.map((s) => s.departure!.path),
    destinations,
    timetable,
  );

  let best: TrainConnection | null = null;
  let bestArrivalAtTarget = Infinity;
  for (const station of candidates) {
    const arrivals = new Map(
      (await timetable.stops(station.eva, input.departAfter, ARRIVAL_WINDOW_HOURS))
        .filter((s) => s.arrival && !s.arrival.cancelled)
        .map((s) => [runOf(s.id), s]),
    );
    // Closer stations win ties: walking time is roughly proportional to distance.
    const walkMs = walkMinutes(station.location, input.to) * 60_000;
    for (const dep of departures) {
      const arr = arrivals.get(runOf(dep.id));
      if (!arr?.arrival || arr.arrival.planned <= dep.departure!.planned) continue;
      const atTarget = arr.arrival.actual.getTime() + walkMs;
      if (atTarget < bestArrivalAtTarget) {
        bestArrivalAtTarget = atTarget;
        best = {
          line: dep.line,
          category: dep.category,
          number: dep.number,
          regional: isRegional(dep.category),
          from: origin,
          to: station,
          departureStop: dep,
          departure: dep.departure!,
          arrival: arr.arrival,
        };
      }
    }
  }
  return best;
}

/** Serializable leg; `leaveAt` is when to set off to catch the train (defaults to departure). */
export function toTrainLeg(c: TrainConnection, leaveAt = c.departure.actual): TrainLeg {
  return {
    line: c.line,
    category: c.category,
    regional: c.regional,
    from: { eva: c.from.eva, name: c.from.name },
    to: { eva: c.to.eva, name: c.to.name },
    stopId: c.departureStop.id,
    leaveAt: leaveAt.toISOString(),
    plannedDeparture: c.departure.planned.toISOString(),
    departure: c.departure.actual.toISOString(),
    plannedArrival: c.arrival.planned.toISOString(),
    arrival: c.arrival.actual.toISOString(),
    platform: c.departure.platform,
    plannedPlatform: c.departure.plannedPlatform,
  };
}

type ArrivalInput = {
  from: LatLng;
  /** Known arrival station, e.g. the home station. */
  toStation: RailStation;
  departAfter: Date;
  regionalOnly: boolean;
};

/**
 * Earliest direct train to a known station, searched from its arrivals: their paths reveal which
 * stations near `from` have a direct train (the closest stop may be an S-Bahn halt without one).
 */
export async function findConnectionTo(
  input: ArrivalInput,
  stations: RailStationFinder,
  timetable: RailTimetable,
): Promise<TrainConnection | null> {
  const arrivals = (
    await timetable.stops(input.toStation.eva, input.departAfter, ARRIVAL_WINDOW_HOURS)
  ).filter(
    (s) =>
      s.arrival &&
      !s.arrival.cancelled &&
      s.arrival.planned > input.departAfter &&
      (!input.regionalOnly || isRegional(s.category)),
  );
  const nearby = (await stations.near(input.from, DESTINATION_RADIUS_KM)).filter(
    (s) => s.eva !== input.toStation.eva,
  );
  const origins = await stationsOnPath(
    arrivals.map((s) => s.arrival!.path),
    nearby,
    timetable,
  );

  let best: TrainConnection | null = null;
  for (const origin of origins) {
    const earliest = new Date(
      input.departAfter.getTime() + walkMinutes(input.from, origin.location) * 60_000,
    );
    const departures = new Map(
      (await timetable.stops(origin.eva, input.departAfter, DEPARTURE_WINDOW_HOURS))
        .filter((s) => s.departure && !s.departure.cancelled && s.departure.actual >= earliest)
        .map((s) => [runOf(s.id), s]),
    );
    for (const arr of arrivals) {
      const dep = departures.get(runOf(arr.id));
      if (!dep?.departure || dep.departure.planned >= arr.arrival!.planned) continue;
      if (best && arr.arrival!.actual >= best.arrival.actual) continue;
      best = {
        line: dep.line,
        category: dep.category,
        number: dep.number,
        regional: isRegional(dep.category),
        from: origin,
        to: input.toStation,
        departureStop: dep,
        departure: dep.departure,
        arrival: arr.arrival!,
      };
    }
  }
  return best;
}
