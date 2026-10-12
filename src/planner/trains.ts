import { estimateTravel } from '@/core/planner/geo';
import type {
  Activity,
  PlanItem,
  PlanWarning,
  Transport,
  Travel,
  TravelRoutine,
} from '@/core/planner/types';
import { addMinutes, minutesBetween } from '@/lib/time';
import type { LatLng } from '@/ports/places';
import type { RailStationFinder, RailTimetable } from '@/ports/rail';
import {
  findConnection,
  findConnectionTo,
  findTransferConnection,
  toTrainLeg,
  type TrainConnection,
} from '@/rail/connection';
import { ExpectedTimetable, REAL_TIMES_HORIZON_HOURS, referenceOffset } from '@/rail/expected';

const STATION_RADIUS_KM = 2;
// Station near a venue for connections with a change.
const VENUE_STATION_RADIUS_KM = 4;
const MAX_ORIGIN_STATIONS = 3;
// Arriving home this much after the planned end still counts as on time.
const LATE_RETURN_TOLERANCE_MIN = 15;

export type TrainContext = {
  start: Date;
  end: Date;
  transport: Transport;
  /** Exact home (pin) for local walking times; never sent anywhere. */
  home: LatLng;
  /** Rounded home, the only home location used for station lookups. */
  homeGrid: LatLng;
  routine?: TravelRoutine;
  /** Set when the date starts in the chosen area instead of at home. */
  startPoint?: LatLng;
  /** Only legs without a real train (estimates, expected times); for saved plans. */
  refreshOnly?: boolean;
  now?: Date;
};

type Rail = { stations: RailStationFinder; timetable: RailTimetable };

type TrainPlanItem = Pick<PlanItem, 'travelBefore' | 'start' | 'end'> & {
  activity: Pick<Activity, 'atHome'>;
  place: { location: LatLng } | null;
};

/** The parts of a plan that trains change; generated and saved plans both fit. */
export type TrainPlan = {
  items: TrainPlanItem[];
  travelHome: Travel | null;
  warnings: PlanWarning[];
};

function shiftFrom(items: TrainPlanItem[], index: number, minutes: number) {
  for (const item of items.slice(index)) {
    item.start = addMinutes(item.start, minutes);
    item.end = addMinutes(item.end, minutes);
  }
}

/** Minutes between home and its station: the travel routine if there is one, else on foot. */
function homeAccess(ctx: TrainContext, station: LatLng): number {
  return ctx.routine
    ? ctx.routine.firstLegMinutes + ctx.routine.bufferMinutes
    : estimateTravel(ctx.home, station, 'walk', undefined).minutes;
}

const localAccess = (from: LatLng, to: LatLng) =>
  estimateTravel(from, to, 'deutschlandticket', undefined).minutes;

const needsTrain = (travel: Travel | null, refreshOnly?: boolean) =>
  travel?.mode === 'train' && (!refreshOnly || !travel.train || travel.train.expected === true);

/** Whether a saved plan still has train legs that real or expected trains could improve. */
export function hasOpenTrainLegs(plan: Pick<TrainPlan, 'items' | 'travelHome'>): boolean {
  return [...plan.items.map((i) => i.travelBefore), plan.travelHome].some((t) =>
    needsTrain(t, true),
  );
}

/**
 * Replaces estimated train legs with real trains (direct, else with one change) and moves later
 * items if a train arrives later than estimated. Dates beyond the timetable horizon get expected
 * trains from a similar day. Legs without a fitting train keep their estimate.
 */
