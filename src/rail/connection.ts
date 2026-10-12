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

// Time to change trains, including a platform change at a bigger station.
const MIN_TRANSFER_MINUTES = 6;
// Each hub costs a few timetable calls; the busiest shared stations are the likely changes.
const MAX_HUBS = 2;

type TransferInput = {
  origin: RailStation;
  destination: RailStation;
  departAfter: Date;
  regionalOnly: boolean;
};

/**
 * Earliest connection with exactly one change between two known stations. Hubs are stations that
 * appear on the path of a departing train at the origin and of an arriving train at the
 * destination. Only meant for when no direct train exists, as it needs more timetable calls.
 */
export async function findTransferConnection(
  input: TransferInput,
  stations: RailStationFinder,
  timetable: RailTimetable,
): Promise<[TrainConnection, TrainConnection] | null> {
  const fits = (category: string) => !input.regionalOnly || isRegional(category);
  const departures = (
    await timetable.stops(input.origin.eva, input.departAfter, DEPARTURE_WINDOW_HOURS)
  ).filter(
    (s) =>
      s.departure &&
      !s.departure.cancelled &&
      s.departure.actual >= input.departAfter &&
      fits(s.category),
  );
  const arrivals = (
    await timetable.stops(input.destination.eva, input.departAfter, ARRIVAL_WINDOW_HOURS)
  ).filter((s) => s.arrival && !s.arrival.cancelled && fits(s.category));
  if (departures.length === 0 || arrivals.length === 0) return null;

  const ends = new Set([input.origin.name, input.destination.name].map(normalizeStationName));
  // Big stations appear under several timetable names ("München Hbf Gl.5-10"), one per number.
  const namesOn = (paths: string[][]) => {
    const names = new Map<string, Set<string>>();
    for (const name of paths.flat()) {
      const key = normalizeStationName(name);
      if (!ends.has(key)) names.set(key, (names.get(key) ?? new Set()).add(name));
    }
    return names;
  };
  const outbound = namesOn(departures.map((s) => s.departure!.path));
  const inbound = namesOn(arrivals.map((s) => s.arrival!.path));
  const count = (key: string) =>
    departures.filter((s) => s.departure!.path.some((n) => normalizeStationName(n) === key)).length;
  const hubs = [...outbound.keys()]
    .filter((key) => inbound.has(key))
    .sort((a, b) => count(b) - count(a))
    .slice(0, MAX_HUBS);

  let best: [TrainConnection, TrainConnection] | null = null;
  for (const key of hubs) {
    const names = [...new Set([...outbound.get(key)!, ...inbound.get(key)!])].slice(0, 2);
    const known = await stations.named(names[0]!);
    if (!known) continue;
    const arrivalsAt = new Map<string, { stop: StationStop; station: RailStation }>();
    const departuresAt = new Map<string, { stop: StationStop; station: RailStation }>();
    for (const name of names) {
      const station: RailStation = {
        eva: (await timetable.stationNumber(name)) ?? known.eva,
        name,
        location: known.location,
      };
      for (const stop of await timetable.stops(
        station.eva,
        input.departAfter,
        ARRIVAL_WINDOW_HOURS,
      )) {
        if (stop.arrival && !stop.arrival.cancelled)
          arrivalsAt.set(runOf(stop.id), { stop, station });
        if (stop.departure && !stop.departure.cancelled) {
          departuresAt.set(runOf(stop.id), { stop, station });
        }
      }
    }

    for (const dep of departures) {
      const first = arrivalsAt.get(runOf(dep.id));
      const firstArrival = first?.stop.arrival;
      if (!first || !firstArrival || firstArrival.planned <= dep.departure!.planned) continue;
      const earliestChange = firstArrival.actual.getTime() + MIN_TRANSFER_MINUTES * 60_000;
      for (const arr of arrivals) {
        if (runOf(arr.id) === runOf(dep.id)) continue;
        const second = departuresAt.get(runOf(arr.id));
        const secondDeparture = second?.stop.departure;
        if (!second || !secondDeparture || secondDeparture.actual.getTime() < earliestChange) {
          continue;
        }
        if (arr.arrival!.planned <= secondDeparture.planned) continue;
        if (best && arr.arrival!.actual >= best[1].arrival.actual) continue;
        best = [
          {
            line: dep.line,
            category: dep.category,
            number: dep.number,
            regional: isRegional(dep.category),
            from: input.origin,
            to: first.station,
            departureStop: dep,
            departure: dep.departure!,
            arrival: firstArrival,
          },
          {
            line: second.stop.line,
            category: second.stop.category,
            number: second.stop.number,
            regional: isRegional(second.stop.category),
            from: second.station,
            to: input.destination,
            departureStop: second.stop,
            departure: secondDeparture,
            arrival: arr.arrival!,
          },
        ];
      }
    }
  }
  return best;
}