export async function attachTrains(plan: TrainPlan, ctx: TrainContext, rail: Rail): Promise<void> {
  const regionalOnly = ctx.transport === 'deutschlandticket';
  const warnings = new Set(plan.warnings);
  const now = ctx.now ?? new Date();

  /** Real timetable within the horizon, otherwise a similar day's trains moved to the date. */
  const timetableFor = (readyAt: Date) =>
    minutesBetween(now, readyAt) / 60 > REAL_TIMES_HORIZON_HOURS
      ? {
          timetable: new ExpectedTimetable(rail.timetable, referenceOffset(readyAt, now)),
          expected: true,
        }
      : { timetable: rail.timetable, expected: false };

  async function connect(
    from: LatLng,
    fromIsHome: boolean,
    to: LatLng,
    toIsHome: boolean,
    readyAt: Date,
  ) {
    const { timetable, expected } = timetableFor(readyAt);
    // The closest station may be an S-Bahn halt without a direct train, so try a few.
    const origins = (
      await rail.stations.near(fromIsHome ? ctx.homeGrid : from, STATION_RADIUS_KM)
    ).slice(0, MAX_ORIGIN_STATIONS);
    const [homeStation] = toIsHome
      ? await rail.stations.near(ctx.homeGrid, STATION_RADIUS_KM)
      : [undefined];
    type Found = { trains: TrainConnection[]; access: number };

    const direct = async (regional: boolean): Promise<Found | null> => {
      // Home-bound: search from the home station's arrivals, which finds the right city station.
      if (toIsHome && !fromIsHome) {
        if (!homeStation) return null;
        const connection = await findConnectionTo(
          { from, toStation: homeStation, departAfter: readyAt, regionalOnly: regional },
          rail.stations,
          timetable,
        );
        return connection
          ? { trains: [connection], access: localAccess(from, connection.from.location) }
          : null;
      }
      for (const station of origins) {
        const access = fromIsHome
          ? homeAccess(ctx, station.location)
          : localAccess(from, station.location);
        const connection = await findConnection(
          {
            from: fromIsHome ? ctx.homeGrid : from,
            to: toIsHome ? ctx.homeGrid : to,
            departAfter: addMinutes(readyAt, access),
            regionalOnly: regional,
            fromStation: station,
          },
          rail.stations,
          timetable,
        );
        if (connection) return { trains: [connection], access };
      }
      return null;
    };

    const withChange = async (regional: boolean): Promise<Found | null> => {
      const origin = fromIsHome
        ? origins[0]
        : (await rail.stations.near(from, VENUE_STATION_RADIUS_KM))[0];
      const destination = toIsHome
        ? homeStation
        : (await rail.stations.near(to, VENUE_STATION_RADIUS_KM))[0];
      if (!origin || !destination || origin.eva === destination.eva) return null;
      const access = fromIsHome
        ? homeAccess(ctx, origin.location)
        : localAccess(from, origin.location);
      // Extra calls may hit the rate limit; then the leg keeps its estimate.
      const trains = await findTransferConnection(
        { origin, destination, departAfter: addMinutes(readyAt, access), regionalOnly: regional },
        rail.stations,
        timetable,
      ).catch(() => null);
      return trains ? { trains, access } : null;
    };

    let found = (await direct(regionalOnly)) ?? (await withChange(regionalOnly));
    if (!found && regionalOnly) {
      found = await direct(false);
      if (found) warnings.add('train_ticket_needed');
    }
    if (!found) return null;
    const { trains, access } = found;
    const first = trains[0]!;
    const last = trains.at(-1)!;
    const egress = toIsHome ? homeAccess(ctx, last.to.location) : localAccess(last.to.location, to);
    // Planned time: a delay may shrink again, and then the train would be gone.
    const leaveAt = addMinutes(first.departure.planned, -access);
    const arriveAt = addMinutes(last.arrival.actual, egress);
    const leg = (c: TrainConnection, leave?: Date) => ({
      ...toTrainLeg(c, leave),
      ...(expected ? { expected: true } : {}),
    });
    const travel = (estimate: Travel): Travel => {
      const result: Travel = {
        ...estimate,
        minutes: minutesBetween(leaveAt, arriveAt),
        train: leg(first, leaveAt),
      };
      delete result.transfers;
      if (trains.length > 1)
        result.transfers = trains.slice(1).map((c) => leg(c, c.departure.planned));
      return result;
    };
    return { travel, arriveAt };
  }

  // A failing lookup (e.g. rate limit) only costs that leg its train; the others keep theirs and
  // the warnings collected so far stay.
  const connectLeg = (...args: Parameters<typeof connect>) =>
    connect(...args).catch(() => {
      warnings.add('trains_unavailable');
      return null;
    });

  let here = ctx.startPoint ?? ctx.home;
  let hereIsHome = !ctx.startPoint;
  let readyAt = ctx.start;
  for (const [index, item] of plan.items.entries()) {
    const target = item.activity.atHome ? ctx.home : item.place?.location;
    if (needsTrain(item.travelBefore, ctx.refreshOnly) && target) {
      const result = await connectLeg(here, hereIsHome, target, item.activity.atHome, readyAt);
      if (result) {
        item.travelBefore = result.travel(item.travelBefore!);
        const late = minutesBetween(item.start, result.arriveAt);
        if (late > 0) {
          shiftFrom(plan.items, index, late);
          warnings.add('train_times_adjusted');
        }
      }
    }
    if (target) {
      here = target;
      hereIsHome = item.activity.atHome;
    }
    readyAt = item.end;
  }

  if (needsTrain(plan.travelHome, ctx.refreshOnly) && !hereIsHome) {
    const result = await connectLeg(here, false, ctx.home, true, readyAt);
    if (result) {
      plan.travelHome = result.travel(plan.travelHome!);
      if (minutesBetween(ctx.end, result.arriveAt) > LATE_RETURN_TOLERANCE_MIN) {
        warnings.add('train_late_return');
      }
    }
  }
  plan.warnings = [...warnings];
}
